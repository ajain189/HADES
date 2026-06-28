import type { ContactRecord, DetectionMessage } from "../types/wire";

/* MockWsServer — replays a canned mission over the SAME two-channel shape the real service
 * uses (impl-plan Task 5.1): a binary channel of JPEG frames and a JSON channel of
 * DetectionMessage / ContactRecord, aligned by frame_id. It exists so the whole UI (video
 * panel, map, list) runs deterministically + offline in Playwright with no Python service.
 * Selection/store wiring lives elsewhere; this is just the transport stand-in. */

/** One frame on the binary channel: JPEG bytes tagged with the join-key frame_id. */
export interface MockFrame {
  frame_id: number;
  timestamp: number;
  jpeg: Uint8Array;
}

type FrameListener = (f: MockFrame) => void;
type JsonListener = (m: DetectionMessage | ContactRecord) => void;
type Unsubscribe = () => void;

export interface MockWsConfig {
  frames: MockFrame[];
  json: (DetectionMessage | ContactRecord)[];
  /** Delay between emitted frames in ms; 0 = emit as fast as possible (tests). */
  intervalMs?: number;
}

export class MockWsServer {
  private readonly frames: MockFrame[];
  private readonly json: (DetectionMessage | ContactRecord)[];
  private readonly intervalMs: number;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly jsonListeners = new Set<JsonListener>();
  private stopped = false;

  constructor(config: MockWsConfig) {
    this.frames = [...config.frames].sort((a, b) => a.frame_id - b.frame_id);
    this.json = config.json;
    this.intervalMs = config.intervalMs ?? 33; // ~30fps default
  }

  onFrame(cb: FrameListener): Unsubscribe {
    this.frameListeners.add(cb);
