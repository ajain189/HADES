import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";

gsap.registerPlugin(ScrollTrigger);

export const REDUCED =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Lenis smooth scroll wired into GSAP's ticker (the canonical pairing): one instance for the
 * whole site. Skipped entirely under reduced motion: native scroll is the accessible path. */
export function useSmoothScroll() {
  useEffect(() => {
    if (REDUCED) return;
    const lenis = new Lenis({ lerp: 0.12, wheelMultiplier: 1 });
    lenis.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);
}

/* Directional scroll reveals, the Cubo grammar: things slide in from the side they belong to.
 *   data-reveal          -> rise from below (default)
 *   data-reveal="left"   -> slide in from the left
 *   data-reveal="right"  -> slide in from the right
 *   data-reveal="zoom"   -> settle from 1.06 scale (large imagery)
 * Initial states are applied per-element and animated once when 12% of the element enters.
 * One easing signature sitewide (the Cubo tween), duration 0.9, small stagger within a batch.
 */
const FROM: Record<string, gsap.TweenVars> = {
  up: { opacity: 0, y: 56 },
  left: { opacity: 0, x: -72 },
  right: { opacity: 0, x: 72 },
  zoom: { opacity: 0, y: 32, scale: 1.05 },
};
const EASE = "cubic-bezier(0.28, 0.41, 0.56, 1)";

export function useReveals(deps: unknown[] = []) {
  useEffect(() => {
    const els = gsap.utils.toArray<HTMLElement>("[data-reveal]");
    if (REDUCED || els.length === 0) {
      els.forEach((el) => (el.style.opacity = "1"));
      return;
    }
    for (const el of els) {
      const dir = el.getAttribute("data-reveal") || "up";
      gsap.set(el, { ...(FROM[dir] ?? FROM.up), overwrite: true });
    }
    const batch = ScrollTrigger.batch(els, {
      start: "top 88%",
      once: true,
      onEnter: (targets) =>
        gsap.to(targets, {
          opacity: 1,
          x: 0,
          y: 0,
          scale: 1,
          duration: 0.9,
          ease: EASE,
          stagger: 0.1,
          overwrite: true,
        }),
    });
    ScrollTrigger.refresh();
    return () => {
      batch.forEach((t) => t.kill());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* Counter-directional parallax, the Cubo depth trick (their hero: image 0.85x, text 1.05x,
 * a 20% relative drift that is felt rather than seen). Any [data-parallax="0.08"] element
 * drifts +/- that fraction of the viewport as it crosses it, scrubbed to scroll. */
export function useParallax(deps: unknown[] = []) {
  useEffect(() => {
    if (REDUCED) return;
    const els = gsap.utils.toArray<HTMLElement>("[data-parallax]");
    const tweens = els.map((el) => {
      const amount = (parseFloat(el.getAttribute("data-parallax") || "0.08") || 0.08) * window.innerHeight;
      return gsap.fromTo(
        el,
        { y: amount },
        {
          y: -amount,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.4 },
        },
      );
    });
    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export { gsap, ScrollTrigger };
