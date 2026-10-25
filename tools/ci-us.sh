#!/usr/bin/env bash
# Builds US census tracts and block groups (with 2020 population and race) for every state into
# app/src/main/assets/www/levels. Runs in CI after ci-levels.sh (needs internet and that script's earcut).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="${RAW:-$HOME/afraw}"
OUT="$ROOT/app/src/main/assets/www/levels"
US="$RAW/us"; mkdir -p "$US/tract" "$US/bg" "$US/vtd" "$US/pl" "$US/zip" "$US/elec"
FIPS="01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56 72"
GZ=https://www2.census.gov/geo/tiger/GENZ2020/shp
UA="Mozilla/5.0 (X11; Linux x86_64) AtlasForge-build"

get() { for k in 1 2 3 4; do curl -fsSL -A "$UA" --max-time 900 -o "$2" "$1" && return 0; sleep $((k * 4)); done; return 1; }

echo "== boundaries"
for kind in tract bg; do
  if ls "$US/$kind"/*.shp >/dev/null 2>&1; then continue; fi
  if get "$GZ/cb_2020_us_${kind}_500k.zip" "$US/zip/us_$kind.zip"; then
    unzip -oq "$US/zip/us_$kind.zip" -d "$US/$kind"
  else
    echo "national $kind file unavailable, fetching per state"
    for f in $FIPS; do get "$GZ/cb_2020_${f}_${kind}_500k.zip" "$US/zip/${f}_$kind.zip" && unzip -oq "$US/zip/${f}_$kind.zip" -d "$US/$kind" || echo "FAIL $kind $f"; done
  fi
  echo "$kind: $(ls "$US/$kind"/*.shp 2>/dev/null | wc -l) shapefile(s)"
done

echo "== population (2020 redistricting data)"
VARS="P1_001N,P2_002N,P2_005N,P2_006N,P2_007N,P2_008N,P3_001N,P4_002N,P4_005N,P4_006N,P4_007N,P4_008N"
API=https://api.census.gov/data/2020/dec/pl
KEYQ=""; [ -n "${CENSUS_API_KEY:-}" ] && KEYQ="&key=$CENSUS_API_KEY"
okjson() { [ -s "$1" ] && head -c 3 "$1" | grep -q '^\[\["'; }
# show what the API says once, so a failure is diagnosable from the log
code=$(curl -sS -A "$UA" --max-time 60 -o "$US/probe.txt" -w '%{http_code}' "$API?get=P1_001N&for=state:01$KEYQ" 2>&1); echo "API probe: HTTP $code: $(head -c 300 "$US/probe.txt" 2>/dev/null)"
if [ "${code:0:3}" = "200" ]; then
  for f in $FIPS; do
    t="$US/pl/tract_$f.json"; b="$US/pl/bg_$f.json"
    okjson "$t" || { get "$API?get=$VARS&for=tract:*&in=state:$f$KEYQ" "$t"; okjson "$t" || echo "FAIL pl tract $f"; }
    if ! okjson "$b"; then
      for q in "for=block%20group:*&in=state:$f&in=county:*&in=tract:*" "for=block%20group:*&in=state:$f%20county:*%20tract:*" "for=block%20group:*&in=state:$f%20county:*"; do
        get "$API?get=$VARS&$q$KEYQ" "$b" && okjson "$b" && break
      done
      okjson "$b" || echo "FAIL pl bg $f"
    fi
    sleep 0.3
  done
fi
# no API access: read the published PL 94-171 summary files, one state at a time
PLURL=https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171
STATES="01:Alabama:al 02:Alaska:ak 04:Arizona:az 05:Arkansas:ar 06:California:ca 08:Colorado:co 09:Connecticut:ct 10:Delaware:de 11:District_of_Columbia:dc 12:Florida:fl 13:Georgia:ga 15:Hawaii:hi 16:Idaho:id 17:Illinois:il 18:Indiana:in 19:Iowa:ia 20:Kansas:ks 21:Kentucky:ky 22:Louisiana:la 23:Maine:me 24:Maryland:md 25:Massachusetts:ma 26:Michigan:mi 27:Minnesota:mn 28:Mississippi:ms 29:Missouri:mo 30:Montana:mt 31:Nebraska:ne 32:Nevada:nv 33:New_Hampshire:nh 34:New_Jersey:nj 35:New_Mexico:nm 36:New_York:ny 37:North_Carolina:nc 38:North_Dakota:nd 39:Ohio:oh 40:Oklahoma:ok 41:Oregon:or 42:Pennsylvania:pa 44:Rhode_Island:ri 45:South_Carolina:sc 46:South_Dakota:sd 47:Tennessee:tn 48:Texas:tx 49:Utah:ut 50:Vermont:vt 51:Virginia:va 53:Washington:wa 54:West_Virginia:wv 55:Wisconsin:wi 56:Wyoming:wy 72:Puerto_Rico:pr"
for e in $STATES; do
  IFS=: read -r f name ab <<< "$e"
  okjson "$US/pl/tract_$f.json" && okjson "$US/pl/bg_$f.json" && okjson "$US/pl/vtd_$f.json" && continue
  z="$US/zip/pl_$ab.zip"; d="$US/plx_$ab"
  if get "$PLURL/$name/${ab}2020.pl.zip" "$z"; then
    rm -rf "$d"; mkdir -p "$d"
    unzip -oq "$z" '*geo2020.pl' '*000012020.pl' '*000022020.pl' -d "$d" && node --max-old-space-size=6000 "$ROOT/tools/pl-from-files.mjs" "$d" "$f" "$US/pl" || echo "FAIL pl files $ab"
    rm -rf "$d" "$z"
  else echo "FAIL download $PLURL/$name/${ab}2020.pl.zip"; fi
done
echo "pl files ok: $(for x in "$US"/pl/*.json; do okjson "$x" && echo .; done | wc -l)"

echo "== voting districts (TIGER 2020)"
VTDURL=https://www2.census.gov/geo/tiger/TIGER2020PL/LAYER/VTD/2020
for f in $FIPS; do
  ls "$US/vtd"/tl_2020_${f}_vtd20.shp >/dev/null 2>&1 && continue
  if get "$VTDURL/tl_2020_${f}_vtd20.zip" "$US/zip/vtd_$f.zip"; then unzip -oq "$US/zip/vtd_$f.zip" -d "$US/vtd" && rm -f "$US/zip/vtd_$f.zip"; else echo "FAIL vtd $f"; fi
done
echo "vtd: $(ls "$US/vtd"/*.shp 2>/dev/null | wc -l) state files"

echo "== county presidential results"
for repo in US_County_Level_Election_Results_08-24 US_County_Level_Election_Results_08-20; do
  for y in 2024 2020 2016; do
    [ -s "$US/elec/${y}_US_County_Level_Presidential_Results.csv" ] && continue
    for br in master main; do
      curl -fsSL --max-time 120 -o "$US/elec/${y}_US_County_Level_Presidential_Results.csv" "https://raw.githubusercontent.com/tonmcg/$repo/$br/${y}_US_County_Level_Presidential_Results.csv" && break || rm -f "$US/elec/${y}_US_County_Level_Presidential_Results.csv"
    done
  done
done
ls -la "$US/elec"

echo "== tract, block group and voting district packs"
node --max-old-space-size=12000 "$ROOT/tools/build-us.mjs" "$RAW/earcut/src/earcut.js" "$US/tract" "$US/bg" "$US/pl" "$OUT" "$RAW/fpop.bin" "$US/vtd" "$US/elec"
echo "levels now: $(ls "$OUT" | wc -l) files, $(du -sh "$OUT" | cut -f1)"
# succeed only when both US levels made it in (so CI does not cache a partial build)
node -e 'const m=require(process.argv[1]);const u=m.filter(x=>x.iso==="USA"&&x.byState);process.exit(u.length>=2&&u.every(x=>x.parts.filter(p=>p.pop>0).length>=50)?0:1)' "$OUT/levels.json"
