# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`PLAN.md` is the canonical design document — read it first for the rationale behind the constraint (1 CPU / 1 GB shared by API + worker), the streaming pipeline, and the data model.

## Commands

This is a pnpm 10 workspace. Node ≥ 20.

```sh
pnpm install
pnpm build                 # tsc -b across all packages

pnpm dev:app               # tsx watch packages/app/src/server.ts (needs PG + Redis reachable)
pnpm dev:web               # vite dev server (proxies /api → http://localhost:3000)

# Full stack (recommended for anything touching the worker)
docker compose up -d --build
# App on :3001 (override APP_HOST_PORT=3000), web on :8080.
# Postgres + Redis come up as deps; `app` is hard-capped at 1 CPU / 1 GB.

# Per-package builds
pnpm --filter app build    # → packages/app/dist
pnpm --filter web build    # → packages/web/dist (then served by nginx in the web image)
```

There is no test runner wired into pnpm scripts. The k6 script in `tests/load.k6.js` is run directly via the `k6` CLI (or grafana/k6 docker image) against a live stack.

## Architecture — what spans files

**One Node process owns both the API and the BullMQ worker.** `packages/app/src/server.ts` boots in this exact order — migrate → `startWorker()` → `app.listen()` — so route handlers never see an unmigrated DB and the worker is draining before the first request arrives. They share the event loop on a single CPU, which drives several decisions:

- **Streaming SAX, not DOM.** `packages/app/src/scraper.ts` pipes `undici.request` straight into `htmlparser2.Parser` with a 50-item extract buffer; on each chunk it `await`s `persist()` if the buffer fills (this is the backpressure point). Per-job RSS is ~35 KB regardless of page size. **Do not introduce cheerio or any DOM-building parser** — it would buffer entire pages and stall the API.
- **Bounded ingress at the edge.** `bodyLimit: 16 * 1024` on Fastify and `maxItems: 100` in the scrape body schema together cap worst-case in-flight memory. AJV-compiled validation lives in the route's `schema:` block, not in handlers.
- **Idempotency on `sha1(url)`.** `packages/app/src/routes/scrape.ts` derives `jobId = sha1(url)` and uses it both as the Postgres PK (`scrape_jobs.id`) and the BullMQ `jobId`. Multi-row `INSERT ... ON CONFLICT DO NOTHING RETURNING id` returns only the genuinely new rows; only those are passed to `queue.addBulk`. `removeOnComplete: { age: JOB_FRESH_TTL_S }` (default 900s) auto-evicts BullMQ entries — after that, a re-submit creates a fresh job. There is no application-level TTL bookkeeping; do not add one.

**Data model is normalized to dedupe by URL.** One row per unique media URL in `media_assets`, one row per `(asset, job)` observation in `media_occurrences`. The per-page persist (`scraper.ts:persist`) is one CTE that:

1. `SELECT DISTINCT ON (media_url)` — intra-page dedup. **Required**: without this the upsert errors with "row affected twice" and the trigger drifts.
2. Upserts into `media_assets` (`ON CONFLICT (media_url) DO UPDATE SET media_url = excluded.media_url` — a no-op rewrite that returns the row id either way).
3. Inserts into `media_occurrences` with `ON CONFLICT (asset_id, job_id) DO NOTHING`.

`occurrence_count` is bumped by an `AFTER INSERT` trigger on `media_occurrences` (`bump_occurrence_count` in `db/migrations/001_init.sql`). Bumping it inside the upsert would double-count on retries. **Do not denormalize this counter into the upsert path.**

**Migrations are baked in.** `packages/app/src/migrate.ts` runs on every boot, scanning `db/migrations/*.sql` lexicographically and tracking applied ones in a `migrations` table. Add new files as `00N_description.sql`; they run inside a single transaction each. The default migrations dir is resolved relative to the compiled `dist/` (`../../../db/migrations`), which is why the Dockerfile must copy the migrations directory into the image.

**Frontend talks to the app via `/api/*`.** In dev, `packages/web/vite.config.ts` proxies `/api → http://localhost:3000` (note: the dev app listens on 3000, while the docker stack publishes 3001 by default to avoid host conflicts). In prod, `packages/web/nginx.conf` proxies `/api → app:3000` inside the docker network. `packages/web/src/api.ts` always hits `/api` — keep it that way; do not embed absolute URLs.

## Conventions worth knowing

- **Module style**: `"type": "module"` in `packages/app`. TS imports use the `.js` extension (e.g. `from './queue.js'`) because that's what tsc-emitted ESM resolves at runtime — keep this even when adding new files.
- **Logger contract**: `startWorker` and `runMigrations` accept a structural `{ info, warn, error }` rather than a Fastify logger type, so they're testable without booting Fastify.
- **Metrics windows**: `/metrics` exposes `event_loop_delay_ms` from `perf_hooks.monitorEventLoopDelay()`. `POST /metrics/reset` zeroes the histogram — call it before a measurement window so prior warmup doesn't pollute percentiles.
- **Trigram search**: `q` filter on `GET /media` uses `ILIKE '%q%'` against `media_assets.media_url` and `EXISTS` against `media_occurrences.alt_text`, both backed by GIN trigram indexes (see `001_init.sql`). Do not switch to plain `LIKE` without a leading `%` — it would silently hit a different index plan.
- **Keyset pagination**: `GET /media` orders by `id DESC` with `id < $cursor`. Cursors are base64url-encoded ids. Do not introduce `OFFSET`.
- **Web UI**: Tailwind v4 via `@tailwindcss/vite`. Tokens go in `@theme {}` inside `src/index.css`. The native `<dialog>` element drives the modal — `MediaModal` syncs `showModal()`/`close()` from a `useEffect` against the `item` prop.

## Non-goals (don't add these)

JS-rendered pages (no headless browser), per-host rate limiting, auth, distributed workers, structured observability stack. The architecture supports horizontal scale by running multiple `app` containers, but it's not configured.
