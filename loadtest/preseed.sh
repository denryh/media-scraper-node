#!/bin/sh
# Phase 8: pre-seed the worker with N scrapes of large.html so the worker is
# CPU-busy when the responsiveness test runs (otherwise the test is trivial).
# Each large.html is 4.26 MB / 60K img tags → multiple seconds of streaming
# parse + DB writes per job.
set -e
BASE="${BASE_URL:-http://localhost:3001}"
N="${1:-10}"

# Spread across a few unique paths so the queue actually has N distinct jobs
# (jobId = sha1(url) → identical URLs collapse into one).
i=0
while [ "$i" -lt "$N" ]; do
  curl -s -X POST "$BASE/scrape" \
    -H 'content-type: application/json' \
    -d "{\"urls\":[\"http://fixture/large.html?seed=$i\"]}" >/dev/null
  i=$((i + 1))
done

echo "preseeded $N large.html scrapes"
curl -s "$BASE/metrics" | jq '.queue'
