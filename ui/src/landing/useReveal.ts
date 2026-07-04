import { useEffect, useRef } from "react";

/* Quiet scroll-reveal via IntersectionObserver (offline-safe, no animation lib). Attach the ref
 * to a `.reveal` element; it gains `.is-visible` once when it scrolls into view (one-shot — the
 * reveal never re-hides, so scrolling back up stays settled). Honors reduced-motion via the CSS
 * (the .reveal rule is neutralized there, so this just no-ops visually). */
export function useReveal<T extends HTMLElement = HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
