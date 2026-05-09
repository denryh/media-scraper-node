#!/bin/sh
# Generate loadtest/fixture-server/pages/large.html — a multi-MB HTML page
# packed with thousands of unique <img> tags. Used by Phase 3 to verify the
# streaming pipeline holds RSS flat regardless of page size.
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/pages"
mkdir -p "$DIR"
COUNT="${1:-60000}"
OUT="$DIR/large.html"

{
  echo '<!doctype html><html><head><meta charset="utf-8"><title>large</title></head><body>'
  awk -v n="$COUNT" 'BEGIN { for (i = 0; i < n; i++) printf "  <img src=\"/big/img-%07d.jpg\" alt=\"img-%07d-padding-text-here\">\n", i, i }'
  echo '</body></html>'
} > "$OUT"

bytes=$(wc -c < "$OUT")
echo "wrote $OUT  ($COUNT tags, $bytes bytes)"
