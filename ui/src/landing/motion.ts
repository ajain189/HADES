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
  up: { autoAlpha: 0, y: 90, filter: "blur(6px)" },
  left: { autoAlpha: 0, x: -120, filter: "blur(6px)" },
  right: { autoAlpha: 0, x: 120, filter: "blur(6px)" },
  zoom: { autoAlpha: 0, y: 60, scale: 1.08, filter: "blur(4px)" },
};
const TO: gsap.TweenVars = { autoAlpha: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" };

export function useReveals(deps: unknown[] = []) {
  useEffect(() => {
    const els = gsap.utils.toArray<HTMLElement>("[data-reveal]");
    if (els.length === 0) return;
    // Under reduced motion we DON'T kill the reveal to a static state — that left the page
    // lifeless (and, worse, depended on other scroll animations that share this gate). Instead,
    // every element still reveals on scroll, but as an OPACITY-ONLY fade: no translate, no blur,
    // no scale. This respects the intent of the setting (zero positional/vestibular motion) while
    // the content still animates in, exactly the Cubo approach. Content is never left hidden.
    if (REDUCED) {
      const tweens = els.map((el) => {
        const aboveFold = el.getBoundingClientRect().top < window.innerHeight * 0.9;
        if (aboveFold) {
          return gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, ease: "none", delay: 0.1 });
        }
        return gsap.fromTo(
          el,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: 0.5,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top 92%", toggleActions: "play none none none", once: true },
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
    }
    const vh = window.innerHeight;
    const tweens = els.map((el) => {
      const dir = el.getAttribute("data-reveal") || "up";
      // index among data-reveal SIBLINGS sharing the same parent, so grouped items (metric
      // grid, card rows, proof points) cascade in rather than popping together.
      const siblings = el.parentElement
        ? Array.from(el.parentElement.children).filter((c) => c.hasAttribute("data-reveal"))
        : [el];
      const idx = Math.max(0, siblings.indexOf(el));
      // anything already in the top ~90% of the viewport on load animates in immediately
      // (a soft entrance), since it will never scroll DOWN through a below-the-fold trigger.
      const aboveFold = el.getBoundingClientRect().top < vh * 0.9;
      if (aboveFold) {
        return gsap.fromTo(el, FROM[dir] ?? FROM.up, {
          ...TO,
          duration: 1.1,
          ease: "power3.out",
          delay: 0.2 + idx * 0.09,
        });
      }
      // TRIGGER-ONCE with a real time-based duration (NOT scrub): when the element enters view
      // it plays a full ~0.9s fade+rise regardless of scroll speed. Scrubbed reveals completed
      // in a fraction of a second under fast/smooth scrolling, so they read as "just there".
      // The per-sibling stagger makes grouped rows cascade.
      return gsap.fromTo(
        el,
        FROM[dir] ?? FROM.up,
        {
          ...TO,
          duration: 0.95,
          ease: "power3.out",
          delay: idx * 0.1,
          scrollTrigger: {
            trigger: el,
            start: "top 86%",
            toggleActions: "play none none none",
            once: true,
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
