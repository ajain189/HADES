import type { StyleSpecification } from "maplibre-gl";

/* The operational basemap style (DESIGN-SYSTEM §5.1 / §12) — a DESATURATED chart so colored
 * detection data is the only figure on the map. Ships in BOTH ECDIS modes:
 *  - NIGHT (CARTO Dark Matter lineage): dark-gray land, darker water that recedes.
 *  - DAY (UI overhaul §12): light land paper, slightly-cooler water; pins/rings/coverage stay
 *    the only saturated marks. Land is the same warm-neutral family as the chrome so the map
 *    reads as part of the instrument, not a foreign tile layer.
 *
 * Offline by construction: with no PMTiles file, the style is just a flat operational
 * background (zero network sources, fully deterministic for tests + the canned demo). With
 * a pre-downloaded `.pmtiles` file (cached before a mission per the on-device constraint),
 * it adds the vector basemap via the `pmtiles://` protocol — still no remote tile server. */

export type BasemapTheme = "day" | "night";

// Per-theme operational colors. Day = light chart; Night = CARTO Dark Matter-derived.
const THEME_COLORS: Record<BasemapTheme, { land: string; water: string; road: string; label: string }> = {
  night: { land: "#101418", water: "#2C353C", road: "#454C55", label: "#9AA3AD" },
  // Day: a light land that's distinctly a CHART, not the chrome — warm paper land, a clearly
  // COOLER grey-blue water that reads as water (not just "lighter land"), and a road casing dark
  // enough to register as line-work. The land/water contrast is the cartographic signal that
  // makes the AO read as a place; saturated pins/rings still stay the figure on the light ground.
  day: { land: "#DAD3C4", water: "#A9B8C6", road: "#9C9484", label: "#4E4A43" },
};

export interface OperationalStyleOptions {
  /** A pmtiles:// URL to a pre-downloaded offline basemap; omit for the flat canvas. */
  pmtilesUrl?: string;
  /** Which ECDIS palette to paint the basemap in (defaults to day, the default chrome theme). */
  theme?: BasemapTheme;
}

export function operationalStyle(opts: OperationalStyleOptions = {}): StyleSpecification {
  const { land: LAND, water: WATER, road: ROAD, label: LABEL } = THEME_COLORS[opts.theme ?? "day"];
  const sources: StyleSpecification["sources"] = {};
  const layers: StyleSpecification["layers"] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": LAND },
    },
  ];

  if (opts.pmtilesUrl) {
    sources.basemap = {
      type: "vector",
