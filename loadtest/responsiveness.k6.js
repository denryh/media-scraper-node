// Phase 8: prove the API main thread stays responsive while the worker is
// genuinely busy on the shared CPU.
//
// Two scenarios run simultaneously:
//
//   1. `stress` — 5000 VUs × 1 POST /scrape (the existing burst).
//   2. `ping`   — 1 VU at constant 10 req/s on GET /healthz for the full window.
//
// `/healthz` is a sync handler with no I/O dependency. Its tail latency is
// almost exactly the time the event loop was unable to accept a new request,
// which is the property we want to assert. Run this AFTER `bash preseed.sh`
// so the worker is mid-parse on multiple large.html scrapes.

import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const FIXTURE = __ENV.FIXTURE_URL || 'http://fixture';
const DURATION = __ENV.DURATION || '15s';

export const options = {
  scenarios: {
    stress: {
      executor: 'per-vu-iterations',
      vus: 5000,
      iterations: 1,
      maxDuration: DURATION,
      gracefulStop: '5s',
      exec: 'stress',
    },
    ping: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 2,
      maxVUs: 10,
      exec: 'ping',
    },
  },
  thresholds: {
    // Existing SLO from Phase 6.
    'http_req_duration{scenario:stress}': ['p(99)<800'],
    'http_req_failed{scenario:stress}': ['rate<0.01'],
    // The actual responsiveness gate.
    'http_req_duration{scenario:ping}': ['p(99)<100'],
    'http_req_failed{scenario:ping}': ['rate==0'],
  },
};

const headers = { 'Content-Type': 'application/json' };

export function stress() {
  const n = 1 + Math.floor(Math.random() * 50);
  const url = `${FIXTURE}/page-${n}.html`;
  const r = http.post(`${BASE}/scrape`, JSON.stringify({ urls: [url] }), {
    headers,
    tags: { scenario: 'stress' },
  });
  check(r, { 'stress: 202': (rr) => rr.status === 202 });
}

export function ping() {
  const r = http.get(`${BASE}/healthz`, { tags: { scenario: 'ping' } });
  check(r, { 'ping: 200': (rr) => rr.status === 200 });
}
