import type { ContactRecord, DetectionMessage, JsonMessage } from "../types/wire";

/* The real-service WS client (impl-plan Task 5.9). Connects the renderer to the two localhost
 * channels the Python `hades-service` serves (loop.py): binary JPEG frames on `binaryPort`,
 * JSON (DetectionMessage + ContactRecord text) on `jsonPort`. It feeds the SAME ingestion
 * surface the mock fed — only the source swaps, so the entire UI is reused unchanged.
 *
 * `parseJsonMessage` is the pure, tested boundary: it validates the discriminator + required
 * fields so a malformed message fails loudly here (returns null) rather than flowing
 * downstream as a wrong coordinate (the DESIGN.md §3.2 fail-loud contract). */

const CONTACT_REQUIRED = [
  "frame_id",
  "track_id",
  "lat",
  "lon",
  "r95_m",
  "actionability_class",
  "priority_tier",
  "convergence_state",
  "detection_conf",
  "localization_conf",
] as const;

const DETECTION_REQUIRED = ["frame_id", "timestamp", "boxes"] as const;

export function parseJsonMessage(text: string): JsonMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;

  if (rec.type === "detection") {
    if (!DETECTION_REQUIRED.every((k) => k in rec)) return null;
    return rec as unknown as DetectionMessage;
  }
  if (rec.type === "contact") {
    if (!CONTACT_REQUIRED.every((k) => k in rec)) return null;
    return rec as unknown as ContactRecord;
  }
  return null; // unknown discriminator
}

export interface RealWsHandlers {
  onFrame: (jpeg: Uint8Array, frameId?: number) => void;
  onJson: (msg: JsonMessage) => void;
  onLinkChange?: (up: boolean) => void;
}

export interface RealWsConfig {
  binaryUrl: string; // ws://127.0.0.1:8765
  jsonUrl: string; // ws://127.0.0.1:8766
}

/** Connects both channels and routes messages to the handlers. Reconnects are the caller's
 *  concern (the service is supervised by Electron main); link-down is surfaced via onLinkChange. */
