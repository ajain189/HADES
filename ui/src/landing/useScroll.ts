import { useEffect, useRef, useState } from "react";

/* Scroll-motion primitives for the landing site — rAF-throttled, transform-only (GPU), so motion
 * stays smooth and offline-safe (no animation lib). All honor prefers-reduced-motion (the caller
 * neutralizes transforms there). */

const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Page scroll progress 0→1 (for a top progress bar). */
export function useScrollProgress(): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setP(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return p;
}

/* A parallax/scrub element. Attach the returned ref; as the element travels through the viewport
 * the hook writes a 0→1 `progress` (0 = element bottom just entered, 1 = element top just left)
 * to a CSS custom property `--p` on the element, so CSS can drive transforms off it. rAF-batched
 * across all instances via a shared scroll listener-free IntersectionObserver + scroll read. */
export function useScrub<T extends HTMLElement = HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    let raf = 0;
    let active = false;
    const compute = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the element's top reaches the viewport bottom, 1 when its bottom reaches the top
      const total = vh + r.height;
      const travelled = vh - r.top;
      const p = Math.max(0, Math.min(1, travelled / total));
      el.style.setProperty("--p", p.toFixed(4));
    };
    const onScroll = () => {
      if (!active || raf) return;
      raf = requestAnimationFrame(compute);
    };
    // only listen while the element is near the viewport (cheap)
    const io = new IntersectionObserver(
      (entries) => {
        active = entries[0].isIntersecting;
        if (active) onScroll();
      },
      { rootMargin: "100px 0px 100px 0px" },
    );
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    compute();
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}
