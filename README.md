# Media Scraper

Async URL → image/video scraper. The API and a BullMQ worker run in **a single Node process** capped at **1 CPU / 1 GB**; Postgres and Redis sit alongside as external data services. The streaming `htmlparser2` pipeline keeps per-job memory at ~35 KB regardless of page size, so the API stays responsive while the worker drains.

- **Design**: see [`PLAN.md`](./PLAN.md) — architecture, data model, API contract, scraper pipeline, main-thread hygiene, edge limits.
- **Phased execution + per-phase verification gates**: `~/.claude/plans/write-down-an-md-structured-emerson.md`.
- **Headline result**: 5000-VU burst, p99 = 613 ms, 0 % errors, 137 MB peak RSS. Under combined burst + worker saturation, `/healthz` median 974 µs / p95 4.9 ms and `event_loop_delay` max 157 ms — main thread stays responsive. Full breakdown in [`loadtest/RESULTS.md`](./loadtest/RESULTS.md).

## Stack

| Layer        | Tech                                              |
|--------------|---------------------------------------------------|
| API + worker | Node 20 + Fastify + TypeScript + BullMQ (in-proc) |
| Scraper      | undici (HTTP) + htmlparser2 (SAX, no DOM)         |
| DB           | Postgres 16 + `pg_trgm` (trigram search)          |
| Frontend     | React 18 + Vite + TanStack Query (nginx static)   |
| Load test    | k6 (run inside the docker network)                |
| Tooling      | pnpm 10 (workspaces) + Docker Compose             |

## Quickstart

Requires: Docker (Colima/Docker Desktop), pnpm 10.x.

```sh
# 1) Generate fixture pages (one-time; outputs gitignored)
bash loadtest/fixture-server/gen-pages.sh         # 50 small pages (page-1..50.html)
bash loadtest/fixture-server/gen-large.sh         # ~4.5 MB stress page (large.html)

# 2) Bring the stack up
pnpm install
docker compose up -d --build

# 3) Smoke checks
curl -s localhost:3001/healthz                    # → {"ok":true}
curl -sI localhost:8080 | head -1                 # → HTTP/1.1 200 OK
docker inspect app --format '{{.HostConfig.Memory}}'    # → 1073741824
docker inspect app --format '{{.HostConfig.NanoCPUs}}'  # → 1000000000

# 4) Scrape one page
curl -s -X POST localhost:3001/scrape \
  -H 'content-type: application/json' \
  -d '{"urls":["http://fixture/page-1.html"]}' | jq

# 5) Open the UI
open http://localhost:8080                        # paste URLs, watch grid
```

The default app host port is **3001** (3000 is often used by other dev tools). Override with `APP_HOST_PORT=3000 docker compose up -d` if 3000 is free.

## API surface

| Method | Path                                  | Notes                                                                       |
| ------ | ------------------------------------- | --------------------------------------------------------------------------- |
| `POST` | `/scrape`                             | Body `{ urls: string[] }` — ≤ 100 URLs/req, ≤ 16 KB body, http/https only.  |
| `GET`  | `/jobs/:id`                           | Job status + occurrence count.                                              |
| `GET`  | `/media?type=&q=&cursor=&limit=`      | Deduped assets, keyset paginated, trigram-search on URL or `alt_text`.      |
| `GET`  | `/healthz`                            | Liveness — also serves as the side-channel canary in the responsiveness test. |
| `GET`  | `/metrics`                            | JSON snapshot: `event_loop_delay_ms` (p50/p99/max), `rss_mb`, queue counts. |
| `POST` | `/metrics/reset`                      | Reset the event-loop-delay histogram (use before a measurement window).      |

The SPA at `:8080` proxies `/api/*` to the app, so the same endpoints are reachable as e.g. `http://localhost:8080/api/media`.

## Load testing

All k6 runs go through the docker bridge (`http://app:3000`) — running k6 from the macOS host can choke colima's port-forward layer at thousands of concurrent connections.

```sh
# 1) Burst (5000 VUs × 1 POST = 5000 concurrent submissions).
docker run --rm --network media-scraper-node_default \
  -v "$PWD/loadtest:/loadtest" \
  -e BASE_URL=http://app:3000 -e FIXTURE_URL=http://fixture \
  grafana/k6 run /loadtest/burst.k6.js

# 2) Boundaries (101 URLs → 400, 17 KB body → 413, ftp:// → 400)
docker run --rm --network media-scraper-node_default \
  -v "$PWD/loadtest:/loadtest" \
  -e BASE_URL=http://app:3000 \
  grafana/k6 run /loadtest/limits.k6.js
```

### Backpressure (queue grows past 5K, system stays stable)

Open-loop submission outpacing drain. 1200 RPS × 15 s + a 5 RPS `/healthz` canary. Built-in invariant checks in the orchestrator (state reset → metrics sampler → k6 → drain wait → SQL invariants).

```sh
bash loadtest/backpressure-run.sh                 # default: RATE=1200, DURATION=15s
# Override: RATE=600 DURATION=30s bash loadtest/backpressure-run.sh
```

Expected on default knobs: peak `queue.waiting` ~5,400 at t≈15s, drain to 0 in ~4 s after submission stops, 0 failed jobs, `/healthz` p99 < 5 ms throughout.

### Main-thread responsiveness

Two signals captured at the same time, with the worker pre-saturated by 10× scrapes of the 4.26 MB / 60 K-tag `large.html` fixture so the shared CPU is genuinely contested:

- **External canary** — a 10 req/s pinger on `GET /healthz` running alongside the burst. `/healthz` is a sync handler with no I/O, so its tail latency is essentially "how long the loop couldn't admit a new request".
- **Internal probe** — `event_loop_delay` percentiles from `perf_hooks.monitorEventLoopDelay()`, exposed at `/metrics` and sampled at 1 Hz into a CSV.

```sh
# Pre-saturate the worker
bash loadtest/preseed.sh 10                              # 10× large.html in flight

# Sample /metrics at 1 Hz (run in background)
( DURATION_S=25 bash loadtest/poll-metrics.sh \
    > loadtest/results/responsiveness-metrics.csv ) &

# Run stress + ping concurrently for 15 s
docker run --rm --network media-scraper-node_default \
  -v "$PWD/loadtest:/loadtest" \
  -e BASE_URL=http://app:3000 -e FIXTURE_URL=http://fixture -e DURATION=15s \
  grafana/k6 run /loadtest/responsiveness.k6.js

wait
```

Decomposing the result tells you whether tail latency is **EL blocking** (a real responsiveness problem) or **kernel TCP accept-queueing** (a synchronisation-spike artefact, not main-thread stall). See [`loadtest/RESULTS.md`](./loadtest/RESULTS.md) for the full table.

Captured numbers + invariants are in [`loadtest/RESULTS.md`](./loadtest/RESULTS.md).

## Layout

```
.
├── PLAN.md                       Design rationale (read this first)
├── docker-compose.yml            Constrains `app` to 1 CPU / 1 GB
├── pnpm-workspace.yaml
├── packages/app/                 Fastify API + in-proc BullMQ Worker (constrained)
│   ├── src/server.ts             Boot: migrate → start worker → listen
│   ├── src/db.ts                 pg.Pool
│   ├── src/migrate.ts            Lightweight migration runner (run on boot)
│   ├── src/queue.ts              BullMQ Queue + Worker registration
│   ├── src/scraper.ts            undici.stream → htmlparser2 SAX → CTE upsert
│   ├── src/metrics.ts            /metrics + event-loop-delay histogram
│   └── src/routes/{scrape,jobs,media}.ts
├── packages/web/                 React + Vite, served by nginx
├── db/migrations/001_init.sql    Schema, indexes, counter trigger
└── loadtest/
    ├── burst.k6.js               5000 VUs × 1 POST /scrape
    ├── limits.k6.js              edge-cap rejection cases (400/413)
    ├── responsiveness.k6.js      stress + /healthz pinger (mixed-load)
    ├── backpressure.k6.js        sustained submission outpacing drain (queue → 5K+)
    ├── backpressure-run.sh       end-to-end backpressure orchestrator
    ├── preseed.sh                pre-saturate worker with N× large.html
    ├── poll-metrics.sh           1 Hz CSV sampler of /metrics
    ├── fixture-server/           nginx + 50 generated HTML pages
    └── RESULTS.md
```

## Trade-offs (explicit non-goals)

- **JS-rendered pages**: not handled (no headless Chromium — won't fit in 1 GB shared with API + worker).
- **Per-host fairness**: not implemented; the realistic abuse pattern (same URL spammed) is collapsed by `jobId = sha1(url)`.
- **Auth, distributed scaling, full observability stack**: out of scope.
