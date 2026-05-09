// Burst test — proves the API admits ~5000 concurrent submissions on the
// constrained `app` container while the worker drains the queue on the same
// shared CPU.
//
// Each VU does ONE POST /scrape with a single URL chosen at random from the
// 50-page fixture. Total submissions: ~5000 unique-ish URLs (BullMQ + the
// scrape_jobs PK collapse duplicates). The fixture page set is intentionally
// small (50) so dedup across requests gets exercised, while still producing
// real per-URL work.
//
// SLO (app container, see RESULTS.md after run):
//   - http_req_duration p(99) < 800 ms
//   - http_req_failed   < 1 %
//   - peak RSS < 900 MB (capture via `docker stats`)
//   - CPU sustained ≤ 100 %

import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const FIXTURE = __ENV.FIXTURE_URL || 'http://fixture'; // resolved by the worker, not k6

// 5000 VUs × 1 POST each = 5000 total requests. Each VU does exactly one
// iteration, so peak concurrency = peak VUs (5000) — matches the brief's
// "5000 scraping requests at the same time".
export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: 5000,
      iterations: 1,
      maxDuration: '60s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<800'],
    checks: ['rate>0.99'],
  },
};

const headers = { 'Content-Type': 'application/json' };

export default function () {
  // 50 fixture pages → ~100 VUs share each URL, so dedup will be visible.
  const n = 1 + Math.floor(Math.random() * 50);
  const url = `${FIXTURE}/page-${n}.html`;
  const body = JSON.stringify({ urls: [url] });
  const res = http.post(`${BASE}/scrape`, body, { headers });
  check(res, {
    'status is 202': (r) => r.status === 202,
    'has jobs[]': (r) => {
      try {
        const j = r.json();
        return Array.isArray(j.jobs) && j.jobs.length === 1;
      } catch {
        return false;
      }
    },
  });
}
