# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where to start

- `PLAN.md` — full design rationale (architecture, data model, API contract, scraper pipeline, main-thread hygiene). **Read this before changing the scraper, the schema, or the queue.**
- `README.md` — runbook, API surface, load-test commands.
- `loadtest/RESULTS.md` — actual measured numbers from the latest run (treat as the SLO baseline).

## Common commands

```sh
# One-time fixture generation (gitignored outputs)
bash loadtest/fixture-server/gen-pages.sh         # 50 small pages
bash loadtest/fixture-server/gen-large.sh         # 4.26 MB / 60K-tag stress page

# Install + build
pnpm install                                       # respects pnpm-lock.yaml
pnpm --filter app build                            # tsc -p tsconfig.json
pnpm --filter web build                            # vite build

# Bring stack up (rebuild on source changes)
docker compose up -d --build app                   # most common iteration
docker compose up -d --build                       # full rebuild

# Logs / DB / queue inspection
docker compose logs app --tail 30
docker compose exec -T postgres psql -U postgres -d scraper -c '<sql>'
docker compose exec -T redis redis-cli FLUSHDB

# Reset state for deterministic runs
docker compose exec -T postgres psql -U postgres -d scraper \
  -c "delete from media_assets; delete from scrape_jobs;"
docker compose exec -T redis redis-cli FLUSHDB
curl -s -X POST localhost:3001/metrics/reset       # clears event-loop histogram
```

There is **no test framework** — verification is via `k6` + `curl` + `psql`. Each phase in `~/.claude/plans/write-down-an-md-structured-emerson.md` has its own concrete verification gate.

### k6 must run inside the docker network

Running k6 from the macOS host crashes colima/lima's port-forward layer at thousands of concurrent connections. Always launch k6 as a sibling container:

```sh
docker run --rm --network media-scraper-node_default \
  -v "$PWD/loadtest:/loadtest" \
  -e BASE_URL=http://app:3000 -e FIXTURE_URL=http://fixture \
  grafana/k6 run /loadtest/burst.k6.js
```

The host port is **3001** (compose maps `3001:3000`); inside the docker network the app is `http://app:3000`.

## Architecture (the parts that span multiple files)

### One Node process, one event loop, one constraint

The `app` container is hard-capped at **1 CPU / 1 GB** (`docker-compose.yml`: `mem_limit`, `cpus`, `deploy.resources.limits` all set). The Fastify API and the BullMQ Worker run **in the same process** (`packages/app/src/server.ts` calls `startWorker()` from `queue.ts` before `app.listen`). This is intentional — two processes would double the runtime overhead and fight harder over the one CPU. Every design choice downstream flows from "the API and the worker share one event loop":

- `WORKER_CONCURRENCY=5` (low) — bounded so the worker doesn't starve the API.
- Streaming SAX scraper (no DOM build) — avoids long sync stalls during parse.
- Async I/O everywhere on the request path.
- `ulimits.nofile: 65536` on the `app` container — needed for the 5000-VU burst.

### Idempotency: `jobId = sha1(url)` at TWO layers

Both layers must be touched if you change the idempotency model:

1. **DB layer** (`scrape_jobs.id` is `text`, set to `sha1(url)`): see `routes/scrape.ts` — multi-row `INSERT … ON CONFLICT (id) DO NOTHING RETURNING id`. Conflicting rows produce no return.
2. **Queue layer**: `routes/scrape.ts` calls `addBulk` with `{ jobId, removeOnComplete: { age: JOB_FRESH_TTL_S } }`. BullMQ natively deduplicates on `jobId`. `removeOnComplete: { age: 900 }` provides 15-minute freshness expiry **with no application-side TTL bookkeeping**.

Only the DB rows whose `RETURNING id` came back are enqueued — never enqueue a row that conflicted, or you'll re-do work the previous job already finished.

### Counter consistency is the DB trigger's job, not the application's

`media_assets.occurrence_count` is bumped by `trg_bump` **AFTER INSERT on media_occurrences** (defined in `db/migrations/001_init.sql`). The CTE upsert in `packages/app/src/scraper.ts` ends with `INSERT … ON CONFLICT (asset_id, job_id) DO NOTHING` — when the conflict fires, no row is inserted, so the trigger does not run, so the counter does not move. This is what keeps the counter exact under three pathological cases:

- The same image referenced N times within one page (deduped by `DISTINCT ON (media_url)` in the input CTE).
- A worker retry re-runs the upsert (occurrence row exists → `DO NOTHING` → no bump).
- Multiple jobs reference the same asset (each successful insert bumps once → counter equals occurrence row count).

**Do not increment `occurrence_count` from application code.** Doing so re-introduces the drift bug we fixed; the schema invariant `occurrence_count == count(media_occurrences where asset_id = X)` must hold.

### Streaming SAX pipeline (`packages/app/src/scraper.ts`)

```
undici.stream(url)  →  htmlparser2.Parser  →  bounded extractBuffer (50)  →  CTE upsert
```

- `htmlparser2` (NOT cheerio). cheerio builds a full DOM (~3× source); using it would defeat the memory model.
- The `for await (const chunk of res.body)` loop with an `await flush()` inside provides **natural backpressure** — pulling the next chunk only happens after the DB write resolves. No explicit `stream.pause()/resume()`.
- Pre-flight checks abort cleanly with `await res.body.dump()` (NOT `body.destroy()` — destroy emits an unhandled `'error'` event that crashes the process; `dump()` drains and discards).
- `<source>` elements use a parent-tag stack to disambiguate `<picture>` (image) vs `<video>` (video).
- 5 MB content-length cap is checked twice: from the header pre-flight, and against bytes consumed mid-stream (for chunked responses with no length header).

Per-job RSS contribution is ~35 KB — independent of page size. A 4.5 MB / 60K-tag page produces the same memory footprint as a 5 KB page.

### Main-thread responsiveness verification

`/healthz` and `/metrics` are not just observability — they're the test apparatus:

- **`/healthz`** is a sync handler with no I/O. Used as a side-channel canary (a constant-rate pinger) during stress tests. Its tail latency = "how long the loop couldn't admit a request".
- **`/metrics`** exposes `event_loop_delay` percentiles (from `perf_hooks.monitorEventLoopDelay`) + RSS + BullMQ queue counts. Sampled at 1 Hz by `loadtest/poll-metrics.sh`.
- **`POST /metrics/reset`** clears the EL-delay histogram before a measurement window.

The two signals together decompose tail latency: if `/healthz` p99 jumps but `event_loop_delay.max` stays low, the cause is kernel TCP accept-queueing during a synchronization spike, not main-thread blocking.

## Operational gotchas

- **Migrations run automatically on app boot** (`packages/app/src/migrate.ts`). Adding a migration = drop a `NNN_*.sql` into `db/migrations/`; the runner picks it up in lex order and tracks applied names in a `migrations` table. To force a re-run, delete the row from `migrations`.
- **`media_assets.id` is `bigserial`** — sequence advances on every insert attempt, so even after `delete from media_assets` the next id won't be 1. Don't write tests that assume id 1.
- **`ioredis` requires the named import under NodeNext** (`import { Redis } from 'ioredis'`, not `import IORedis from 'ioredis'`). Default import is not constructable.
- **Fixture HTML pages are gitignored** (`page-*.html`, `large.html`). Generators must be run before tests will work; the README quickstart includes them.
- **`pnpm install` requires `--frozen-lockfile` in Dockerfiles** to avoid lockfile drift inside the image build.
- **Redis container is named `media-redis`** but its compose service name is `redis`. Use `docker compose exec redis ...` for compose commands, `docker exec media-redis ...` for direct.

## When making changes

| Change                          | Don't forget                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| New SQL migration               | Bump file number; the runner is order-sensitive. No down-migrations.                           |
| New scraper extraction rule     | Add a fixture HTML in `loadtest/fixture-server/pages/`; verify counter invariant after a run. |
| New env var                     | Add to `docker-compose.yml`'s `app.environment`, document default in PLAN.md.                  |
| New route                       | Register in `server.ts`; if it's hot-path, add a Fastify response schema for fast-json-stringify. |
| Touching the upsert SQL         | Re-verify the counter invariant: `bool_and(a.occurrence_count = (select count(*) from media_occurrences where asset_id=a.id))` must stay `true` across all data. |
| Changing `WORKER_CONCURRENCY`   | Re-run the responsiveness test (`loadtest/responsiveness.k6.js`) — higher concurrency raises EL-delay max. |
