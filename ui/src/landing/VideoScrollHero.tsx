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

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
      ctx.fillStyle = "#fcfdfd";
      ctx.fillRect(0, 0, cw, ch);
      const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      // bias the crop upward a touch so the airframe sits centered, not buried
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
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

    let st: ScrollTrigger | undefined;
    if (!reduced) {
      st = ScrollTrigger.create({
        trigger: wrap,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.6,
        onUpdate: (self) => {
          state.f = self.progress * (FRAME_COUNT - 1);
          // fade the hero copy (desc + steps) out over the first third of the scrub so it
          // never fights the exploding frames; consumed by CSS via --herofade
          wrap.style.setProperty("--herofade", String(Math.max(0, 1 - self.progress * 3)));
          paint();
        },
      });
    }

    const onResize = () => paint();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      st?.kill();
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
