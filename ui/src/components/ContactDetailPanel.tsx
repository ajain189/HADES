import { ArrowUpFromDot, Crosshair, RotateCcw, Send } from "lucide-react";

import { useClearanceStore } from "../store/clearanceStore";
import { useContactStore } from "../store/contacts";
import { nextClearance, prevClearance, primaryVerb } from "../store/dispatch";
import { useMissionLog } from "../store/missionLog";
import { useSelectionStore } from "../store/selection";
import { useSystemStore } from "../store/system";
import { commandSink } from "../ws/commandSink";
import { formatContactCoord } from "../ui/coords";
import { effectiveLocConf, isContactStale } from "../ui/degrade";
import { formatAge } from "../ui/format";
import { ConfidenceBar } from "./ConfidenceBar";
import { Placeholder } from "./Placeholder";

/* The canonical Contact detail / command panel (impl-plan Task 5.7a/c; DESIGN-SYSTEM §7.3).
 * One primary verb per clearance state, reversible (life-safety undo). Coordinate readout in
 * BOTH roles (MGRS primary + WGS84 DDM secondary), datum-explicit, radio-speakable. Every
 * trust field is shown, never hidden (§6.8): both confidences separately, age, R95, the
 * convergence + heading-limited flags. Localization confidence collapses live as telemetry
 * goes stale (M12 degrade-visibly). */

const FRAME_RATE = 30;
// for v1, the wire doesn't carry per-contact datum; the validation path is REL_TAKEOFF (.srt).
const DATUM = "REL_TAKEOFF";

export function ContactDetailPanel() {
  const selectedId = useSelectionStore((s) => s.selectedId);
  const contact = useContactStore((s) => (selectedId !== null ? s.contacts.get(selectedId) : undefined));
  const clearance = useClearanceStore((s) => (selectedId !== null ? s.states.get(selectedId) : undefined)) ?? "NEW";
  const setClearance = useClearanceStore((s) => s.set);
  const snapshot = useClearanceStore((s) => s.snapshot);
  const telemetryAgeS = useSystemStore((s) => s.telemetryAgeS);

  if (selectedId === null || !contact) {
    return <Placeholder label="Select a contact" hint="Click a pin, row, or video box" />;
  }

  const coord = formatContactCoord(contact.lat, contact.lon, DATUM);
  const effLoc = effectiveLocConf(contact.localization_conf, telemetryAgeS);
  const stale = isContactStale(telemetryAgeS);

  const logEvent = (kind: "clearance" | "snapshot", text: string) =>
    useMissionLog.getState().append({ kind, text, t: Date.now() });

  const advance = () => {
    const next = nextClearance(clearance);
    if (clearance === "NEW" && next === "ASSIGNED" && contact.lat !== null && contact.lon !== null) {
      snapshot(contact.track_id, contact.lat, contact.lon); // capture dispatch coordinate
      logEvent("snapshot", `trk ${contact.track_id} dispatch coord captured`);
    }
    setClearance(contact.track_id, next);
    logEvent("clearance", `trk ${contact.track_id} → ${next.replace("_", " ")}`);
  };
  const undo = () => {
    const prev = prevClearance(clearance);
    setClearance(contact.track_id, prev);
    logEvent("clearance", `trk ${contact.track_id} ↺ ${prev.replace("_", " ")}`);
  };

  return (
    <div data-testid="contact-detail" className="flex flex-col gap-4 p-5 font-mono text-xs">
      <div className="flex items-baseline justify-between">
        <span className="font-ui text-2xs font-semibold uppercase tracking-[0.08em] text-text-lo">
          Contact{" "}
          <span data-testid="detail-track" className="font-mono text-xl font-medium tracking-tight text-text-hi">
            {contact.track_id}
          </span>
        </span>
        <span className="font-ui text-2xs font-semibold uppercase tracking-wide text-text-lo">
          {contact.actionability_class}
