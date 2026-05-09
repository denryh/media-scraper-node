import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const APP_URL = __ENV.APP_URL || 'http://app:3000';
const MOCK_URL = __ENV.MOCK_URL || 'http://mock:8888';
const RAMP_TARGET = Number(__ENV.RAMP_TARGET || 5000);
const HOLD_DURATION = __ENV.HOLD_DURATION || '20s';

const evlDelayP99 = new Trend('event_loop_delay_p99_ms');
const queueDrainS = new Trend('queue_drain_seconds');
const jobsCompleted = new Counter('jobs_completed');
const jobsFailed = new Counter('jobs_failed');

export const options = {
  scenarios: {
    scrape: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 1000,
      maxVUs: 8000,
      stages: [
        { duration: '1s', target: RAMP_TARGET },
        { duration: HOLD_DURATION, target: RAMP_TARGET },
      ],
      exec: 'scrape',
    },
    probe: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '1s',
      duration: '31s',
      preAllocatedVUs: 2,
      exec: 'probe',
    },
  },
  teardownTimeout: '30m',
};

export function setup() {
  http.post(`${APP_URL}/metrics/reset`);
  return { holdEndedAt: null };
}

export function scrape() {
  const id = `${__VU}-${__ITER}-${Date.now()}`;
  const body = JSON.stringify({ urls: [`${MOCK_URL}/page/${id}`] });
  const r = http.post(`${APP_URL}/scrape`, body, {
    headers: { 'content-type': 'application/json' },
  });
  check(r, { 'status is 202': (rr) => rr.status === 202 });
}

export function probe() {
  const r = http.get(`${APP_URL}/metrics`);
  if (r.status !== 200) return;
  const m = r.json();
  if (m && m.event_loop_delay_ms) {
    evlDelayP99.add(m.event_loop_delay_ms.p99);
  }
}

export function teardown() {
  const startedAt = Date.now();
  while (true) {
    const r = http.get(`${APP_URL}/metrics`);
    if (r.status === 200) {
      const m = r.json();
      const q = m.queue || {};
      if ((q.waiting | 0) === 0 && (q.active | 0) === 0 && (q.delayed | 0) === 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        queueDrainS.add(elapsed);
        jobsCompleted.add(q.completed | 0);
        jobsFailed.add(q.failed | 0);
        return;
      }
    }
    sleep(2);
  }
}

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

export function handleSummary(data) {
  const m = data.metrics;
  const drain = m.queue_drain_seconds?.values?.avg;
  const completed = m.jobs_completed?.values?.count ?? 0;
  const failed = m.jobs_failed?.values?.count ?? 0;
  const evlAvg = m.event_loop_delay_p99_ms?.values?.avg;
  const evlMax = m.event_loop_delay_p99_ms?.values?.max;
  const scrapeP99 =
    m['http_req_duration{scenario:scrape}']?.values?.['p(99)'] ??
    m.http_req_duration?.values?.['p(99)'];

  const block =
    `\n─── Load test report ───\n` +
    `Queue drain:        ${fmt(drain)}s\n` +
    `Jobs completed:     ${completed}\n` +
    `Jobs failed:        ${failed}\n` +
    `Event-loop p99:     avg=${fmt(evlAvg)}ms max=${fmt(evlMax)}ms\n`;

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }) + block,
  };
}
