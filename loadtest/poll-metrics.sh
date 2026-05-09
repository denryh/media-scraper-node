#!/bin/sh
# Phase 8: 1 Hz sampler of /metrics → CSV. Output to stdout; redirect to file.
# Headers: time,rss_mb,heap_mb,el_p50,el_p99,el_max,wait,active,delayed,failed
set -e
BASE="${BASE_URL:-http://localhost:3001}"
DUR="${DURATION_S:-60}"

echo "time,rss_mb,heap_mb,el_p50,el_p99,el_max,wait,active,delayed,failed"
end=$(( $(date +%s) + DUR ))
while [ "$(date +%s)" -lt "$end" ]; do
  curl -s "$BASE/metrics" | jq -r '
    [
      now,
      .rss_mb, .heap_used_mb,
      .event_loop_delay_ms.p50, .event_loop_delay_ms.p99, .event_loop_delay_ms.max,
      .queue.waiting, .queue.active, .queue.delayed, .queue.failed
    ] | @csv
  '
  sleep 1
done
