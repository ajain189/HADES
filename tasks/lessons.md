# HADES — Lessons

Patterns captured to avoid repeating mistakes. Reviewed at session start.

## Toolchain / environment (Phase 0)
- **`pnpm` build-script allowlist moved in pnpm 11.** `pnpm.onlyBuiltDependencies` in
  `package.json` is IGNORED with a warning. Use `allowBuilds:` in `pnpm-workspace.yaml`
  (pnpm 11.9 auto-generates a template there on a blocked install). Without it, Electron's
  postinstall never runs → no Electron binary → `electron .` / Playwright `_electron`
  can't launch.
- **`uv` sidesteps a too-new system Python.** System `python3` was 3.14 (Ultralytics/
  coremltools don't support it). Pinning `requires-python = ">=3.11,<3.13"` let `uv sync`
  provision 3.12 automatically — don't fight the system interpreter, let uv pick.
- **vite-plugin-electron emits preload as `.mjs`, not `.js`.** Point `main.ts`'s
  `preload:` at `preload.mjs` or the bridge silently fails to load (a smoke test that only
  checks the window won't catch it).
- **Electron on CI (Ubuntu 24.04) needs system libs, not just `xvfb`.** `_electron.launch`
  runs the project's own Electron binary; `xvfb-run` gives a display but not `libnss3`/
  `libgbm1`/`libasound2t64`/GTK. Add an apt-get step (use the `t64` package names on 24.04).

## Process
- **"multi-agent check on every confirmation" = the design-review-workflow memory.** Before
  bringing the user any decision point, dispatch adversarial reviewers (distinct lenses),
  fold surviving critiques in myself, and surface ONLY genuine forks — not approvals. In
  Phase 0 this caught a real CI bug (Electron libs) AND that the coordinate spec was not
  implementable as written (3 silent-mirror-bug axes). Worth the spend on get-it-right-once
  reference docs.
- **A "skeleton" reference doc still deserves the adversarial pass when it's load-bearing.**
  The coordinate-conventions section is the cheapest place to prevent the highest-consequence
  bug class (lat/lng order, datum, radians/deg, image-axis origin, frame handedness). Don't
  treat "skeleton" as "low-stakes."

## Ingestion (Phase 1)
- **Pre-design adversarial panels paid off most where the synthetic fixture is blind.** A
  4-lens panel on the `Pose`/SRT design BEFORE coding caught that a 2-value `alt_datum`
  (HAE|MSL) forces `SrtFileSource` to *lie* (rel_alt is REL_TAKEOFF, neither) — which would
  silently disarm the §3.5 datum assert. Run the panel at the design fork, not after.
- **The post-batch code-review agent caught 8 real silent-wrong-value traps the green tests
  missed** (un-anchored `abs_alt` regex grabbing a vendor token; `abs_alt_valid=True` while
  value is None; duplicate-timestamp silent tie-break; interpolated pose carrying the wrong
  `seq`; ndarray-in-frozen-dataclass blowing up `hash`/`==`). Always run a completion review
  before declaring a phase done — "tests pass" ≠ "correct on real data."
- **Time-sync: align by TIMESTAMP-bracket interpolation, NOT list index and NOT a seq join.**
  Value-match is immune to the frame-count-vs-pose-count drift a positional `poses[i]` join
  suffers. The injectable `clock_offset` is the same knob the Monte Carlo samples — an offset
  of `k*dt+eps` shifts the bracket by `k` poses (the mandated time-sync-error test).
- **Zero-base the video clock to the first frame's PTS.** Real MP4/MOV carry a nonzero
  `start_time`/edit-list offset, but the `.srt` timecode always starts at 0 — without
  zero-basing, every frame silently mis-aligns to telemetry. (`clip_offset.mp4` fixture guards this.)
- **DJI O4 `.srt` carries NO attitude/gimbal fields and an unreliable `abs_alt`.** A Pose from
  SRT is position-only (roll/pitch/yaw None); use `rel_alt`/`REL_TAKEOFF`, flag `abs_alt`
  advisory. Never back-fill yaw with GPS course-over-ground (course ≠ heading — heading-limited).
- **Honest None-propagation everywhere:** any None interpolation endpoint → None output, never
  0/level/north; missing telemetry → `pose=None`+MISSING, never a silent default pose; no-GPS →
  flagged not dropped (dropping shifts frame alignment), never plotted as 0,0.
- **`except SystemExit: return exc.code or 2` is a bug** — argparse exits `SystemExit(0)` on
  `--help`/`--version`, and `0 or 2 == 2` turns success into an error. Handle `code is None`→0,
  `int`→as-is, `str`→2. (Codex review P2.)
- **"Empty sidecar raises" must also cover non-empty-but-no-parseable-blocks.** A corrupt/truncated
  `.srt` with blocks-but-zero-valid-poses silently looked like *missing* telemetry → validation ran
  blind. Raise when the parsed pose list is empty, not just when the file is. This does NOT conflict
  with "missing-GPS → flag don't drop": a valid-timecode block with no GPS still yields a flagged
  `gps_valid=False` pose (parseable); only a file with no parseable block at all raises. (Codex P2.)

## Latency spike (Phase 1.5)
- **coremltools 9.0 crashes the CoreML export on numpy 2.x.** Symptom: `TypeError: only
  0-dimensional arrays can be converted to Python scalars` deep in
  `coremltools/.../torch/ops.py::_cast` (`int(ndarray)`). numpy 2.x rejects scalar coercion
  of a 1-d size-1 array that numpy 1.x allowed; coremltools 9.0 hasn't caught up. **Fix:
  pin `numpy<2` in the `bench` group** (compatible with the core `numpy>=1.26`). This was
  the real root cause — NOT torch version (torch 2.7.1 ≠ 2.12.1 made no difference). Lesson:
  when a converter throws a numpy-scalar error, suspect **numpy 2.x first**, not torch.
- **Ultralytics 8.4 *requires* `coremltools>=9.0`** (don't "fix" by downgrading coremltools —
  it fights Ultralytics; fix the numpy side instead).
- **The spike's ML deps belong in an optional dependency-group, not `dev`/runtime.**
  `bench = [ultralytics, coremltools, numpy<2]`, lazy-imported inside functions so the
  modules import (and their pure logic unit-tests run) on a machine with only core deps.
  Keeps CI lean (no PyTorch pull) and the runtime service unaffected.
- **Benchmark the field-laptop FLOOR, not the dev machine.** The ≥10fps gate is judged on
  the MacBook Air M4 (fanless → throttles). ANE is ~identical across the M4 line, so a
  faster Mac gives an optimistically cool-clock number the floor can't hold. Measure
  **sustained steady-state** (warm-up + timed window), not a cold burst, or throttling
  hides. Split the harness: pure `summarize()`/gate (offline-testable) vs. the ANE-running
  `benchmark_resolution()` (manual `@pytest.mark.ane`) — so a wrong threshold can't slip
  through only on a machine that has an ANE.
- **A fast CoreML latency number is meaningless until you prove the ANE served it.**
  `ComputeUnits.all` does NOT guarantee Neural-Engine placement — Core ML places per-op and
  silently falls back to GPU/CPU for some graphs. Verify by benchmarking the same model
  under `CPU_ONLY` and comparing: if `ALL` ≈ `CPU_ONLY` it's a CPU run; ANE shows a clear
  speedup (observed 5.6× for YOLO11s@640: ~20 ms CPU vs ~3.5 ms ALL). Don't trust the
  export banner's `CPU (Apple M4)` line — that's the PyTorch **tracing** device, not the
  inference device. Codified as `hades-bench-latency --verify-ane` (exits non-zero on
  fallback) so it isn't an ad-hoc one-liner.
- **Result (P1.5):** all of {640, 960, 1280} clear ≥10fps on the Air (median 293/63/57 fps;
  1280 by 5.7×). So **latency stops being the binding constraint after P1.5 — recall is.**
  P2.5 picks the largest resolution recall wants; latency won't veto it. Don't re-open the
  latency question in P2.5 without new info (e.g. a much heavier model variant).

## Detection (Phase 2)
- **The YOLO CoreML/ONNX export is `nms=False`** — raw output is `(1, 84, 8400)`: rows 0–3
  box `(cx,cy,w,h)` in LETTERBOX pixels, rows 4–83 = 80 class scores, **person = row 4**
  (COCO class 0), 8400 anchors. The detector must decode + NMS + un-letterbox itself. ONNX
  and CoreML emit the SAME `(1,84,8400)` layout (no transpose); only the input differs —
  CoreML eats a uint8 *image* with `/255` baked in, ONNX needs float32 NCHW `[0,1]`.
- **Put the raw→Detection decode in ONE shared module** (`detect/postprocess.decode_yolo`)
  imported by both backends — never per-backend. Cross-validated: ONNX(FP32/CPU) vs
  CoreML(FP16/ANE) on the same frame agree to ≤0.7px center / ≤0.004 conf. That sub-pixel
  agreement is the proof the shared letterbox/un-letterbox + decode is correct.
- **Lean-CI for ML inference: onnxruntime in `dev`, NOT `bench`.** Inference needs only
  onnxruntime (~68 MB, no torch); the lean-CI goal is specifically "no PyTorch in CI", which
  this honors. Export (.pt→.onnx) needs torch → stays in `bench`. The `.onnx`/`.mlpackage`
  are gitignored artifacts, so CI can't load a real model: two-tier test — a tiny SYNTHETIC
  ONNX graph (KB, `onnx.helper`, no weights) proves the ORT→decode SEAM on CI; a gated
  `@pytest.mark.onnx_real` test proves real-weights detection manually. CI proves wiring; a
  manual gate proves accuracy. (Same pattern as `@pytest.mark.ane` for CoreML.)
- **The transposed-output trap (review C1) is invisible to CI by construction.** A naive
  `shape[0]==1` guard passes a transposed `(1, 8400, 84)` export, and `pred[4]` then reads
  anchor #4's vector → an EMPTY map over a scene full of survivors, no error. CI can't catch
  it (real CoreML is ANE-excluded; the synthetic ONNX is built in the correct layout). Guard
  it in decode: the detection head is channel-major, so `channels < anchors` and
  `channels > 4+class_index` must hold — reject loudly otherwise.
- **Detection eval matching must be MAX-CARDINALITY, not greedy-nearest (review I2).** Greedy
  strands a matchable pair in clustered survivor scenes (preds@{4,6}, GTs@{0,5}, thr=5: greedy
  TP=1, optimal TP=2) → under-reports recall on exactly the hard SAR case. Use augmenting-path
  max-cardinality + a distance-minimizing local search (no scipy: numpy-free 2-opt + displace
  moves) so a contested GT goes to the nearer pred. recall=None (not 0) when GT count is 0.
- **NMS IoU on zero-area boxes is `0/0=nan`, and `nan <= thr` is False → silently drops a box
  (review I3).** Guard the union denominator (`np.divide(..., where=union>0)`). `Detection`
  permits a zero-area box (only rejects inverted), so any direct `nms_xyxy` caller hits this.
- **A comment that LIES about the code is a latent §3.2 coordinate bug (review I4).** The
  letterbox stored the INTEGER paint offset but a comment claimed a "fractional half-pad
  carry"; a maintainer "fixing" code to match the prose would shift every box ≤0.5px off the
  painted image. On the coordinate footgun, make the comment match the code exactly.
- **Triage a review finding by its CONSEQUENCE, not its label (Codex P1).** Codex flagged the
  matcher's local search as "[P1] silently corrupts stratified recall". A 2000-config
  brute-force vs exact min-cost matching proved cardinality is ALWAYS optimal (0 fails) — so
  recall and per-subclass/size attribution are exactly right; the local search only affects
  which pred is the labeled TP and the diagnostic `Match.distance` (a field no metric reads).
  Right fix = lock the real invariant with a test (matched-GT set = max-cardinality) + soften
  the over-promising docstring, NOT a Hungarian-solver rewrite. Disprove-or-confirm the
  *stated consequence* before sizing the fix; a min-cost solver for a diagnostic-only field
  would violate the simplicity rule.
- **Validate box geometry at EVERY boundary, reject zero-area, not just inverted (Codex P2).**
  `decode_yolo` filtered degenerate boxes, but the public `Detection`, the `BoxMessage` wire
  schema, AND `GroundTruth` labels each minted/accepted zero-area boxes (only `<` was
  rejected). A zero-area box's "center" is a useless point on a line that silently feeds a
  survivor coordinate / corrupts a size bucket. Reject `x_max<=x_min or y_max<=y_min` in all
  three constructors. (Note: this then forbids tests from constructing zero-area objects —
  test the NMS division-by-zero guard via 1px boxes + assert decode never EMITS zero-area.)

## Decisions deferred (don't re-litigate without new info)
- **GPS altitude vertical datum (HAE vs MSL)** — deferred to the real dataset (~2026-07-01),
  NOT a coin-flip pick now. The fix that matters (alt_datum tag + assert-on-mismatch in
  `ray_to_ground`) is already in `docs/DESIGN.md §3.5`. Resolve empirically from the
  `.srt`/CRSF stream, then record the canonical choice in §3.5.
- **Deferred to real dataset / live path (documented in code):** VideoToolbox HW-decode path
  untested (gated on ≥240px real footage — capture the first O4 clip ≥240px as a golden CI
  fixture); near-null-island GPS cold-start noise guard (TODO in `srt_file_source.py`);
  poses-fully-in-memory in `sync.align` (fine for replay; live CRSF needs streaming match).

## Fine-tuning (Phase 2.5)
- **Roboflow exports leak by frame, not scene.** HERIDAL's Roboflow split put all 14 test
  scene-codes (BRK/GRO/ZRI/...) into train too → same flight terrain in both → inflated anchor
  recall (21 test imgs were even avg-hash-identical to a train img). Fix = re-split by SCENE
  (`scene_split.py`), assert `train∩test scenes == ∅`. Always check a new dataset's split for
  per-scene/per-flight leakage before trusting it. Disclose when it's not the official split.
- **Cluster login node ≠ compute node CPU.** NCShare login is a KVM VM whose masked CPU flags
  fail numpy's x86-64-v2 baseline → `import numpy` crashes on login but works on the Xeon GPU
  nodes. Run ALL python (staging, merge, validate, smoke) in an srun/sbatch allocation. The
  in-script `python -c "import torch"` verify crashing on login does NOT mean the install failed.
- **Case-sensitive FS bites image lookup.** HERIDAL test images are `.JPG` (uppercase); a
  lowercase-only `_resolve_image` silently skipped EVERY test image → empty held-out split.
  Match image extensions case-insensitively against real dir entries.
- **`unzip` in a batch job needs `-o`** (no stdin → the overwrite prompt EOFs and `set -e` kills
  the job). And `SLURM_RESTART_COUNT` is unset on first run → guard with `${VAR:-0}` under `set -u`.
- **Ablation fairness = diff the args.yaml.** Only the pretrain `model:` should differ between
  arms; everything else byte-identical. Verified by diff. VisDrone pretrain helped precision but
  NOT recall here → Arm A {HERIDAL+SARD} won the recall-first objective.
- **center-distance `max_distance` must match GT box scale.** Default 10px is far too tight for
  62px-median person boxes on native-4000px frames → recall collapsed 0.91→0.34. Used 50px.
  This is the resolution effect: 960-inference downsamples a 4000px frame ~4×, shrinking a 62px
  person to ~15px. Resolution chosen empirically = 960 (ties 1280 recall, better precision).
- **Don't claim augmentation you didn't wire.** `blur_p` sat in the config + ablation.yaml but
  `to_ultralytics()` never passed it (and it isn't a real YOLO.train() kwarg) → the trained model
  used `scale` jitter only. Codex caught the dead field. Only claim knobs that reach the trainer.
- **Selection-on-test is leakage.** Picked resolution 960 on the held-out test then reported
  acceptance on the same set (no separate HERIDAL val after the scene split). Disclosed the
  selection-optimism prominently rather than presenting 0.551 as selection-independent; the clean
  number comes from the real flood set re-run (~2026-07-01).

## Track + Project + Confirm (Phase 3)
- **Lean-runtime tracker: build a numpy ByteTrack, don't wrap Ultralytics.** Ultralytics'
  `BYTETracker` imports torch AND auto-`pip install`s `lap` at runtime → breaks both lean-CI
  (no PyTorch) and the on-device-only/no-runtime-fetch constraint. `supervision` avoids torch
  but drags a CV toolkit + still adds scipy and leaves the GMC seam fighting library internals.
  ~250 lines we own (two-stage assoc + XYAH Kalman + lost-buffer) made the GMC warp a one-line
  refinement. Added a `assert "torch" not in sys.modules` test to LOCK the lean constraint in CI.
- **Random-noise fixtures are pathological for optical flow (GMC).** Pure per-pixel noise has no
  multi-scale coherence → it aliases under any resize and LK can't track it across a large pan.
  Three GMC test failures were ALL the fixture, not the code: a realistic smooth-textured frame
  (summed low-freq sinusoids + blurred noise) tracks like terrain. Also: a content-preserving
  WINDOW-SLIDE (crop two overlapping windows from a larger background) avoids the black border
  `warpAffine`-shift leaves, which starves corner tracking. And `downscale=2` default aliased
  fine texture → changed to `downscale=1` (downscaling is a speculative speed knob; defer it).
- **`getRotationMatrix2D(angle)` sign is y-DOWN.** A test asserted +5° but `arctan2(m[1,0],m[0,0])`
  on its matrix is −5° (image y-down). Recovered warp was CORRECT; the assertion convention was
  wrong. Fix = compare the recovered 2×2 block to the planted matrix directly, never re-derive a
  signed angle (that invites a y-down/y-up mix-up — the same §3.2 mirror-bug class).
- **Derive load-bearing geometry independently BEFORE coding it.** Had an agent derive
  `R_world_body` (aerospace ZYX → NED→ENU adapter) + both boresights to MACHINE PRECISION with
  worked analytic test cases first; `geometry.py` + 23 tests then passed first try. Named sign trap
  it caught: +pitch=nose-up needs NO sign flip (the NED→ENU adapter already maps scipy's +pitch to
  +ENU-up). The cardinal silently-wrong-coord code is exactly where to spend on an independent derive.
- **Frame-gate verdict must be THREE-valued (PASS/PASS_UNVERIFIED/REJECT), not boolean.** "No
  evidence of badness" (the .srt replay path has no IMU/attitude) is epistemically DIFFERENT from
  "verified good." A boolean forces a lie: fuse-unverifiable-as-good, or black out the whole replay
  path. Absent signal → PASS_UNVERIFIED (fusable, radius inflated downstream); only EVALUATED-and-bad
  → REJECT. A criterion that can't be evaluated NEVER rejects. (Same None-is-honest idiom as P1.)
- **Confirmation is a CONSISTENCY filter, not a semantic classifier — document the blind spot.**
  Persistence + world-clustering CANNOT tell a stable false positive (AC unit / sun glint) from a
  real survivor; it promotes the FP to STRONG, sometimes more confidently than a marginal survivor.
  Pinned as `test_stable_false_positive_is_a_known_limitation`. "STRONG" = "worth a human look,"
  never auto-dispatch. Mitigation is upstream (detector precision) + operator confirmation.
- **Leaky-integrator decay score beats raw N-of-M for promotion.** A periodic flicker engineered
  to hit exactly N hits/M-frame window defeats a pure count; the decay starves it between bursts
  (gaps multiply the decay). Keep `hits-in-last-M` as the legible UI floor, but drive promotion off
  the decayed score. Add Schmitt hysteresis (promote θ_up, demote θ_down<θ_up) so tiers don't flap.
- **De-dup for world-clustering must be world-aware AND persistent AND temporally-discriminating.**
  Box-IoU-only de-dup is THREE-sided wrong (each caught by a different reviewer): (a) it FORGETS once
  co-occurrence ages out of the window → a duplicate self-corroborates (persist the pair); (b) it
  wrongly merges two distinct close survivors whose boxes overlap → also require world-point
  proximity; (c) the same-FRAME requirement misses a flickering source that alternates between two
  ids that NEVER co-occur → both reach STRONG (false survivor). Fix (c): reject corroboration for a
  same-spot pair whose active frames INTERLEAVE (not a clean disjoint relay, not concurrent-distinct).
  Discriminator: same centroid + interleaved = one flicker; same centroid + disjoint spans = real
  relay; different centroid = distinct survivors. (a)/(b) were the internal panel; (c) was Codex.
- **STRONG requires a VALID fused coordinate.** A track whose points are all gate-REJECT or
  un-projectable (lat None) still accrues decay score and could hit the solo-STRONG bar → a
  dispatch-grade tier with NOTHING to dispatch to (Codex P1). Gate promotion on `centroid() is not
  None`. The track stays VISIBLE at a lower tier (recall-first), it just can't be STRONG.
- **`None`-checks aren't finiteness-checks (the silent-NaN-coordinate class).** Codex found the
  geometry guarded GPS/attitude/alt for `None` but a NaN/inf flowed through to a (nan,nan) pin that
  `fusable` ACCEPTS (`nan is not None` is True). Same hole in the gate (`nan > cutoff` is False →
  silent PASS) and the datum guard (`_KNOWN_DATUMS` was defined but UNUSED → an empty/typo'd tag
  equal on both sides subtracted). Guard finiteness AND membership at every coordinate boundary,
  not just None. Treat a non-finite sensor signal as ABSENT, never as data.
- **Triage a review finding by CONSEQUENCE; the fix may be the docstring, not the value.** Codex
  flagged `match_thresh_low=0.5 > match_thresh=0.2` as contradicting the "looser" docstring. But
  canonical ByteTrack uses a TIGHTER round-2 IoU (low-conf boxes are noisier; a loose floor links
  garbage) — the VALUE was right, the prose was wrong. Fixed the docstring, not the threshold.

## Phase 4 — Localization (flagship)
- **Verify uncertainty-math claims EMPIRICALLY, never by intuition.** I assumed a straight pass
  is the heading-limited worst case; in sim, an OVERHEAD pass CANCELS the bias (0m) and only a
  LATERAL standoff doesn't (~12m). I assumed the bias floor scales with AGL; it scales with
  GROUND RANGE (the lever arm). Each wrong assumption would have shipped a dishonest radius.
  Run the sim and measure before writing the assertion.
- **A test that flips on `seed` is NOT passing — it encodes a property the code lacks.** The
  range-floor test was green on seed=0 only (failed 3/8). A green seed-lucky test is a
  self-deception trap worse than a red one. Sweep seeds (or average) for any MC-backed property.
- **The reported uncertainty RADIUS is a public honesty surface — get its definition exactly
  right.** R95 must be the EMPIRICAL 95th-pct sample radius (equal-coverage circle), NOT the
  major semi-axis (over-states ~1.3x = false pessimism). I had the right code in uncertainty.py
  and the WRONG code in fuse.py — a docstring even rationalized the wrong one. Audit every R95.
- **Never emit (0,0) for "no coordinate" — it plots at Null Island as a discovered survivor.**
  Make the field Optional and emit None; force the consumer to special-case "no fix". A required-
  float schema that forces a fake coordinate is the bug.
- **When you DEVIATE from the approved plan/gate, RECONCILE the doc in the same change.** I
  replaced the gate's additive bias floor with MC-over-fusion (the additive form under-covered,
  0.46 cov). Left stale docstrings + gate clauses claiming the additive form — a reviewer reads a
  gate the code contradicts. Update the docstring AND the gate note when the mechanism changes.
- **Run the internal adversarial panel BEFORE claiming a phase done.** It found 6 real honesty
  bugs in code that was 372-tests-green. Green tests prove the code does what the tests say, not
  that the tests assert the right thing. The panel asks "is the assertion honest?", which tests
  can't.

## Phase 4 — Codex adversarial review (caught what the internal panel missed)
- **Frame-gating must be enforced at the FUSION-BUFFER boundary, not just computed.** The loop
  computed each frame's gate verdict (gp.verdict) but appended observations to the fusion buffer
  on `pose is not None` alone — a REJECT frame whose ray still projects to a finite point could
  move a STRONG track's dispatch coordinate. The `GroundPoint.fusable` property already existed;
  the loop just didn't consult it. Codex P4 caught this; my internal panel didn't because it only
  exercised the .srt path (all CUE-ONLY) and never the live-pose path where some frames REJECT.
  LESSON: when an invariant has a guard property, grep every CALL SITE that should consult it —
  an unconsulted guard is the same as no guard.
- **A "drop-to-latest" comment is not drop-to-latest.** serve()'s `_broadcast` did
  `await ws.send()` per client inside the pump loop — the docstring CLAIMED non-blocking but a
  slow client back-pressured the whole pipeline (a 120ms-budget path). Fixed with per-client
  size-1 latest-wins queues + independent writer tasks. LESSON: any comment asserting a
  performance/latency property needs a test that actually stalls a consumer and proves the
  producer advances. Codex P4.
- **Secrets in a "commit later" file are still a leak.** Hard-coded Roboflow `key=` tokens in a
  cluster script + runbook. Under the no-commit rule they hadn't entered history yet — but
  "figure out commits later" means they WOULD. Moved to env vars (fail-loud if unset) + redacted
  the runbook. LESSON: the no-commit rule does not make a hard-coded secret safe; neutralize it
  now and flag the user to ROTATE it (only they can, in the provider console). Codex P4.
- **A different-model reviewer catches blind spots a same-model panel shares.** My Claude internal
  panel and I both missed the gate-buffer bug; Codex (GPT-class) found it immediately. That
  model-diversity IS the value of the external pass — run it even after a thorough internal one.

## Coordinator UI (Phase 5)
- **A MapLibre style with `glyphs: undefined` THROWS on load → blank canvas.** MapLibre's
  `Style._load` validates `glyphs` as "absent OR a string"; an explicit `glyphs: undefined`
  fails "string expected" and aborts the WHOLE load, so `map.on("load")` never fires and no
  sources/layers are ever added. Symptom: canvas exists, has size, WebGL is fine, but nothing
  paints. LESSON: never emit `glyphs` (or any optional style key) as an explicit `undefined` —
  OMIT the key. Only include `glyphs` (a string URL) when a symbol/text layer needs it; offline
  forbids a remote glyphs URL, so v1 has NO label layers + NO glyphs key. Found by instrumenting
  the canvas boundary (size/WebGL/load/console) in ONE diagnostic run, not by guessing.
- **Screenshot-verify GL the headless way: swiftshader flags.** Headless chromium has no GPU;
  launch with `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` to get a
  real software-rendered MapLibre canvas for visual verification. The `GPU process exited` /
  `network service crashed` lines on teardown are benign noise, not failures.
- **Tailwind purges dynamically-built classes.** `text-st-${status}` / `bg-st-${s}/10` composed at
  runtime aren't in source for the JIT to see → purged from the built CSS → colors silently don't
  render (tests on className strings still pass!). SAFELIST them in tailwind.config. Verify by
  grepping the built CSS, not by trusting a className assertion.
- **RGB-channel tokens are required for Tailwind's <alpha-value>.** Author CSS vars as
  `--x: 11 14 20` (channels), map via `rgb(var(--x) / <alpha-value>)`, so `bg-st-warning/10`
  works for translucent map fills without minting alpha tokens. Hex vars can't do the opacity modifier.
- **Comment globs break esbuild config parse.** `src/**/*.test` inside a JS block comment closes
  the comment at `*/` → "Unexpected *". Reword globs in comments (e.g. "files ending in .test.ts").

## E2E wiring (Phase 5.9)
- **The service serves only for the clip's duration, then `_pump()` returns and the WS servers
  CLOSE.** `serve()` is `async with websockets.serve(...): await _pump()` — when the recorded
  clip ends, `_pump()` finishes, the `async with` exits, sockets shut. Symptom: a WS client that
  connects a few seconds after spawn gets code 1006 / "opening handshake failed" with NO
  server-side error. FIX for the E2E: slow `--fps` (e.g. 4) so the feed lasts long enough for
  Vite build + page load + connect, and connect promptly. (For a long live mission this is moot;
  it only bites a short recorded fixture.) Isolated it by WS-probing the service directly
  (browser-style `WebSocket`) vs via the UI — the probe proved the server + CUE_ONLY emit work.
- **websockets 16.0 serves browser/Node `WebSocket` clients fine** — the 1006 was timing, not an
  API/Origin mismatch. Don't chase a library-version red herring; gather evidence at the boundary
  first (the Python `test_ws_emit` passing told me the server was fine).
- **The E2E coordinate test is THREE guards at three layers, not one** (Option-C, adversarial
  review): math conventions → Python analytic `ray_to_ground` tests; the wire seam → Task 4.8
  glue test w/ the independent `world_to_pixel` oracle; the **wire→store→toLngLat→map-pin [lon,lat]
  flip** → the E2E. Driving a precise coordinate through headless Electron+WS would be the worst
  place to assert the value (slow/flaky) AND risk circularity (expected coord recomputed by the
  same math). So: 5.9-a asserts the honest field path (position-only .srt → CUE_ONLY/null →
  ZERO phantom pins, still listed); 5.9-b asserts a frozen located record pins at the
  hand-transposed `[lon,lat]` literal (non-circular flip guard).
- **tsc can't resolve a browser `import("/src/x.ts")` inside `page.evaluate`.** Use a runtime
  `window.__imp(p) => import(/* @vite-ignore */ p)` indirection injected via `addInitScript`,
  typed with `as Promise<typeof import("../src/x")>`, so tsc type-checks the shape without
  resolving the web path.
- **A renderer that loads before its service is up must reconnect.** RealWsClient retries on
  close/error with a fixed backoff (Electron supervises + may restart the child); surfaces
  link-down (degrade-visibly) meanwhile. A one-shot connect is a real defect, not just a test flake.

## Demo website (Phase 6)
- **"Bake from a real run" ≠ "bake from today's fixture."** The only recorded fixture is
  position-only (no attitude) → the localizer correctly emits ONLY CUE_ONLY/null contacts → an
  EMPTY demo map, the one thing the demo exists to show. The honest resolution (adversarial
  demo-craft + red-team panels) is to drive the REAL `Fuser` over full-attitude poses from the
  P4 simulator (`locate/geom_sim` `OrbitPath`/`StraightPass`) against KNOWN ground truth: every
  pin/ellipse/R95 is genuine localizer output, and you can report the REAL median meter-error.
  Honors the plan's intent ("don't fabricate the pipeline") without its dead letter. NEVER
  hand-author coordinates in a SAR tool.
- **Use the NOISY sim path, not the clean truth path.** Fusing `pose_true`/`pixel_true` gives a
  suspiciously-perfect 0.00 m fix (reads as fake to a domain expert). Fuse `pose_meas`/`pixel_meas`
  from `GeomSim.run(path, SensorErrorModel(), seed)` — the SAME path `locsim_report` uses — so the
  demo shows the localizer's HONEST scatter (median ~1.1 m here).
- **Actionability class is REAL geometry, not a label you set.** PINPOINT needs R95 ≤ 5 m AND
  aspect_spread ≥ 70°. A 55 m-radius orbit lands in SWEEP; a 35 m-radius orbit at 40 m AGL clears
  PINPOINT (R95 ~4.4 m) — verified by probing the pipeline, not assumed. If the demo needs a
  PINPOINT, change the SCENE GEOMETRY and let the math produce it.
- **The file-source models the MOCK, not the real-WS path.** `useRealService` uses a LOCAL frame
  counter (`id = frameId++`) that only works because the live channel is lockstep; the baked frame
  record must carry its REAL wire `frame_id` (the cross-channel join key — `VideoPanel` draws a box
  only when `det.frame_id === frame.frame_id`). Reuse `MockWsServer` (id-keyed) + the mock's stub
  command handlers (promote → log; no fake LINK-LOST). The new source is "fetch mission.json → feed
  MockWsServer", not a new transport.
- **MockWsServer pushes to its OWN `onFrame` listeners, not to `videoFrameSink`.** The frame
  handler must be registered via `server.onFrame(fn)`, and `fn` itself calls `videoFrameSink.push`
  (mirroring `useMockMission`). Subscribing the handler to `videoFrameSink` instead → zero frames
  flow → blank video. (Cost a debug cycle: `drawnCount: 0`.)
- **Inline the looped JPEG ONCE at the mission top level, not per-frame.** 90 frames × the same
  base64 still = 2.1 MB; one shared `frame_jpeg_b64` + frames carrying only `{frame_id, timestamp}`
  = 56 KB. Frames still carry the join key; the bytes are shared (one decode in the loader).
- **Web build = ONE config, `mode === "web"` drops the Electron plugin + outputs `dist-web/`.**
  Keep `base: "./"` for BOTH targets — relative asset URLs resolve under a GH-Pages subpath, a
  Netlify/Vercel root, AND `file://`; a hard-coded `/HADES/` base breaks the latter two. Baked data
  → `ui/public/` (Vite copies it to the bundle root); fetch RELATIVE (`${BASE_URL}mission.json`,
  never `/mission.json`). Add `.nojekyll`.
- **Demo banner color = `--st-stale` violet-slate, NEVER magenta.** A demo is an epistemic caveat
  ("not live operational data"), not a system-integrity failure (magenta = link-lost, the P0 rule).
  The banner must name EXACTLY which numbers are real (pins/ellipses/confidence = localizer output)
  vs scripted (scene/pose), state "no live feed", and surface the real median error (honesty as a
  flex). Full provenance behind a `[details]` toggle.
- **Stale scaffold smoke test caught at the P6 close.** `smoke.spec.ts` still asserted a P0-era
  `<h1>HADES` placeholder heading the P5 coordinator UI never renders → it failed in the full E2E
  run (and in isolation). The renderer mounts fine (verified by direct Electron launch: `#app-root`
  present, body populated). Fix = update the assertion to the real always-on landmark
  (`getByTestId("status-strip")`), not the dead placeholder. Lesson: when a UI is rewritten, sweep
  the scaffold-era tests for assertions that no longer match the real DOM.
- **The map must NEVER take down the whole UI (gstack /qa caught this).** `new maplibregl.Map()`
  THROWS synchronously when WebGL is unavailable (old GPU, locked-down/headless browser visiting
  the public demo). The throw is inside `MapView`'s mount effect; with no guard it unmounts the
  ENTIRE React tree → a totally blank page (no banner/list/video/log). Fix: try/catch the Map
  construction, set a `mapError` state, render an honest "map unavailable: WebGL" placeholder; the
  rest of the coordinator stays usable (list/video/status/log + coords in the panel). A class error
  boundary would NOT catch this reliably — the throw is in an effect, so catch it at the source.
  Lesson: any single render-time hardware/GL dependency that can throw needs local containment, or
  one failure blanks everything. The independent /qa pass (no WebGL in that browser) surfaced what
  the WebGL-enabled Playwright runs hid.
<!-- TODO(tw44): revisit -->
