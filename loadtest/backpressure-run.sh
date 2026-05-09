#!/bin/sh
# Orchestrates the backpressure test:
#   reset state → start /metrics sampler → run k6 → wait for drain → invariants.
#
# Knobs (env): RATE (120), DURATION (1m), DRAIN_TIMEOUT (300s).
# Output: loadtest/results/backpressure-{metrics.csv,summary.txt}
set -e
BASE_HOST="${BASE_URL:-http://localhost:3001}"
DURATION_K6="${DURATION:-15s}"
RATE_K6="${RATE:-1200}"
DRAIN_TIMEOUT="${DRAIN_TIMEOUT:-120}"
RESULTS=loadtest/results
mkdir -p "$RESULTS"

echo "[1/5] cleaning state"
docker compose exec -T postgres psql -U postgres -d scraper -c \
  "delete from media_assets; delete from scrape_jobs;" > /dev/null
docker compose exec -T redis redis-cli FLUSHDB > /dev/null
curl -s -X POST "$BASE_HOST/metrics/reset" > /dev/null

echo "[2/5] starting /metrics sampler (1 Hz, background)"
DURATION_S=$((300)) BASE_URL="$BASE_HOST" \
  bash loadtest/poll-metrics.sh > "$RESULTS/backpressure-metrics.csv" &
POLL_PID=$!

echo "[3/5] running k6 (rate=${RATE_K6}/s, duration=${DURATION_K6})"
docker run --rm --network media-scraper-node_default \
  -v "$PWD/loadtest:/loadtest" \
  -e BASE_URL=http://app:3000 -e FIXTURE_URL=http://fixture \
  -e DURATION="$DURATION_K6" -e RATE="$RATE_K6" \
  grafana/k6 run --summary-trend-stats="med,p(95),p(99),max" \
  /loadtest/backpressure.k6.js 2>&1 | tee "$RESULTS/backpressure-summary.txt"

echo "[4/5] waiting for queue to drain (timeout ${DRAIN_TIMEOUT}s)"
deadline=$(( $(date +%s) + DRAIN_TIMEOUT ))
while :; do
  w=$(curl -s "$BASE_HOST/metrics" | jq '.queue.waiting + .queue.active + .queue.delayed')
  [ "$w" = "0" ] && break
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "  drain timeout: $w jobs still in queue"
    break
  fi
  printf "  draining... %s in queue\r" "$w"
  sleep 2
done
echo
sleep 2
kill $POLL_PID 2>/dev/null || true
wait $POLL_PID 2>/dev/null || true

echo "[5/5] invariants"
docker compose exec -T postgres psql -U postgres -d scraper <<'SQL'
\echo === jobs by status ===
select status, count(*) from scrape_jobs group by status order by 1;
\echo
\echo === counts + counter invariant ===
select
  (select count(*) from scrape_jobs)               as jobs_total,
  (select count(*) from media_assets)              as assets_total,
  (select count(*) from media_occurrences)         as occurrences_total,
  (select sum(occurrence_count) from media_assets) as sum_counter,
  (select bool_and(a.occurrence_count = (
     select count(*) from media_occurrences o where o.asset_id = a.id))
   from media_assets a)                            as counter_invariant_ok;
SQL

echo
echo "=== peaks from /metrics CSV ==="
echo "queue.waiting peaks:"
awk -F',' 'NR>1 {print $7}' "$RESULTS/backpressure-metrics.csv" | sort -gr | head -3 | sed 's/^/  /'
echo "rss_mb peaks:"
awk -F',' 'NR>1 {print $2}' "$RESULTS/backpressure-metrics.csv" | sort -gr | head -3 | sed 's/^/  /'
echo "event_loop_delay_max peaks:"
awk -F',' 'NR>1 {print $6}' "$RESULTS/backpressure-metrics.csv" | sort -gr | head -3 | sed 's/^/  /'

echo
echo "metrics CSV: $RESULTS/backpressure-metrics.csv"
echo "k6 summary:  $RESULTS/backpressure-summary.txt"
