#!/usr/bin/env bash
# Builds every admin level (ADM1–ADM5, all countries with open geoBoundaries data) into
# app/src/main/assets/www/levels. Runs in CI (needs internet); takes ~5 minutes and ~4 GB RAM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="${RAW:-$HOME/afraw}"
OUT="$ROOT/app/src/main/assets/www/levels"
GB_SHA=5c25134028196d43ce97b5071934fd0cfc92f09f
EARCUT_SHA=934e54d8bed85387330b7acaa5d2f5ba30a460a3
mkdir -p "$RAW/ne/geojson" "$RAW/plotly" "$RAW/topo"

get() { # url out
  for k in 1 2 3 4; do curl -fsSL --max-time 900 -o "$2" "$1" && return 0; echo "retry $1"; sleep $((k * 3)); done
  echo "FAILED $1"; return 1
}

echo "== sources"
NE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
for f in ne_10m_admin_0_countries ne_10m_admin_1_states_provinces ne_10m_geography_regions_polys ne_10m_lakes \
         ne_10m_populated_places_simple ne_50m_admin_0_countries ne_50m_glaciated_areas ne_50m_lakes ne_50m_rivers_lake_centerlines; do
  [ -s "$RAW/ne/geojson/$f.geojson" ] || get "$NE/$f.geojson" "$RAW/ne/geojson/$f.geojson"
done
PL=https://raw.githubusercontent.com/plotly/datasets/master
[ -s "$RAW/plotly/geojson-counties-fips.json" ] || get "$PL/geojson-counties-fips.json" "$RAW/plotly/geojson-counties-fips.json"
[ -s "$RAW/plotly/minoritymajority.csv" ] || get "$PL/minoritymajority.csv" "$RAW/plotly/minoritymajority.csv"
if [ ! -f "$RAW/earcut/src/earcut.js" ]; then
  rm -rf "$RAW/earcut"; git init -q "$RAW/earcut"
  git -C "$RAW/earcut" fetch -q --depth 1 https://github.com/mapbox/earcut "$EARCUT_SHA"
  git -C "$RAW/earcut" checkout -q FETCH_HEAD
fi

echo "== population raster"
node --max-old-space-size=8000 "$ROOT/tools/build-data.mjs" "$RAW" "$RAW/dataout" | tail -3

echo "== geoBoundaries ($(wc -l < "$ROOT/tools/gb-list.txt") files)"
export RAW GB_SHA
fetch_gb() {
  f="$1"; out="$RAW/topo/$(echo "$f" | tr '/' '_')"
  [ -s "$out" ] && head -c 40 "$out" | grep -q Topology && return 0
  for k in 1 2 3 4; do
    curl -fsSL --max-time 900 -o "$out" "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/$GB_SHA/releaseData/gbOpen/$f" \
      && head -c 40 "$out" | grep -q Topology && return 0
    sleep $((k * 3))
  done
  echo "FAIL $f"; rm -f "$out"
}
export -f fetch_gb
xargs -P 8 -I{} bash -c 'fetch_gb {}' < "$ROOT/tools/gb-list.txt"
echo "downloaded $(ls "$RAW/topo" | wc -l) files, $(du -sh "$RAW/topo" | cut -f1)"

echo "== level packs"
rm -rf "$OUT"; mkdir -p "$OUT"
node --max-old-space-size=12000 "$ROOT/tools/build-levels.mjs" "$RAW/earcut/src/earcut.js" "$RAW/topo" "$ROOT/tools/gb-meta.json" "$RAW/fpop.bin" "$OUT"
echo "levels: $(ls "$OUT" | wc -l) files, $(du -sh "$OUT" | cut -f1)"
