# KNOWN ISSUES

Updated: September 7, 2026

This file tracks active runtime issues only.

For the roadmap and open backlog, see the repository issue tracker.

---

## Open

### Street traffic can be slow/uneven when panning across dense city blocks
Status: Open (partially mitigated)

Context:
- Current traffic loader fetches one clamped viewport tile at a time (major pass, then full pass).
- In dense cores, some visible roads can appear late after city jumps or fast pans.
- Zooming into adjacent streets does not always immediately trigger higher-detail coverage for all visible roads.

Current mitigation in runtime:
- Fair per-road dot budget allocation (reduces hard starvation under global `MAX_DOTS` cap).
- Center-shift threshold (reduces stale overlap lock while panning).

Next iteration candidates:
- Prioritize currently visible road segments inside the active viewport before off-center segments.
- Add neighbor prefetch ring for nearby tiles after jump-to-city actions.
- Add adaptive dot cap by frame time (coverage first, density second).
- Promote sync chip from loading indicator to true multi-phase progress.

---

### Data layers are quiet within a few km of the antimeridian
Status: Open (partially mitigated)

Context:
- Overpass accepts one bounding box per query and requires `west < east`, so a
  box straddling +-180 cannot be expressed as a single query. The traffic and
  annotation layers therefore have no roads to draw when the camera sits
  within roughly half a viewport of the date line (Taveuni and Vanua Levu in
  Fiji, Wrangel Island, the Chukotka/Alaska corridor).

Fixed as of this entry (was much worse):
- `clampBoundsAroundCenter` took a raw `east - west` span, which is a large
  NEGATIVE number for a Cesium rectangle crossing +-180. The fetch box came
  back inverted and ~360 degrees wide with out-of-range longitudes, and the
  proxy's bbox guard rejected it. `getBoundsCenter` averaged west and east,
  which lands on the ANTIPODE for the same rectangles.
- Six copies of an equirectangular distance helper measured the long way round
  across the date line (179E to 179W read as ~39,800 km rather than ~220 km),
  so the aircraft ground-floor clamp, the mesh-floor probe and voice "nearest"
  selection all silently failed their proximity gates near +-180. All six now
  share `src/data/approxDistance.js`.

Next iteration candidate:
- Split a straddling viewport into two bounded queries (west..180 and
  -180..east) and merge the results, rather than declining to fetch.

Validation target:
- `src/data/trafficBounds.js`, `src/data/approxDistance.js`

---

### Height-datum residuals (branch `feat/height-datum`, pending merge)
Status: Open (owner-accepted 2026-07-08, documented)

- **Cold-start floor latency:** at a freshly-visited airport, grounded/low aircraft
  float low for ~1–2 poll cycles (30–60 s) and rise as terrain floors resolve;
  a few stragglers take one more poll.
- **Born-grounded first poll:** a contact first seen on the ground with no altitude
  data renders at the geoid for ≤1 poll until its floor cell warms.
- Full context, improvement ideas, and the verification oracle
  (`scripts/qa-floor-verify.mjs`):
  `docs/superpowers/reports/2026-07-08-height-datum-handover.md`.

---

## Closed / Intentional (for clarity)

### Proxy SSRF and error-surface hardening gaps
Status: Closed as fixed on `main`

Context:
- Proxy middleware previously allowed broader error/internal surface area and looser upstream handling.
- Current `main` includes hardened proxy behavior in `vite.config.js`:
  - CCTV upstream URL no longer accepted from client query params.
  - Error payloads are sanitized.
  - OpenSky cache stores successful responses only.
  - OpenSky token refresh is coalesced.
  - GBFS/CCTV memory growth is bounded.

Validation target:
- `vite.config.js`

---

### CCTV panel could restore off-screen after layout refactors
Status: Closed as fixed on `main`

Context:
- Panel positions persist in local storage, and a position saved at one window
  size could restore off-screen at another (a panel was observed at x:-192).
  The documented workaround was to clear the keys from the browser console.

Current behavior:
- `_restorePanelPosition` clamps the restored position through
  `_clampToViewport` (6 px inset), the same clamp the drag handler applies, so
  a saved position can no longer land off-screen. No console workaround is
  needed.

Related keys (current versions):
- Panel positions: `godsEyeView.v7.panelPos.<panel-id>` (re-versioned 2026-06-10)
- Panel collapsed state: `godsEyeView.v6.panelCollapsed.<panel-id>`
- CCTV calibration: `godsEyeView.cctv.calibration.v2`

Validation target:
- `src/ui.js`

---

### NVG vignette edge color bleed
Status: Closed as fixed in current shader composite

Context:
- Earlier builds leaked original scene colors near the NVG tube edge.
- Current composite now masks NVG output with tube falloff before final blend, removing the color edge bleed.

Validation target:
- `src/styles/surveillance.js`

---

### Wildfires layer unavailable / static bundled snapshot
Status: Closed — live FIRMS integration shipped (2026-07-16)

Context:
- Wildfires (NASA FIRMS) were removed from runtime in v0.5.3, returned June 2026 as a
  bundled-snapshot layer (`local-firms`, 2026-05-25 data, ~58 MB in-repo), and were
  converted to **live NASA FIRMS data** on 2026-07-16: the `/api/firms` proxy merges
  three VIIRS NRT sources (trailing 24 h, 30 min cache, serve-stale-on-failure) and the
  bundled snapshot was deleted. Requires a free server-side `FIRMS_MAP_KEY`; without it
  the layer shows a KEY REQUIRED state.
- Weather radar is still held out of OSS v1 after QA found the previous overlay did not provide reliable visible value.
