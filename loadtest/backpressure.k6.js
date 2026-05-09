// Backpressure test — submission outpaces drain so the queue grows past 5K.
//
// Two scenarios, both at constant arrival rate (open-loop):
//   1. submit  — POST /scrape at RATE/s for DURATION. One unique URL per
//                request (exec.scenario.iterationInTest seeds the URL),
//                so jobId = sha1(url) does NOT collapse them and every
//                request becomes real worker work.
//   2. canary  — GET /healthz at 5/s for the same window. /healthz is a
//                sync handler with no I/O — its tail latency is the
//                "is the app even alive" signal. Stays under 100 ms p99
//                if the app process hasn't crashed or OOM-paused.
//
// At RATE=120/s × 1m with worker drain ~25/s: ~7,200 jobs submitted,
// ~5,500–6,000 peak queue.waiting at t=60. Run via backpressure-run.sh,
// which captures the queue-growth time series via /metrics polling.

import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const FIXTURE = __ENV.FIXTURE_URL || 'http://fixture';
// Empirically-tuned defaults: at small-page drain rate (~800/s with concurrency=5),
// 1200 RPS × 15 s lands peak queue.waiting around 5,400 (the user's "a little over 5K"
// target) without overshooting into 16K-territory that takes minutes to drain.
const RATE = Number(__ENV.RATE || 1200);
const DURATION = __ENV.DURATION || '15s';

export const options = {
  scenarios: {
    submit: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'submit',
    },
    canary: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 2,
      maxVUs: 5,
      exec: 'canary',
    },
  },
  thresholds: {
    'http_req_failed{scenario:submit}': ['rate<0.01'],
    'http_req_failed{scenario:canary}': ['rate==0'],
    'http_req_duration{scenario:canary}': ['p(99)<100'],
  },
};

const headers = { 'Content-Type': 'application/json' };

export function submit() {
  const seed = exec.scenario.iterationInTest;
  const url = `${FIXTURE}/page-${(seed % 50) + 1}.html?seed=${seed}`;
  const r = http.post(`${BASE}/scrape`, JSON.stringify({ urls: [url] }), {
    headers,
    tags: { scenario: 'submit' },
  });
  check(r, { 'submit: 202': (rr) => rr.status === 202 });
}

export function canary() {
  const r = http.get(`${BASE}/healthz`, { tags: { scenario: 'canary' } });
  check(r, { 'canary: 200': (rr) => rr.status === 200 });
}
