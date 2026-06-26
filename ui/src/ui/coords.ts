import { forward as mgrsForward } from "mgrs";

/* Coordinate readout (DESIGN-SYSTEM §6.3a). TWO canonical formats, one per consumer role:
 *  - grid (MGRS/USNG): the PRIMARY — what US ground SAR speaks on the radio (FEMA standard).
 *  - geographic (WGS84 DDM): the secondary — what air/Coast Guard navigate by.
 * Both radio-speakable, fixed precision, datum-explicit. A null fix is an HONEST "NO FIX",
 * never a phantom coordinate (the same null-island defense as the wire schema). MGRS via the
 * vetted `mgrs` lib — we never hand-roll the UTM spheroid math for a life-safety coordinate. */

const NO_FIX = "NO FIX";

/** Degrees-decimal-minutes, e.g. "N30 12.900  W088 31.200". */
export function formatDDM(lat: number, lon: number): string {
  return `${ddmPart(lat, "N", "S")}  ${ddmPart(lon, "E", "W", 3)}`;
}

function ddmPart(deg: number, pos: string, neg: string, degWidth = 2): string {
  const hemi = deg >= 0 ? pos : neg;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const min = (abs - d) * 60;
  return `${hemi}${String(d).padStart(degWidth, "0")} ${min.toFixed(3).padStart(6, "0")}`;
}

/** MGRS/USNG grid, spaced for voice, e.g. "16R EU 1234 5678" (10 m precision = 4+4 digits). */
export function formatMGRS(lat: number, lon: number, digits = 4): string {
