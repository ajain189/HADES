import { useEffect, useRef, useState } from "react";

/* Before/after detection wipe. Both halves are REAL: the same HERIDAL holdout frame, raw vs.
 * with the shipped fine-tune's detections drawn (native pixels, no synthesis). Draggable
 * divider + keyboard (arrow keys) + an initial scroll-tied sweep so the reveal reads without
 * interaction. */

const BASE = import.meta.env.BASE_URL ?? "/";

export function BeforeAfter() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);
  // once the user touches/keys the slider, the auto-sweep may never write pos again: a ref
  // (not a closure flag) so an already-queued rAF tick can't race a pointer interaction
  const interacted = useRef(false);

  // one slow auto-sweep (35% → 62%) as the block scrolls into view, so the effect is legible
  // before the user ever touches it.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || interacted.current) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          if (interacted.current) return;
          const k = Math.min(1, (t - t0) / 2200);
          // easeInOutCubic
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          setPos(35 + e * 27);
          if (k < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  const setFromClientX = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.min(96, Math.max(4, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      ref={wrapRef}
      className="ba-wrap"
      onPointerDown={(e) => {
        interacted.current = true;
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
    >
      {/* base layer = the HADES-detections frame; the unaided frame is clipped ON TOP from the
          LEFT, so the divider wipes: left of the handle = unaided eye, right = HADES contacts */}
      <img src={`${BASE}landing/ba-after.jpg`} alt="Same frame with HADES detections" draggable={false} />
      <div className="ba-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={`${BASE}landing/ba-before.jpg`} alt="Aerial search frame, unaided eye" draggable={false} />
      </div>
      <div
        className="ba-handle"
        style={{ left: `${pos}%` }}
        role="slider"
        aria-label="Reveal detections"
        aria-valuenow={Math.round(pos)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onKeyDown={(e) => {
          interacted.current = true;
          if (e.key === "ArrowLeft") setPos((p) => Math.max(4, p - 4));
          if (e.key === "ArrowRight") setPos((p) => Math.min(96, p + 4));
        }}
      >
        <span className="ba-grip" />
      </div>
      <span className="ba-tag ba-tag-left">Unaided eye</span>
      <span className="ba-tag ba-tag-right">HADES, 5 contacts</span>
    </div>
  );
}
