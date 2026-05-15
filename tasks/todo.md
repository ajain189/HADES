# Phase 6 — Demo website (static, canned-mission replay)

Source of truth: `docs/plans/2026-06-23-hades-implementation-plan.md` lines 523-558.
Wire contract: `hades.ws.schema` (`ContactRecord` + `DetectionMessage`) mirrored in `ui/src/types/wire.ts`.
**No-commit rule in force.** TDD per task. Auto-adversarial folded (4-panel, below).

## Adversarial panel resolutions (folded into the tasks below)

Four lenses ran before any code (red-team / simplicity / demo-craft / static-deploy). High-consensus
calls baked in:

- **R0 (demo content — demo-craft + red-team):** Do NOT bake from `clip_2s` (position-only `.srt`
  → every contact is CUE_ONLY/null → an EMPTY map, the one thing the demo exists to show). Instead
  drive the REAL pipeline (`Projector` + `Fuser`) with the EXISTING P4 simulator (`locate/geom_sim.py`
  `StraightPass`/`OrbitPath` emit full-attitude `Pose`s; `world_to_pixel` gives ground-truth detection
  pixels). Result: pins/ellipses/R95 are GENUINE localizer output against KNOWN ground truth, and we
  can report the REAL median meter-error. This honors "bake from a real run" via "bake from a real
  *pipeline* run on a valid synthetic scene." NEVER hand-author coordinates.
- **R1 (frame_id join — red-team, the silent killer):** `VideoPanel` draws a box only when
  `det.frame_id === frame.frame_id`. `useRealService` uses a LOCAL counter (`id = frameId++`), which
  only works because the live channel is lockstep. The baked frame record MUST carry its REAL wire
  `frame_id`, and the file-source MUST emit that id (like `useMockMission`/`MockWsServer`, which is
  id-keyed) — NOT a local counter. Test asserts ≥1 frame actually draws a box.
- **R2 (reuse, not reinvent — simplicity):** Do NOT write a new `file-mission-source.ts` class. The
  baked file is `{frames, json}` in the exact shape `MockWsConfig` already consumes. The file-source
  is: `fetch(mission.json)` → feed an existing `MockWsServer` → reuse `useMockMission`'s store wiring
  + stub command handlers verbatim. Promote→fuse already degrades to a mission-log note (`commandSink`);
  keep it (no dead button). LINK-LOST: drive from the baked timeline, not a fake socket drop.
- **R3 (build target — simplicity + static-deploy):** ONE vite config, `mode === "web"` drops the
  Electron plugin + outputs to `dist-web/`. KEEP `base: "./"` (relative URLs work on GH-Pages subpath
  + Netlify/Vercel root + `file://`; `/HADES/` would break the latter two). Baked data → `ui/public/`
  (plan's `web-demo/` is a phantom; only `ui/public/` gets bundled). Fetch RELATIVE (`mission.json`,
  never `/mission.json`). Frames inline (base64) → one fetch, no per-frame asset path math; `VideoPanel`
  already Blob/objectURLs the bytes.
- **R4 (null survives round-trip — red-team):** serialize contacts via pydantic `model_dump()` ONLY
  (never a hand dict that defaults to 0.0); assert no NaN/Inf (invalid JSON → detonates `JSON.parse`);
  assert null stays null. Plus a TS-side test that drives the REAL baked `mission.json` through
  `wire.ts` → store to the expected end-state (closes Python↔TS drift; pydantic round-trip alone is
  necessary-not-sufficient).
- **R5 (honest banner — demo-craft):** top-edge full-width strip in `--st-stale` violet-slate (NOT
  magenta — a demo is an epistemic caveat, not a system failure). States exactly which numbers are
  real (localizer output) vs scripted (scene/pose), + "no live feed." Median meter-error in the banner
  turns the caveat into a flex. `[details]` provenance note: synthetic scene, real pipeline, real
  footage arrives later.
- **R6 (basemap — static-deploy):** default = the existing offline charcoal basemap (honest +
  zero-risk; telemetry/track/coverage layers give the canvas content). Baked PMTiles = OPTIONAL polish
  (Range-requests work on GH-Pages/Netlify/Vercel), deferred unless cheap. Keep `glyphs` omitted /
  no symbol layers (MapLibre `Style._load` rejects `glyphs: undefined`) — same as Electron.
- **R7 (deploy prep, user publishes — static-deploy):** lay down `.github/workflows/deploy-pages.yml`
  (`workflow_dispatch` + upload `ui/dist-web`) + `ui/public/.nojekyll`; user's one manual step =
  Settings → Pages → Source: GitHub Actions. We PREPARE; user commits/publishes (no-commit rule).
- **Phase-7 watch-item (note only):** no router today → no GH-Pages 404.html shim needed now. If P7
  adds a `/docs` route, deep-link refresh 404s on Pages; fix then with a `404.html` SPA fallback.

## Tasks

- [x] **6.1 Bake a real-pipeline mission → `ui/public/mission.json`.** New
      `service/src/hades/cli/record_mission.py` (+ entry `hades-record-mission`). Build a synthetic
      multi-survivor scene with FULL attitude via `locate/geom_sim.py` (`StraightPass`/`OrbitPath`);
      run it through the REAL `Projector` + `Fuser` (reuse `ServiceLoop`'s assembly where possible) to
      emit genuine `ContactRecord`s (located, with real R95/ellipse) + per-frame `DetectionMessage`s +
      one representative baked JPEG (looped, base64) + a baked LINK-LOST timeline event + a baked
      "refined" record for the promote demo. Include a `provenance` block (scene synthetic / pipeline
      real / median meter-error vs known truth / generated-at, passed in — NO `Date.now()` baked
      nondeterministically). Mix MUST include: a refining PINPOINT, a SWEEP, and one honest CUE_ONLY
      (null coord). Serialize via pydantic `model_dump()`.
      **TDD:** failing test → (a) round-trips through `hades.ws.schema` both ways; (b) the CUE_ONLY
      contact's lat/lon are `None` and stay `None`; (c) NO NaN/Inf anywhere; (d) at least one located
      contact has non-null lat/lon AND a finite R95; (e) every `frame_id` on a JSON record has a
      matching frame in `frames`.
- [x] **6.2 Browser file-mission source (reuse MockWsServer).** Make `useMockMission` (or a thin
      `useFileMission` sibling) `fetch(`${import.meta.env.BASE_URL}mission.json`)`, fall back to
      `cannedMission()` if absent, and feed the EXISTING `MockWsServer` — frames emit their REAL baked
      `frame_id` (R1), promote→log + no fake LINK-LOST (R2). Surface `provenance` to a store so the
      banner can read it.
      **TDD (vitest):** failing test → loads a fixture `mission.json`, drives the real `wire.ts` → store
      ingestion, asserts end-state: N contacts incl one null-coord CUE_ONLY, ≥1 frame whose
      `det.frame_id === frame.frame_id` (a box draws), banner provenance populated.
- [x] **6.3 Web build target (no Electron) + Playwright in a plain browser.** `vite.config.ts`:
      `defineConfig(({mode}) => ({ base:"./", plugins:[react(), ...(mode==="web"?[]:[electron(...)])],
      build:{ outDir: mode==="web"?"dist-web":"dist", emptyOutDir:true }}))`; add
      `"build:web": "tsc --noEmit && vite build --mode web"`. Demo-mode banner component (R5) using
      DESIGN-SYSTEM tokens; gracefully degrade live-only affordances (R2). Create `ui/public/` +
      `.nojekyll`.
      **TDD (Playwright, plain chromium, served over http NOT file://):** `pnpm build:web` produces a
      static bundle; serving it loads the demo, plays the canned mission, map plots a real located pin,
      list/video/selection-spine all work against the baked data, demo banner visible.
- [x] **6.4 Deploy prep + README hand-off.** Lay down `.github/workflows/deploy-pages.yml`
      (`workflow_dispatch` + push paths-filter; build `ui` → upload `ui/dist-web` → deploy-pages) with a
      header comment naming the one manual step (Settings → Pages → Source: GitHub Actions). README:
      demo-link placeholder + screenshot/GIF slot. **NOTE:** deploy+commit are the user's to do
      (no-commit rule) — prepare everything, hand off the publish step.

## External review (green check)
- gstack **`/qa`** on the served static site (canned mission plays + flows work in a plain browser).
  No Codex (reuses P5's already-reviewed UI). Then TRIAGE → FIX → RE-VERIFY per external-review-policy.

## Green criterion (phase done)
A static website builds and runs in a plain browser, replays a real-pipeline canned mission through the
full coordinator UI (REAL located pins + honest uncertainty + an honest CUE_ONLY + a baked LINK-LOST
moment), clearly labeled demo mode with honest provenance; deploy workflow + README slot prepared for
the user to publish.

> **STOP after P6 — do NOT roll into P7.** P7 (documentation) is the capstone; the USER initiates it.

## Review — PHASE 6 COMPLETE

**Tests:** UI 208 vitest (+12 from P5's 196: data layer 7, DemoBanner 4, MapView-WebGL 1) + 5
functional Playwright (e2e-coordinate ×2, latency, smoke, web-demo) all green; service 52 relevant
tests green (record_mission 10 + schema/fuse/loop). Typecheck clean, both Electron `dist/` and web
`dist-web/` builds clean, ruff clean.

**Built (all uncommitted, no-commit rule):**
- `service/src/hades/cli/record_mission.py` + entry `hades-record-mission` — bakes
  `ui/public/mission.json` by driving the REAL `Fuser` over full-attitude `geom_sim` poses
  (OrbitPath PINPOINT + StraightPass SWEEP, noisy `pose_meas`/`pixel_meas` path) against KNOWN
  ground truth. Genuine located contacts (median loc error 1.1 m, reported in provenance) + a
  honest CUE_ONLY + scripted LINK-LOST window + a refined-promote record. One shared base64 still
  (56 KB file). `service/tests/test_record_mission.py` (10 tests).
- `ui/src/data/mission.ts` (loader: base64→Uint8Array, relative `${BASE_URL}` fetch) +
  `ui/src/data/fileMission.ts` (`wireMission`/`useFileMission`: fetch → feed existing
  `MockWsServer`, real baked frame_id, LINK-LOST from timeline, promote swaps the refined record) +
  `ui/src/store/provenance.ts`. Tests: `mission.test.ts` (4, against the real artifact),
  `fileMission.test.ts` (3).
- `ui/src/components/DemoBanner.tsx` (violet-slate `--st-stale`, honest "which numbers are real",
  median error, `[details]` provenance toggle) + `DemoBanner.test.tsx` (4). Wired above the status
  strip in `App.tsx`; web-mode source selection (`import.meta.env.MODE === "web"`).
- `ui/vite.config.ts` mode-gated (web drops Electron plugin → `dist-web/`, keeps `base:"./"`);
  `build:web` script; `ui/public/.nojekyll`. `tests/web-demo.spec.ts` (served `dist-web/` over http
  in plain chromium).
- `.github/workflows/deploy-pages.yml` (workflow_dispatch + push paths-filter; one manual step
  documented). `README.md` (logo, demo-link slot, screenshot, run + publish instructions).
- `docs/assets/p6/demo-site.png` reference screenshot.

**External review (gstack /qa) — acted on, not just run:** the /qa pass (WebGL-less headless
browser) caught a CRITICAL: the whole app white-screened with no WebGL, because `MapView`'s
`new maplibregl.Map()` throw unmounted the entire React tree. TRIAGED valid-fix-now → FIXED via TDD
(`MapView` catches the throw, renders an honest "map unavailable: WebGL" placeholder, rest of the
UI stays usable) → RE-VERIFIED in the same WebGL-less browser (app mounts: banner + 3 rows + video
+ placeholder). `MapView.webgl.test.tsx` locks it. Report in `.gstack/qa-reports/`.

**Deviations from plan (logged, all panel-driven):** (a) NOT baked from `clip_2s` (position-only
→ empty map) — baked a real-pipeline run on a valid synthetic scene instead (the honesty fix). (b)
No new `file-mission-source` CLASS — reused `MockWsServer` (the simplicity fix). (c) One vite
config, mode-gated (not a separate web config). (d) Frames inline-shared once, not per-frame or
per-file. (e) README is the Phase-6 hand-off slice (logo + demo link + run/publish); the full
metric-backed README is the P7 capstone.

**Also fixed (pre-existing, surfaced at the P6 close):** the stale P0-scaffold `smoke.spec.ts`
asserted a `<h1>HADES` heading the P5 UI never renders, and `firstWindow()` could catch a transient
`chrome-error://` page under suite load → updated to the real `status-strip` landmark + a
load-state/chrome-error recovery guard.

**Green criterion — ✅ ALL MET:** static site builds + runs in a plain browser (`dist-web/` over
http), replays a real-pipeline canned mission through the full coordinator UI (REAL located pins +
honest uncertainty + honest CUE_ONLY + scripted LINK-LOST), clearly labeled demo mode with honest
provenance (median error in the banner), deploy workflow + README prepared for the user to publish.

**NEXT:** STOP. Phase 7 (documentation capstone) is USER-INITIATED — do not auto-start it. When the
user says to start documentation, the publish step (commit + enable Pages + push) is theirs too
(no-commit rule).
