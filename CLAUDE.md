# HADES — Ground-Control Station

Desktop ground-control station for post-hurricane search-and-rescue: ingest a live
video feed from an FPV drone over a digital video link, run real-time human
detection on the frames, compute real-world survivor coordinates from each
detection, and present detections plus a live survivor map in a professional
coordinator UI. Quality bar: impressive and genuinely usable — between a demo and
a fielded tool.

## Working Agreements (read first)
- **Plan before code.** For any non-trivial task, propose a plan and wait for
  approval before writing code.
- **Ask, don't guess.** On ambiguous requirements, ask a clarifying question
  rather than assuming. State assumptions explicitly when you must make them.
- **Small phases.** Keep phases small and independently runnable; each verifiable
  on its own.
- **Subagents for research.** Run verbose research or codebase exploration in a
  subagent so it stays out of the main context window.
- **Docs are the source of truth**, not this file:
  - `docs/PLAN.md` — phases, milestones, current status.
  - `docs/DESIGN.md` — system design, data flow, decisions.
  - `docs/DESIGN-SYSTEM.md` — UI aesthetic spec, tokens, components.

## Runtime & Stack
- **Target:** Apple Silicon MacBook (M4/M5), macOS. No CUDA — inference uses Core ML.
- **Two processes over localhost:**
  - **Detection service (Python):** Ultralytics YOLO, OpenCV/PyAV ingest, Core ML
    inference. Owns capture → detect → georeference.
  - **UI shell (Electron + React + TypeScript + Vite):** Tailwind + shadcn/ui,
    Zustand store, MapLibre GL map. Electron (not Tauri) so the Playwright visual
    check runs on a paved road and the video path uses Chromium.
- **IPC:** two localhost WebSocket channels — one binary (JPEG frames), one JSON
  (detections/telemetry). Detections carry the `frame_id` they belong to so
  overlays align to the correct frame. Electron supervises the Python child.
- **Video ingest:** code against one `FrameSource` interface (live UVC capture,
  RTSP/UDP stream, or recorded file). PyAV + VideoToolbox HW decode; drop-to-latest,
  tolerate frame drops / mid-stream resolution changes / link loss.
- **Detection model:** YOLO11s, single `person` class, fine-tuned on HERIDAL+SARD.
  Exported to Core ML `.mlpackage`, FP16, ComputeUnits.all. **Input resolution = 960**
  (P2.5: recall peaks at 960 on the held-out HERIDAL test, ties 1280 within noise but with
  better precision, and clears ≥10fps by 6.3×; 1920 degrades). (SAHI tiling is an offline
  high-recall mode for metrics only — NOT the live path.)
- **Georeference:** monocular ray–ground intersection, flat-earth v1. Always emit
  an honest uncertainty radius — never a false-precision pin.
- **Telemetry ingest:** code against a `TelemetrySource` interface, time-synced to
  video by `frame_id`. Adapters: `CrsfSerialSource` (live, low-rate CRSF telemetry
  off the ELRS radio's USB-C serial port via pyserial — coarse, wider uncertainty)
  and `SrtFileSource` (replay O4 `.srt` sidecar against recorded video — high-rate,
  the validation path). Camera pitch = fixed O4 mount angle + airframe pitch.
- **Commands:** see the **## Commands** section below.

## Hard Constraints
- **Field-laptop target:** dev/perf baseline M4 Pro / 24 GB; **must stay functional
  on the floor: MacBook Air M4 / 16 GB.** Degrade processed-detection FPS, never the
  video. Design against throttled clocks (fanless Air throttles under sustained load).
- **Latency budget:** in-app glass-to-glass (frame on socket → painted with overlay
  + map pin) **≤ 120 ms, measured** (drone-link latency is excluded — it's outside
  the app). Video displays at full 30 fps; detection runs decoupled at ≥ 10 fps.
- **On-device only:** the detect → localize → display loop must run with the network
  off. No cloud inference, no runtime model/tile fetch, no telemetry phone-home.
  Allowed exceptions: pre-downloaded offline map tiles (PMTiles, cached before a
  mission); optional, user-triggered post-mission export when connectivity returns.

## Definition of Done (per pillar)

### Detection model + localization
Not done until ALL hold:
- Tests pass.
- Accuracy validated against a **labeled ground-truth set** — report
  precision/recall/mAP on the **HERIDAL test split** (anchor domain: HERIDAL + SARD;
  any VisDrone pretraining must be ablated and reported).
- Localization error reported in **meters** vs. known ground truth (median / mean /
  p90 / max, stratified by slant range and camera pitch).

### UI
Not done until ALL hold:
- Passes a **design review** against the aesthetic spec in `docs/DESIGN-SYSTEM.md`,
  with one reference screenshot per key view.
- Passes **functional Playwright happy-path tests** (assert DOM/behavior: connects,
  plots a detection at the right map coord, shows uncertainty) driven by a **mock WS
  server** with canned frames + detections so UI tests stay deterministic and offline.
- (v1.x) Automated visual-regression / pixel-diff across viewports — deferred from v1
  as a solo-maintenance sink; manual design review covers craft until then.

## When Compacting — always preserve
- List of modified files.
- Current phase (from `docs/PLAN.md`).
- Test commands.
- Validation metrics (detection mAP + localization error in meters).
- Any unresolved decisions.

## Architecture (module map)

Pipeline (each = one responsibility; detail in `docs/DESIGN.md`, design in
`docs/plans/2026-06-23-hades-design.md`):

`FrameSource → Detector → Tracker → Projector → Confirmation → Fuse+Quantify → UI`

- **FrameSource** — yields `(frame, timestamp, seq)`; one interface, swappable impls
  (synthetic, recorded file, live UVC). Drop-to-latest; tolerates drops/resize/link-loss.
- **TelemetrySource** — yields pose time-synced to frames by `frame_id`. Impls:
  `SrtFileSource` (replay, hi-rate), `CrsfSerialSource` (live, lo-rate). Stubbed live in v1.
- **Detector** — stateless `frame → Detection[]` (box, `person`, conf). Swappable
  Core ML weights. Knows nothing about time/survivors.
- **Tracker** — ByteTrack; persistent IDs; bridges 10→30fps. Ego-motion comp = image-GMC
  primary, telemetry refines.
- **Projector** — cheap per-detection ray→ground point (no Monte Carlo); lets Confirmation
  cluster in world space.
- **Confirmation** — track rule: persistence + confidence + world-clustering. NEVER gates
  visibility, only display priority.
- **Fuse+Quantify** (Localizer) — multi-frame average + Monte Carlo uncertainty on
  confirmed/promoted contacts. Emits the taskable contact record.
- **UI** — Electron/React; one Contact, three projections (map/video/list) over a global
  bidirectional selection model (built first). Mission log appends every event.
- **IPC** — two localhost WS channels: binary JPEG frames + JSON detections/telemetry,
  aligned by `frame_id`. Electron supervises the PyInstaller-bundled Python child.

## Commands

Target convention (the first build phase scaffolds these — not yet runnable):
- **Python service:** `uv run hades-service` · test `uv run pytest` · lint `uv run ruff check`
- **UI shell:** `pnpm dev` · test `pnpm test` (Playwright over mock-WS) · build `pnpm build`
- **App (Electron + service):** `pnpm start` · package `pnpm package`
- **Detection metrics:** `uv run hades-eval --set <heridal|curated>`
- **Localization sim/coverage:** `uv run hades-locsim`
<!-- TODO(tw0): revisit -->
