# Media Scraper — Implementation Plan

## Context

Home assignment for a Senior Backend role at Momos. The brief in `REQUIREMENTS.md` asks for: API that accepts an array of URLs, scrape image/video URLs, store in SQL, paginated + filterable React UI, Docker Compose, **handle ~5000 scraping requests concurrently on 1 CPU / 1 GB**, plus a load test.

**Constraint scope:** the 1 CPU / 1 GB applies to the entire backend — API and worker run in the **same Node process**. Postgres and Redis are external data services with their own modest sizing.

Two design imperatives derived from the constraint:

1. **Main thread never blocks for long.** The API and the worker share one event loop. Sync work proportional to page size (e.g. building a full DOM with cheerio, buffering response bodies) would stall API responses. Solution: streaming SAX parse, bounded concurrency, async I/O everywhere.
2. **Ingress is bounded at the edge.** "5000 concurrent requests × an array per request" is unbounded. Cap URLs/request and body size; the rest is async-enqueue.

---

## Architecture

```
┌─ constrained: 1 CPU / 1 GB ─────────────┐
│  Node process                           │      ┌──────────────┐
│   ┌─────────┐    ┌──────────────────┐   │◀────▶│  Postgres    │
│   │ Fastify │──▶│ BullMQ Worker     │   │      │  (jobs +     │
│   │ API     │    │ in-proc, concur=5 │   │      │   media)     │
│   │         │    │ undici +          │   │      └──────────────┘
│   │         │    │ htmlparser2 (SAX) │   │      ┌──────────────┐
│   └─────────┘    └──────────────────┘   │◀────▶│  Redis       │
└─────────────────────────────────────────┘      └──────────────┘
        ▲
        │ HTTP
   ┌────┴─────────┐
   │ React (nginx)│
   └──────────────┘
```

Core flow: `POST /scrape` validates, upserts `scrape_jobs` rows, enqueues, returns `202`. Worker (in-proc BullMQ) streams each URL through htmlparser2, batches extracted media into Postgres. `GET /media` serves the paginated, deduped, searchable grid.

---

## Tech stack

| Layer              | Choice                         | Why                                                           |
| ------------------ | ------------------------------ | ------------------------------------------------------------- |
| App (API + worker) | Node 20 + Fastify + TypeScript | One process, low overhead, AJV-compiled validation            |
| Queue              | BullMQ on Redis                | In-proc Worker, native dedup on `jobId`, retries, persistence |
| HTTP client        | undici                         | Fast, native streaming + abort                                |
| Parser             | htmlparser2 (SAX)              | Streaming events, no DOM allocation                           |
| DB                 | Postgres 16 + `pg_trgm`        | Trigram search; one row per unique media URL                  |
| Frontend           | React + Vite + TanStack Query  | Static-built, served by nginx                                 |
| Load test          | k6                             | Scriptable, low overhead                                      |
| Orchestration      | docker-compose                 | `app` capped at 1 CPU / 1 GB                                  |

---

## Repo layout

```
media-scraper-node/
├── docker-compose.yml
├── package.json                   # pnpm workspaces
├── packages/
│   ├── app/                       # CONSTRAINED: API + worker, one process
│   │   ├── src/server.ts
│   │   ├── src/routes/scrape.ts
│   │   ├── src/routes/media.ts
│   │   ├── src/scraper.ts         # fetch + SAX extract + persist
│   │   ├── src/queue.ts           # BullMQ Queue + Worker
│   │   ├── src/db.ts
│   │   └── Dockerfile
│   └── web/                       # React + Vite
│       ├── src/App.tsx
│       └── Dockerfile
├── db/migrations/001_init.sql
├── loadtest/
│   ├── burst.k6.js
│   ├── limits.k6.js
│   └── fixture-server/
└── README.md
```

---

## Data model — `db/migrations/001_init.sql`

A single image can appear on thousands of pages (logos, share-icons). Storing one row per `(job, url)` causes linear DB bloat and duplicate UI tiles. The model is **normalized**: one row per unique media URL (`media_assets`), one row per (asset, job) observation (`media_occurrences`).

```sql
create extension if not exists pg_trgm;

-- id is a deterministic hash of the URL → idempotency key.
create table scrape_jobs (
  id           text primary key,    -- sha1(url) hex
  url          text not null unique,
  status       text not null check (status in ('queued','running','done','failed')),
  attempts     smallint not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create table media_assets (
  id               bigserial primary key,
  media_url        text not null unique,
  media_type       text not null check (media_type in ('image','video')),
  occurrence_count integer not null default 0,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
create index on media_assets (media_type, id desc);
create index on media_assets using gin (media_url gin_trgm_ops);

create table media_occurrences (
  id          bigserial primary key,
  asset_id    bigint not null references media_assets(id) on delete cascade,
  job_id      text   not null references scrape_jobs(id)   on delete cascade,
  source_url  text   not null,
  alt_text    text,
  observed_at timestamptz not null default now(),
  unique (asset_id, job_id)
);
create index on media_occurrences using gin (alt_text gin_trgm_ops);

-- Counter is bumped from a trigger so it only fires on actual inserts.
-- ON CONFLICT DO NOTHING in the upsert below skips the trigger, so
-- intra-page duplicates and worker retries cannot drift the counter.
create function bump_occurrence_count() returns trigger as $$
begin
  update media_assets
     set occurrence_count = occurrence_count + 1, last_seen_at = now()
   where id = new.asset_id;
  return new;
end $$ language plpgsql;

create trigger trg_bump after insert on media_occurrences
  for each row execute function bump_occurrence_count();
```

### Per-page persist — single statement

```sql
with input as (
  select distinct on (media_url)        -- intra-page dedup; required to
         media_url, media_type, alt_text -- avoid "row affected twice" error
  from unnest($1::text[], $2::text[], $3::text[])
       as t(media_url, media_type, alt_text)
),
upserted as (
  insert into media_assets (media_url, media_type)
  select media_url, media_type from input
  on conflict (media_url) do update set media_url = excluded.media_url
  returning id, media_url
)
insert into media_occurrences (asset_id, job_id, source_url, alt_text)
select u.id, $4, $5, i.alt_text
from   upserted u join input i using (media_url)
on conflict (asset_id, job_id) do nothing;
```

One roundtrip per page. Counter consistency is the trigger's job — bumping it inside the upsert would drift on intra-page duplicates and retries.

---

## API contract

| Method | Path                               | Behavior                                                                                                                                                                   |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/scrape`                          | Body `{ urls: string[] }`. Validate: ≤ 100 URLs/req, body ≤ 16 KB, valid `http(s)` URLs. Upsert `scrape_jobs` rows + enqueue. Returns `202 { jobs: [{id, url}] }`.         |
| `GET`  | `/jobs/:id`                        | `{ id, url, status, occurrenceCount, error? }`                                                                                                                             |
| `GET`  | `/media?type=&q=&cursor=&limit=50` | Deduped assets, keyset paginated on `id desc`. `q` = trigram on `media_url` ∪ `alt_text` (via `EXISTS`). Item: `{ id, mediaUrl, mediaType, occurrenceCount, lastSeenAt }`. |
| `GET`  | `/healthz`                         | Liveness + queue depth                                                                                                                                                     |

Errors: `400` (validation), `413` (oversized body).

---

## Idempotency — `jobId = sha1(url)`

Same URL submitted N times must not produce N scrapes. Both layers dedup on the same deterministic ID:

- **DB**: `scrape_jobs.id = sha1(url)`. Insert with `ON CONFLICT (id) DO NOTHING`.
- **BullMQ**: `queue.add('scrape', { url }, { jobId })`. Native behavior: existing `jobId` → no-op.

`removeOnComplete: { age: 900 }` (15 min) auto-evicts completed BullMQ entries; after that, a re-submit creates a fresh job. No application TTL bookkeeping.

```ts
async function submit(urls: string[]) {
  const rows = urls.map((url) => ({ id: sha1Hex(url), url }));

  // Bulk insert; conflicting rows produce no return.
  const inserted = await pool.query(
    `insert into scrape_jobs (id, url, status)
     select * from unnest($1::text[], $2::text[]) as t(id, url), 'queued'
     on conflict (id) do nothing
     returning id`,
    [rows.map((r) => r.id), rows.map((r) => r.url)],
  );

  // Enqueue only the genuinely new ones; addBulk = one Redis round trip.
  const newIds = new Set(inserted.rows.map((r) => r.id));
  const newJobs = rows
    .filter((r) => newIds.has(r.id))
    .map((r) => ({
      name: "scrape",
      data: r,
      opts: { jobId: r.id, removeOnComplete: { age: 900 } },
    }));
  await queue.addBulk(newJobs);

  return rows.map((r) => ({ id: r.id, url: r.url }));
}
```

Single multi-row `INSERT` + single `addBulk` per request — sub-millisecond per URL on the API path.

---

## Scraper — streaming SAX pipeline

A naive `fetch → buffer body → cheerio.load → collect → bulk-insert` holds the entire body and full DOM (~3× source) in memory per job. At 5 MB content cap × concurrency 5 that's ~100 MB worker peak and a sync DOM-build that blocks the event loop. **The scraper is fully streaming instead.**

```
undici.stream(url)              ── readable byte stream
  │
  ▼
htmlparser2.WritableStream      ── SAX events, no DOM
  │   onopentag(img|video|source): push to extractBuffer
  │
  ▼
extractBuffer (≤ 50 items)      ── pause stream, await flush, resume
  │
  ▼
persist (CTE upsert)            ── one DB roundtrip
```

Per-job steps:

1. `undici.stream(url, { bodyTimeout: 10s, headersTimeout: 5s, maxRedirections: 3 })`.
2. Reject non-2xx, non-`text/html`, or `Content-Length > 5 MB`. Track bytes consumed; abort mid-stream if uncapped response exceeds the cap.
3. Pipe into `htmlparser2.WritableStream`. On each `<img>`/`<video>`/`<source>`: resolve URL relative to the page, drop `data:` URIs, push to extractBuffer.
4. When buffer hits 50 items: `pause()` the response stream, `await persist.flush(buffer.splice(0))`, `resume()`.
5. On stream end, final flush. Mark job `done`. On exception, BullMQ retries with backoff (3 attempts).

**Memory per job**: htmlparser2 state (< 8 KB) + Node chunk buffer (16 KB) + extractBuffer (~10 KB) ≈ **35 KB**, independent of page size. At concur=5: ~175 KB worker peak. A 50 MB page consumes the same memory as a 5 KB page.

---

## Main-thread hygiene

The hardest constraint is "API and worker share one event loop on 1 CPU." The design avoids EL-blocking work by keeping every step either async or microsecond-bounded.

| Operation                             | Where  | Cost            | Notes                                                          |
| ------------------------------------- | ------ | --------------- | -------------------------------------------------------------- |
| `POST /scrape` body parse + AJV       | API    | sub-ms          | Compiled validator; 16 KB cap                                  |
| `sha1(url)` × N URLs                  | API    | ~1 µs each      | OpenSSL native; 100 URLs ≈ 100 µs                              |
| Multi-row INSERT + `addBulk`          | API    | async I/O       | One round trip each, regardless of N                           |
| Response serialization                | API    | sub-ms          | Use `fast-json-stringify` schemas on hot routes                |
| `undici.stream`, network I/O          | Worker | async I/O       | libuv; never blocks                                            |
| htmlparser2 SAX `onopentag` callbacks | Worker | µs per callback | Per-chunk burst, but bounded by Node's 16 KB stream chunk size |
| `persist.flush`                       | Worker | async I/O       | Stream `pause`/`resume` provides backpressure                  |
| DB query for `GET /media`             | API    | async I/O       | Trigram + keyset; no in-process filtering                      |

**Escape hatch**: if profiling shows EL delay > 50 ms p99 on huge pages, route the htmlparser2 stream through a `worker_threads` pool. Designed for, not implemented unless needed.

---

## API edge limits (admission control)

Without these, "5000 concurrent × array per request" is unbounded. Two caps; their intersection bounds peak ingress.

| Cap                  | Value     | Mechanism                      | Rejection |
| -------------------- | --------- | ------------------------------ | --------- |
| Max URLs per request | **100**   | AJV `maxItems` in route schema | `400`     |
| Max request body     | **16 KB** | Fastify `bodyLimit: 16384`     | `413`     |

Worst-case ingress: 5000 connections × 16 KB = **80 MB raw**, ~150 MB parsed, transient. Comfortable in 1 GB.

A client with 5000 URLs chunks into ≥ 50 requests of ≤ 100. Two valid load-test shapes — 5000 × 1-URL (TCP-bound) and 50 × 100-URL (batch-bound) — both yield ~5000 jobs.

---

## Memory budget

| Container | Limit          | Notes                                                                          |
| --------- | -------------- | ------------------------------------------------------------------------------ |
| **app**   | 1 CPU / 1 GB   | The constraint. `--max-old-space-size=768` leaves headroom for sockets + libuv |
| postgres  | 512 MB / 1 CPU | `shared_buffers=128MB`                                                         |
| redis     | 128 MB         | `maxmemory 96mb`                                                               |
| web       | 64 MB          | nginx static                                                                   |

App peak: Node base (~70 MB) + 5000 keep-alive sockets (~150 MB) + bursty parsed bodies (~150 MB, GC'd in ms) + worker pipelines (~0.2 MB) + DB/Redis pools (~30 MB) → **target < 900 MB**, validated by the burst test.

---

## Frontend (`packages/web`)

Single page, minimal:

- Textarea (one URL per line) → `POST /scrape`.
- Deduped media grid via `GET /media`. Tile = thumbnail + "appears on N pages" badge.
- Filters: type dropdown (all / image / video), search box (debounced 300 ms).
- Infinite scroll via TanStack Query `useInfiniteQuery`.

Served by nginx in its own container, outside the 1 GB constraint.

---

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck: { test: pg_isready, interval: 5s }
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    command:
      [
        "redis-server",
        "--maxmemory",
        "96mb",
        "--maxmemory-policy",
        "noeviction",
      ]

  app:
    build: ./packages/app
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 1g } # the constraint
    environment:
      - NODE_OPTIONS=--max-old-space-size=768
      - WORKER_CONCURRENCY=5
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    ports: ["3000:3000"]

  web:
    build: ./packages/web
    ports: ["8080:80"]

volumes: { pgdata: {} }
```

Only `app` is hard-capped. `docker stats` during load tests verifies it stays within 1 CPU / 1 GB.

---

## Load test — `loadtest/`

**A. Burst (`burst.k6.js`)** — the requirement.

```
5000 VUs × 1 POST /scrape (1 URL each) ramped over 10 s, hold 30 s
SLO (app): p99 < 800 ms, 5xx == 0%, peak RSS < 900 MB, CPU ≤ 100%, queue drains.
```

p99 is 800 ms, not 500 ms, because the worker drains on the same CPU.

**B. Boundaries (`limits.k6.js`)** — proves the edge caps reject correctly.

```
- POST with 101 URLs   → 400
- POST with 17 KB body → 413
```

**Fixture server**: local nginx serving 50 static HTML pages (varying sizes; several share a common image so dedup is exercised). Removes external-network noise.

`loadtest/RESULTS.md` records: command run, k6 summary, `docker stats` snapshot at peak RSS, dedup ratio (`select count(*) from media_assets` vs `sum(occurrence_count)`).

---

## Implementation phases

| #   | Output                                                                                                                  | Est.  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | Skeleton: docker-compose brings up postgres / redis / app / web; `/healthz` ok; `app` container has 1 CPU / 1 GB cap    | 0.5 d |
| 2   | Migrations + `POST /scrape` (multi-row insert + `addBulk`, idempotent on `sha1(url)`) + `GET /jobs/:id` (worker stub)   | 0.5 d |
| 3   | In-proc Worker: undici + htmlparser2 SAX + bounded extractBuffer + CTE upsert; counter trigger                          | 1 d   |
| 4   | `GET /media` (type filter, trigram search, keyset pagination) + React UI (form, deduped grid, filters, infinite scroll) | 1 d   |
| 5   | k6 burst + boundaries + fixture server + `loadtest/RESULTS.md`                                                          | 0.5 d |
| 6   | Tune `WORKER_CONCURRENCY` / `--max-old-space-size` based on burst-test EL-delay + RSS                                   | 0.5 d |

**Total: ~4 days.**

---

## Verification

1. **Smoke**: `docker compose up -d`; `/healthz` returns 200; `docker inspect app` shows 1 GB cap.
2. **Functional**: POST a URL → poll `/jobs/:id` → status transitions → `GET /media` shows results.
3. **Dedup**: scrape several pages sharing a logo → `media_assets` has 1 row for the logo, `occurrence_count == page count`, `media_occurrences` rows == page count. Across all data, `occurrence_count` invariant holds: `count(media_occurrences where asset_id = X) == media_assets.occurrence_count`.
4. **Idempotency**: POST same URL 5×; only one `scrape_jobs` row, only one BullMQ job, all 5 responses share the same `id`.
5. **UI**: paste 10 URLs → grid populates → filter by type → search → infinite scroll.
6. **Boundaries**: `k6 run loadtest/limits.k6.js` → 400 + 413 fire correctly.
7. **Burst load**: `k6 run loadtest/burst.k6.js` with `docker stats app` open → p99 < 800 ms, 0 errors, RSS < 900 MB, CPU ≤ 100%, queue drains. Numbers captured in `loadtest/RESULTS.md`.

---

## Non-goals

- **JS-rendered pages**: no headless browser (Chromium ≈ 300 MB, won't fit).
- **Per-host fairness**: not implemented; the realistic abuse pattern (same URL spammed) is collapsed by `jobId = sha1(url)`.
- **Auth, distributed scaling, full observability stack**: out of scope. Architecture supports horizontal scale (multiple `app` containers) if needed.
