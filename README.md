# Media Scraper

Async URL → image/video scraper. The API and a BullMQ worker run in **a single Node process** capped at **1 CPU / 1 GB**; Postgres and Redis sit alongside as external data services. The streaming `htmlparser2` pipeline keeps per-job memory at ~35 KB regardless of page size, so the API stays responsive while the worker drains.

- **Headline result** — 5 000 RPS for 30 s into a single 1 CPU / 1 GB container: 141 494 jobs accepted, **0 failures**, event-loop p99 max 32.4 ms during the burst, queue drained in ~252 s. See [`tests/load.k6.js`](./tests/load.k6.js).

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

Requires: Docker (Colima/Docker Desktop), pnpm 10.x, Node ≥ 20.

```sh
pnpm install
docker compose up -d --build

# Smoke checks
curl -s localhost:3001/healthz                    # → {"ok":true}
curl -sI localhost:8080 | head -1                 # → HTTP/1.1 200 OK
docker inspect app --format '{{.HostConfig.Memory}}'    # → 1073741824
docker inspect app --format '{{.HostConfig.NanoCPUs}}'  # → 1000000000

# Scrape a page
curl -s -X POST localhost:3001/scrape \
  -H 'content-type: application/json' \
  -d '{"urls":["https://example.com"]}' | jq

# Open the UI
open http://localhost:8080                        # paste URLs, watch grid
```

The default app host port is **3001** (3000 is often used by other dev tools). Override with `APP_HOST_PORT=3000 docker compose up -d` if 3000 is free.

## API surface

| Method | Path                                  | Notes                                                                       |
| ------ | ------------------------------------- | --------------------------------------------------------------------------- |
| `POST` | `/scrape`                             | Body `{ urls: string[] }` — ≤ 100 URLs/req, ≤ 16 KB body, http/https only.  |
| `GET`  | `/jobs/:id`                           | Job status + occurrence count.                                              |
| `GET`  | `/media?type=&q=&cursor=&limit=`      | Deduped assets, keyset paginated, trigram-search on URL or `alt_text`.      |
| `GET`  | `/media/:id/sources`                  | Up to 100 occurrences for one asset (most-recent first).                    |
| `GET`  | `/healthz`                            | Liveness probe.                                                             |
| `GET`  | `/metrics`                            | JSON snapshot: `event_loop_delay_ms` (p50/p99/max), `rss_mb`, queue counts. |
| `POST` | `/metrics/reset`                      | Reset the event-loop-delay histogram (use before a measurement window).     |

The SPA at `:8080` proxies `/api/*` to the app, so the same endpoints are reachable as e.g. `http://localhost:8080/api/media`.

## Load test

The k6 script under `tests/` simulates the assignment's worst case: bursting `POST /scrape` to **5 000 RPS** in 1 s and holding for 30 s, with a unique URL per request so job dedup never short-circuits, all on a 1 CPU / 1 GB `app` container.

Two pieces:

- `tests/mock-server.mjs` — zero-dep node http server. `GET /page/:id` returns HTML with 20 `<img>` + 5 `<video>` tags whose `src` encodes `:id`, so each scraped page produces fresh `media_assets` rows (exercises the upsert + trigger-bump path under load).
- `tests/load.k6.js` — k6 with two parallel scenarios: a `ramping-arrival-rate` driver and a 1 Hz `/metrics` probe that samples `event_loop_delay_ms.p99` into a custom Trend. `teardown` polls `/metrics` until `waiting+active+delayed == 0` and feeds drain time + completed/failed counts into custom metrics. `handleSummary` prints a single report block.

```sh
# 1) Bring up the stack with the loadtest profile (adds the mock service)
docker compose --profile loadtest up -d --build

# 2) Run k6 inside the same docker network (avoids macOS port-forward fd limits)
docker run --rm --network media-scraper-node_default \
  -v "$PWD/tests:/tests" \
  -e APP_URL=http://app:3000 \
  -e MOCK_URL=http://mock:8888 \
  grafana/k6 run /tests/load.k6.js
```

Tune the load shape via env without editing the script — useful for finding the sweet spot between drain time and main-thread responsiveness:

```sh
docker run --rm --network media-scraper-node_default \
  -v "$PWD/tests:/tests" \
  -e APP_URL=http://app:3000 -e MOCK_URL=http://mock:8888 \
  -e RAMP_TARGET=2000 -e HOLD_DURATION=60s \
  grafana/k6 run /tests/load.k6.js
```

The custom report block at the end of the k6 output looks like:

```
─── Load test report ───
Queue drain:        251.9s
Jobs completed:     141462
Jobs failed:        0
Event-loop p99:     avg=27.5ms max=32.4ms
```

## Layout

```
.
├── docker-compose.yml               Constrains `app` to 1 CPU / 1 GB
├── pnpm-workspace.yaml
├── packages/app/                    Fastify API + in-proc BullMQ Worker (constrained)
│   ├── src/server.ts                Boot: migrate → start worker → listen
│   ├── src/db.ts                    pg.Pool
│   ├── src/migrate.ts               Lightweight migration runner (run on boot)
│   ├── src/queue.ts                 BullMQ Queue + Worker registration
│   ├── src/scraper.ts               undici → htmlparser2 SAX → CTE upsert
│   ├── src/metrics.ts               /metrics + event-loop-delay histogram
│   └── src/routes/{scrape,jobs,media}.ts
├── packages/web/                    React + Vite, served by nginx
├── db/migrations/                   Schema, indexes, counter trigger
└── tests/
    ├── load.k6.js                   5000-RPS burst + drain wait + custom report
    └── mock-server.mjs              Dynamic HTML fixture (img/video tags)
```

## Trade-offs (explicit non-goals)

- **JS-rendered pages**: not handled (no headless Chromium — won't fit in 1 GB shared with API + worker).
- **Per-host fairness**: not implemented; the realistic abuse pattern (same URL spammed) is collapsed by `jobId = sha1(url)`.
