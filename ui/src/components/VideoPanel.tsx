import { Camera, FlaskConical, Pause, Play, Plus, Rewind } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useContactStore } from "../store/contacts";
import { useProvenanceStore } from "../store/provenance";
import { useSystemStore } from "../store/system";
import { FrameBuffer } from "../video/frameBuffer";
import { overlayFreshness } from "../video/freshness";
import type { MockFrame } from "../mock/mock-ws";
import { STATUS_HEX } from "../map/layers";
import { latencyMeter } from "../perf/latency";

/* The video panel (impl-plan Task 5.6). Paints the binary-channel JPEG frame to a canvas
 * and draws detection boxes aligned by frame_id. Rolling buffer → instant rewind/pause.
 * Manual contact creation is the AI-miss backstop (recall-first). Loud LINK-LOST so a
 * frozen frame never looks live; fresh vs coasting overlays are visually distinct.
 *
 * Canvas painting is verified by screenshot; the controls, link state, and manual-contact
 * action are DOM-tested. The component reads the contact store for the latest detection. */

export function VideoPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferRef = useRef(new FrameBuffer(150));
  const [isLive, setIsLive] = useState(true);
  const [hasFrame, setHasFrame] = useState(false);

  const latestDetection = useContactStore((s) => s.latestDetection);
  const linkUp = useSystemStore((s) => s.linkUp);
  const addManualContact = useContactStore((s) => s.addManualContact);
  // Demo mode (provenance set) replays a near-black SYNTHETIC frame. Naming it keeps the panel
  // honest — a dark synthetic frame must never pose as a live feed (or read as a broken void).
  const isDemo = useProvenanceStore((s) => s.provenance !== null);

  // ingest frames pushed onto the buffer (wired to the mock/real WS in 5.1/5.9 via a ref API)
  useEffect(() => {
    const handler = (frame: MockFrame) => {
      latencyMeter.mark(frame.frame_id, "socket", performance.now()); // M3: frame on socket
      bufferRef.current.push(frame);
      setHasFrame(true);
      paint();
    };
    // expose a push hook on the window for the app/mock to feed frames (replaced by WS in 5.9)
    videoFrameSink.subscribe(handler);
    return () => videoFrameSink.unsubscribe(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // repaint when the detection or link state changes
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDetection, linkUp]);

  function paint() {
    const canvas = canvasRef.current;
    const frame = bufferRef.current.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (img?: HTMLImageElement) => {
      ctx.fillStyle = "#06080C";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // box overlays aligned by frame_id — only draw boxes that belong to THIS frame
      const det = latestDetection;
      const fresh = overlayFreshness({
        linkUp,
        displayedFrameId: frame.frame_id,
        detectionFrameId: det?.frame_id ?? null,
      });
      if (det && det.frame_id === frame.frame_id) {
        const color = fresh === "FRESH" ? STATUS_HEX.warning : STATUS_HEX.stale;
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.setLineDash(fresh === "COASTING" ? [4, 3] : []); // coasting = dashed
        for (const b of det.boxes) {
          const [x0, y0, x1, y1] = b.box_xyxy;
          ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        }
        ctx.setLineDash([]);
      }
      // M3: frame painted with overlay → close the glass-to-glass sample for this frame
      latencyMeter.mark(frame.frame_id, "painted", performance.now());
      latencyMeter.commit(frame.frame_id);
    };

    // decode the JPEG bytes → image; fall back to a flat draw if decode fails
    try {
      const blob = new Blob([frame.jpeg as BlobPart], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        latencyMeter.mark(frame.frame_id, "decoded", performance.now()); // M3: JPEG decoded
        draw(img);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        draw();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch {
      draw();
