// Boundary test — proves the edge caps reject correctly.
//   - 101 URLs in one POST → 400 (AJV maxItems)
//   - body > 16 KB         → 413 (Fastify bodyLimit)
//   - non-http(s) URL      → 400 (AJV pattern)
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const headers = { 'Content-Type': 'application/json' };

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1.0'] },
};

export default function () {
  // 1) 101 URLs → 400
  {
    const urls = Array.from({ length: 101 }, (_, i) => `http://x.test/${i}`);
    const r = http.post(`${BASE}/scrape`, JSON.stringify({ urls }), { headers });
    if (!check(r, { '101 URLs → 400': (rr) => rr.status === 400 })) fail(`got ${r.status}`);
  }

  // 2) body > 16 KB → 413
  {
    // ~100 URLs × 200 chars ≈ 20 KB JSON payload → exceeds bodyLimit
    const urls = Array.from({ length: 100 }, (_, i) => `http://example.com/${'x'.repeat(200)}-${i}`);
    const r = http.post(`${BASE}/scrape`, JSON.stringify({ urls }), { headers });
    if (!check(r, { '17+ KB body → 413': (rr) => rr.status === 413 })) fail(`got ${r.status}`);
  }

  // 3) bad URL pattern → 400
  {
    const r = http.post(`${BASE}/scrape`, JSON.stringify({ urls: ['ftp://nope'] }), { headers });
    if (!check(r, { 'ftp:// → 400': (rr) => rr.status === 400 })) fail(`got ${r.status}`);
  }
}
