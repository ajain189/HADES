import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect } from "react";

gsap.registerPlugin(ScrollTrigger);

export const REDUCED =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Lenis smooth scroll wired into GSAP's ticker (the canonical pairing): one instance for the
 * whole site. A gentle lerp + a long, soft-tail easing gives the slow-motion, glide-to-rest
 * feel. Native scroll (no smoothing, no hijack) under reduced motion. */
export function useSmoothScroll() {
  useEffect(() => {
    if (REDUCED) return;
    const lenis = new Lenis({
      lerp: 0.085, // lower = longer glide; the slow-motion feel
      wheelMultiplier: 0.9,
      // an expo-out tail: quick to respond, long soft settle. Wheel/keys still work natively.
      easing: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    });
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

/* Scroll-linked entrances, the Cubo grammar: each element fades + drifts in from the side it
 * belongs to, SCRUBBED across a scroll range so the motion is tied to scroll position (soft,
 * slow-motion) rather than snapping on a trigger. Transform/opacity only (GPU, 60fps).
 *   data-reveal          -> rise from below (default)
 *   data-reveal="left"   -> from the left
 *   data-reveal="right"  -> from the right
 *   data-reveal="zoom"   -> subtle scale-up settle (large imagery)
 */
const FROM: Record<string, gsap.TweenVars> = {
  up: { autoAlpha: 0, y: 64 },
  left: { autoAlpha: 0, x: -90 },
  right: { autoAlpha: 0, x: 90 },
  zoom: { autoAlpha: 0, y: 40, scale: 1.06 },
};

export function useReveals(deps: unknown[] = []) {
  useEffect(() => {
    const els = gsap.utils.toArray<HTMLElement>("[data-reveal]");
    if (REDUCED || els.length === 0) {
      els.forEach((el) => (el.style.opacity = "1"));
      return;
    }
    const vh = window.innerHeight;
    const tweens = els.map((el) => {
      const dir = el.getAttribute("data-reveal") || "up";
      // anything already in the top ~90% of the viewport on load animates in immediately
      // (a soft entrance), since it will never scroll DOWN through a below-the-fold trigger.
      const aboveFold = el.getBoundingClientRect().top < vh * 0.9;
      if (aboveFold) {
        return gsap.fromTo(
          el,
          FROM[dir] ?? FROM.up,
          { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.9, ease: "power3.out", delay: 0.15 },
        );
      }
      return gsap.fromTo(
        el,
        FROM[dir] ?? FROM.up,
        {
          autoAlpha: 1,
          x: 0,
          y: 0,
          scale: 1,
          ease: "power2.out",
          scrollTrigger: {
            trigger: el,
            // eases in as it travels from near the bottom to comfortably in view
            start: "top 92%",
            end: "top 62%",
            scrub: 0.6,
          },
        },
      );
    });
    ScrollTrigger.refresh();
    return () => {
      tweens.forEach((t) => {
        t.scrollTrigger?.kill();
        t.kill();
      });
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
