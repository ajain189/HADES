import { useEffect, useRef, useState } from "react";

import { ScrollTrigger } from "./motion";

/* Scroll-driven, sticky, full-viewport frame scrubber (the Apple product-page technique).
 * A <canvas> fills the sticky hero and paints the frame that corresponds to scroll progress
 * through a tall wrapper. Frames are the ffmpeg-extracted exploded-drone render. GSAP
 * ScrollTrigger drives a plain object's `.f` from 0 -> last frame with scrub, and each update
 * paints the nearest decoded image. Reduced motion / no-canvas: a static poster frame.
 *
 * Reversible by construction: this is a self-contained component; the hero swaps between it
 * and the 3D DroneHero via the HERO_MODE flag in LandingPage. */

const BASE = import.meta.env.BASE_URL ?? "/";
const FRAME_COUNT = 149;
const frameSrc = (i: number) => `${BASE}landing/hero-frames/f${String(i + 1).padStart(3, "0")}.jpg`;

export function VideoScrollHero({ wrapRef }: { wrapRef: React.RefObject<HTMLDivElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      setFailed(true);
      return;
    }

    // NOTE: the frame scrub is intentionally NOT gated behind reduced-motion. It is entirely
    // user-driven (moves only as the user scrolls, no autoplay, no surprise motion), so it is
    // safe under prefers-reduced-motion and is the hero's primary content, not decoration.
    const images: HTMLImageElement[] = new Array(FRAME_COUNT);
    let loaded = 0;
    let disposed = false;
    const state = { f: 0 };

    // cover-fit paint: fill the viewport, center the frame, preserve aspect
    const paint = () => {
      const img = images[Math.max(0, Math.min(FRAME_COUNT - 1, Math.round(state.f)))];
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // pure-white backdrop fills whatever the contained frame does not cover
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, ch);
      // CONTAIN-fit: show the WHOLE frame at (or below) native resolution so it is never
      // upscaled/blurry and the drone is fully visible. The leftover viewport area is the white
      // fill above. Never enlarge past 1:1 (min with 1) so quality stays crisp.
      const fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      const scale = Math.min(fit, 1) * 0.98;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      // horizontally centered; the drone's mass sits low in the frame, so nudge the frame UP a
      // little so the drone lands near the vertical centre of the viewport
      const x = (cw - w) / 2;
      const y = (ch - h) / 2 - ch * 0.04;
      ctx.drawImage(img, x, y, w, h);
    };

    // load frame 0 first (paint immediately), then the rest in the background
    const first = new Image();
    first.onload = () => {
      images[0] = first;
      if (disposed) return;
      setReady(true);
      paint();
    };
    first.onerror = () => setFailed(true);
    first.src = frameSrc(0);

    for (let i = 1; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.onload = () => {
        loaded++;
      };
      img.src = frameSrc(i);
      images[i] = img;
    }
    images[0] = first;

    // apply progress -> frame + copy fade. Kept as a function so both the ScrollTrigger and a
    // safety rAF loop can call it; whichever is more current wins.
    const apply = (progress: number) => {
      state.f = progress * (FRAME_COUNT - 1);
      wrap.style.setProperty("--herofade", String(Math.max(0, 1 - progress * 3)));
      paint();
    };

    // scrub:true (not a lerp value) so progress tracks scroll 1:1 — Lenis already smooths the
    // scroll, and a lerped scrub can visibly stall if the ticker hiccups.
    const st = ScrollTrigger.create({
      trigger: wrap,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: (self) => apply(self.progress),
      onRefresh: (self) => apply(self.progress),
    });
    // recompute the trigger's start/end once fonts + the tall layout have settled (some frames
    // + web fonts land late and shift the page height)
    requestAnimationFrame(() => ScrollTrigger.refresh());

    // SAFETY NET: an independent rAF that derives progress straight from the wrapper's own
    // scroll geometry and repaints if it ever diverges. This guarantees the frame can never get
    // "stuck assembled" while the page is scrolled, even if ScrollTrigger/Lenis misbehave.
    let safetyRaf = 0;
    let lastSafe = -1;
    const safety = () => {
      safetyRaf = requestAnimationFrame(safety);
      const r = wrap.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const prog = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      if (Math.abs(prog - lastSafe) > 0.002) {
        lastSafe = prog;
        apply(prog);
      }
    };
    safetyRaf = requestAnimationFrame(safety);

    const onResize = () => {
      ScrollTrigger.refresh();
      paint();
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      st?.kill();
      cancelAnimationFrame(safetyRaf);
      window.removeEventListener("resize", onResize);
      void loaded;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <img
        src={frameSrc(0)}
        alt="The HADES drone, exploded assembly view"
        className="hero-vid-poster"
        draggable={false}
      />
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className={`hero-vid-canvas ${ready ? "is-ready" : ""}`}
      aria-label="The HADES drone assembly, exploding as you scroll"
    />
  );
}
