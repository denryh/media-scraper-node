#!/bin/sh
# Generate loadtest/fixture-server/pages/page-{1..50}.html.
# Each page references:
#   - a shared image (/shared/logo.png) — exercises dedup across pages
#   - 4 page-unique images
#   - 1 page-unique video
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/pages"
mkdir -p "$DIR"

i=1
while [ $i -le 50 ]; do
  cat > "$DIR/page-$i.html" <<EOF
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>page $i</title></head>
<body>
  <h1>Page $i</h1>
  <img src="/shared/logo.png" alt="shared logo">
  <img src="/p$i/img-1.jpg" alt="page $i image 1">
  <img src="/p$i/img-2.jpg" alt="page $i image 2">
  <img src="/p$i/img-3.jpg" alt="page $i image 3">
  <img src="/p$i/img-4.jpg" alt="page $i image 4">
  <video><source src="/p$i/movie.mp4" type="video/mp4"></video>
</body></html>
EOF
  i=$((i + 1))
done

echo "wrote 50 pages to $DIR"
ls "$DIR" | grep -c '^page-' | xargs -I{} echo "  page-N.html count: {}"
