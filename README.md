# Atlas Forge

A mobile map app that's part **Districtr** and part **world simulation game**, built on real Earth data.

- **Explore** – colour the world by hundreds of attributes: nations, population density, development, politics, terrain, climate, real 2026 country stats, 4,596 provinces, 3,221 US counties, relations between any two nations, your own formulas and hand-painted data layers.
- **Draw** – Districtr-style redistricting over ~345,000 world grid cells, any country's provinces, or US counties. Paint, erase, fill, lock, undo; live population deviation, contiguity, compactness and simulated election results. Plans decide seats when that country votes in the simulation.
- **Simulate** – a month-by-month world: population growth, development, diplomacy, alliances, wars with moving front lines, rebellions, coups, elections and disasters, with a news feed and per-nation history charts.
- **God mode** – paint borders, population, development, politics or terrain; create, rename, recolour, merge or dissolve nations; declare wars and make peace; drop meteors.

Worlds autosave, can be saved to slots, and exported/imported as `.atlas` files (saved to `Downloads/AtlasForge`).

## Getting the APK

Every push to `main` builds a signed APK with GitHub Actions and publishes it under **Releases** (`AtlasForge-v1.0.N.apk`). Each build is signed with the same key, so new versions install over old ones and keep your saves.

## Layout

- `app/src/main/assets/www/` – the app (plain ES modules, WebGL renderer, no dependencies)
  - `js/gl.js` map renderer · `js/sim.js` simulation · `js/plans.js` districts · `js/themes.js` map themes · `js/panels.js` UI
  - `data/` – prebuilt world grid (1440×720 cells at 0.25°), province/county geometry, cities
- `app/src/main/java/.../MainActivity.java` – WebView shell (serves the assets, file save/import, back button)
- `tools/build-data.mjs` – regenerates `data/` from Natural Earth and US Census files

## Data

Natural Earth (public domain): countries, provinces, populated places, lakes, rivers, glaciers, physical regions. US county boundaries and population: US Census Bureau (via plotly/datasets). Cell-level population is modelled from country totals, cities and terrain, and rescaled to real county totals inside the US.
