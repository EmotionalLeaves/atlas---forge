# Atlas Forge

A mobile map app that's part **Districtr** and part **world simulation game**, built on real Earth data.

- **Explore** – colour the world by hundreds of attributes: nations, population density, development, politics, terrain, climate, real 2026 country stats, 4,596 provinces, 3,221 US counties, relations between any two nations, your own formulas and hand-painted data layers.
- **Draw** – Districtr-style redistricting. Use **real US precincts for 28 states** (71,895 precincts with 2010 Census population/race, real precinct election results, and real enacted/proposed district maps from MGGG States), or draw anywhere on Earth from ~345,000 grid cells, provinces, or US counties. Paint (or paint whole counties/states), erase, fill, lock, undo; population balance bars, contiguity, compactness (Polsby-Popper), county splits, demographics, efficiency gap and mean-median, votes vs seats; CSV import/export and JSON reports. World plans decide seats when that country votes in the simulation.
- **Simulate** – a month-by-month world: population growth, development, diplomacy, alliances, wars with moving front lines, rebellions, coups, elections and disasters, with a news feed and per-nation history charts.
- **God mode** – paint borders, population, development, politics or terrain; create, rename, recolour, merge or dissolve nations; declare wars and make peace; drop meteors.

Real base maps (Esri streets, light, dark, satellite, topographic — no API keys) sit under the data, with a built-in offline map as fallback.

Worlds autosave, can be saved to slots, and exported/imported as `.atlas` files (saved to `Downloads/AtlasForge`).

## Getting the APK

Every push to `main` builds a signed APK with GitHub Actions and publishes it under **Releases** (`AtlasForge-v1.0.N.apk`). Each build is signed with the same key, so new versions install over old ones and keep your saves.

## Layout

- `app/src/main/assets/www/` – the app (plain ES modules, WebGL renderer, no dependencies)
  - `js/gl.js` map renderer · `js/sim.js` simulation · `js/plans.js` districts · `js/themes.js` map themes · `js/panels.js` UI
  - `data/` – prebuilt world grid (1440×720 cells at 0.25°), province/county geometry, cities
- `app/src/main/java/.../MainActivity.java` – WebView shell (serves the assets, file save/import, back button)
- `tools/build-data.mjs` – regenerates `data/` from Natural Earth and US Census files
- `tools/build-precincts.mjs` – converts an MGGG precinct shapefile into a `packs/XX.afp.gz` precinct pack (downloaded by the app on demand from this repo, then cached on the phone)

## Data

Precinct packs: MGGG States (github.com/mggg-states) — precinct boundaries, 2010 Census demographics, precinct-level election results and district plans.

Natural Earth (public domain): countries, provinces, populated places, lakes, rivers, glaciers, physical regions. US county boundaries and population: US Census Bureau (via plotly/datasets). Cell-level population is modelled from country totals, cities and terrain, and rescaled to real county totals inside the US.
