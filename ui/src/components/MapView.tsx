import type { FeatureCollection, Point } from "geojson";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { contactsToCirclesGeoJSON } from "../map/circle";
import { contactsToGeoJSON, toLngLat } from "../map/geo";
import {
  circleStrokeColorExpr,
  circleStrokeWidthExpr,
  pinColorExpr,
  pinRadiusExpr,
} from "../map/layers";
import { operationalStyle } from "../map/style";
import {
  coverageGeoJSON,
  droneGeoJSON,
  footprintGeoJSON,
  trackGeoJSON,
} from "../map/telemetryLayers";
import { PinTweener } from "../map/tween";
import { useContactStore } from "../store/contacts";
import { useLayerStore, type LayerKey } from "../store/layers";
import { useSelectionStore } from "../store/selection";
import { useTelemetryStore } from "../store/telemetry";
import { useThemeStore } from "../store/theme";
import type { ContactRecord } from "../types/wire";
import { LayerToggle } from "./LayerToggle";

/* The map — the heart of the tool, the application itself (impl-plan Task 5.5a/b; ATAK
 * "the map is the application"). Bespoke MapLibre GL viz (NO shadcn/Magic). Renders the
 * desaturated operational basemap + uncertainty rings (below) + reticle pins (above), all
 * tinted by the shared status encoding. Pins are bound bidirectionally to the selection
 * spine (click a pin → select; selection elsewhere → ring/keep-framed here) and GLIDE to
 * refined coordinates (never teleport, §4.5).
 *
 * Imperative GL, so it's verified by screenshot rather than jsdom; the data transforms it
 * uses (geo/circle/layers/tween) are exhaustively unit-tested. */

// register the pmtiles:// protocol once so a pre-downloaded offline basemap can drop in
let pmtilesRegistered = false;
function ensurePmtiles() {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

// The pre-downloaded offline basemap (Stage 1.1): a Protomaps v4 extract of the Biloxi /
// MS-Gulf-Coast AO (z0–14, ~4.6 MB), bundled under `ui/public/` and served fully offline via
// the `pmtiles://` protocol. Resolved RELATIVE to the page base (matching mission.json) so the
// URL is identical under the GitHub-Pages subpath, a root deploy, AND file://.
const DEFAULT_PMTILES_URL = `pmtiles://${import.meta.env.BASE_URL ?? "/"}biloxi-coastal.pmtiles`;

const PIN_SRC = "contacts";
const RING_SRC = "uncertainty";
const COVERAGE_SRC = "coverage";
const FOOTPRINT_SRC = "footprint";
const TRACK_SRC = "track";
const DRONE_SRC = "drone";

// which map layer ids each operator toggle controls
const LAYER_IDS: Record<LayerKey, string[]> = {
  coverage: ["coverage-fill", "coverage-line"],
  track: ["track-line"],
  footprint: ["footprint-fill", "footprint-line"],
  uncertainty: ["uncertainty-fill", "uncertainty-stroke"],
};

export function MapView({ pmtilesUrl = DEFAULT_PMTILES_URL }: { pmtilesUrl?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tweenerRef = useRef(new PinTweener(400));
  const rafRef = useRef<number | null>(null);
  const fittedRef = useRef(false); // auto-fit the viewport to the data ONCE (then operator owns it)
  // The basemap paints in the active ECDIS palette (§12). A theme change rebuilds the map (the
  // construction effect is keyed on it) — a full restyle is the robust path since setStyle()
  // would wipe our custom data sources/layers anyway; the toggle is infrequent.
  const theme = useThemeStore((s) => s.theme);
  // WebGL can be unavailable (old GPU, locked-down/headless browser visiting the demo): MapLibre's
  // Map constructor THROWS. Catch it so a map failure degrades to a placeholder instead of throwing
  // out of the effect and unmounting the whole coordinator (banner/list/video would vanish too).
  const [mapError, setMapError] = useState(false);

  // one-time map construction
  useEffect(() => {
    if (!containerRef.current) return;
    ensurePmtiles();

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: operationalStyle({ pmtilesUrl, theme }),
        center: [-88.52, 30.215],
        zoom: 14,
        attributionControl: false,
      });
    } catch {
      setMapError(true); // WebGL unavailable — render the fallback, keep the rest of the UI alive
      return;
    }
    mapRef.current = map;

    map.on("load", () => {
      // Test-only handle so the E2E suite can assert the offline basemap painted tiles via
      // queryRenderedFeatures (WebGL pixel readback is unreliable). No app code reads this.
      window.__hadesMap = map;

      // Data-layer palette per ECDIS mode (§12). On a LIGHT ground the dark-tuned cool washes
      // wash out, so day uses higher coverage alpha + a crisp coverage OUTLINE, darker cool
      // track/footprint that don't vanish on paper, and a dark casing on the drone dot.
      // Coverage is searched-area CONTEXT, not a contact — it must RECEDE so the warm survivor
      // pins stay the only figure (§5.1 figure-ground). On light it leads with a thin outline +
      // a very low fill; a loud green slab out-shouting the pins is the exact inversion to avoid.
      const D =
        theme === "day"
          ? {
              coverage: "#3E8E6E", coverageOpacity: 0.08, coverageLine: "#2E7A5C", coverageLineOpacity: 0.45,
              cool: "#2B5E8E", droneFill: "#1C64B4", droneStroke: "#201E1A",
            }
          : {
              coverage: "#2FB67C", coverageOpacity: 0.08, coverageLine: "#2FB67C", coverageLineOpacity: 0.5,
              cool: "#6FA8DE", droneFill: "#3B7BC8", droneStroke: "#E6EDF3",
            };

      // telemetry sources/layers FIRST so they sit below the contact rings + pins (z-order)
      map.addSource(COVERAGE_SRC, { type: "geojson", data: emptyFC() });
      map.addSource(FOOTPRINT_SRC, { type: "geojson", data: emptyFC() });
      map.addSource(TRACK_SRC, { type: "geojson", data: emptyFC() });
      map.addSource(DRONE_SRC, { type: "geojson", data: emptyFC() });

      // searched-area coverage — the most important non-pin layer. Fill + a crisp dissolved
      // OUTLINE; on light the edge carries the meaning (the fill alone is too faint, §12).
      map.addLayer({
        id: "coverage-fill",
        type: "fill",
        source: COVERAGE_SRC,
        paint: { "fill-color": D.coverage, "fill-opacity": D.coverageOpacity },
      });
      map.addLayer({
        id: "coverage-line",
        type: "line",
        source: COVERAGE_SRC,
        paint: { "line-color": D.coverageLine, "line-width": 1, "line-opacity": D.coverageLineOpacity },
      });
      // current camera footprint — a brighter outlined quad
      map.addLayer({
