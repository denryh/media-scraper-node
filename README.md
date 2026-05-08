# Media Scraper

Async URL → image/video scraper. API + Worker run in a single Node process capped at **1 CPU / 1 GB**; Postgres and Redis are external data services. See `PLAN.md` for design rationale and `~/.claude/plans/write-down-an-md-structured-emerson.md` for the phased execution plan.

## Quickstart

```sh
# pnpm 10.x and Docker required
pnpm install
docker compose up -d --build

# Smoke (default host port 3001 to avoid clashing with common dev tools on 3000;
# override via APP_HOST_PORT=3000 docker compose up -d if free)
curl -s localhost:3001/healthz    # → { ok: true }
curl -sI localhost:8080 | head -1 # → HTTP/1.1 200 OK

# Inspect resource caps on the constrained component
docker inspect app --format '{{.HostConfig.Memory}}'    # 1073741824 (1 GB)
docker inspect app --format '{{.HostConfig.NanoCPUs}}'  # 1000000000 (1 CPU)
```

## Phases

| Phase | Status | Subject |
|-------|--------|---------|
| 0     | in progress | Repo skeleton + Compose stack |
| 1     | pending | DB schema + migration runner |
| 2     | pending | API ingest + idempotency + edge limits |
| 3     | pending | Streaming SAX scraper |
| 4     | pending | `GET /media` (filters + pagination) |
| 5     | pending | React UI |
| 6     | pending | k6 burst + boundaries load tests |
| 7     | pending | Tune + RESULTS.md |

Each phase is independently verifiable; see the phased plan for the per-phase verification gate.
