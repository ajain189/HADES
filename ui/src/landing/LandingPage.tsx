import { ArrowRight, Minus, Plus } from "lucide-react";
import { useState } from "react";

import { useReveal } from "./useReveal";
import { useScrollProgress, useScrub } from "./useScroll";

/* The HADES front-facing DEMONSTRATION site (CuboCruise-style) with a SMOOTH scroll-motion layer:
 * a pinned full-height hero the content scrolls OVER (the overlay feel), parallax/scrub on the
 * hero media + word, a scroll-progress bar, staggered reveals, and lift-on-hover cards. Clean
 * white surface, giant restrained display type, one black moment. Demonstrates the SAR system and
 * leads into the live demo; every number is real + honest. Blueprint:
 * docs/plans/2026-06-26-hades-landing-page.md. Reverse-engineered from cubocruise.com. */

const LOGO = `${import.meta.env.BASE_URL ?? "/"}docs/HADES_logo.png`;
const DEMO_URL = "./index.html";

export function LandingPage() {
  const progress = useScrollProgress();
  return (
    <div className="landing">
      <div className="scroll-progress" style={{ transform: `scaleX(${progress})`, width: "100%" }} />
      <Nav />
      <PinnedHero />
      {/* everything below scrolls OVER the pinned hero on a raised panel */}
      <div className="over-panel">
        <WhatItIs />
        <Pipeline />
        <Metrics />
        <InAction />
        <Faq />
      </div>
      <Footer />
    </div>
  );
}

/* ---- nav: sticky, frosted ---- */
function Nav() {
  return (
    <header
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-5 backdrop-blur-md md:px-12"
      style={{ backgroundColor: "rgba(255,255,255,0.7)" }}
    >
      <span className="display text-xl">HADES</span>
      <nav className="hidden gap-8 text-sm text-[var(--ink-soft)] md:flex">
        <a href="#what" className="transition-colors hover:text-[var(--ink)]">What it is</a>
        <a href="#pipeline" className="transition-colors hover:text-[var(--ink)]">Pipeline</a>
        <a href="#proof" className="transition-colors hover:text-[var(--ink)]">Proof</a>
        <a href="#faq" className="transition-colors hover:text-[var(--ink)]">FAQ</a>
      </nav>
      <a href={DEMO_URL} className="pill bg-[var(--ink)] px-5 py-2 text-sm font-medium text-white">
        Live demo
      </a>
    </header>
  );
}

/* ---- pinned hero: full-height, the logo floats with parallax, the giant word drifts; the page
   content below scrolls up OVER it (the "overlay" effect). ---- */
function PinnedHero() {
  const scrub = useScrub<HTMLDivElement>();
  return (
    <section ref={scrub} className="pin-hero bg-[var(--ink)]">
      {/* radial orange glow behind the product */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 45%, rgba(232,83,31,0.18), rgba(11,11,12,0) 70%)",
        }}
      />
      <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="scrub-hero-word display text-[22vw] leading-none text-white md:text-[16vw]">
          HADES
        </h1>
        <img
          src={LOGO}
          alt="HADES"
          draggable={false}
          className="scrub-hero-media mt-2 h-48 w-auto select-none object-contain drop-shadow-[0_12px_60px_rgba(232,83,31,0.35)] md:h-72"
        />
        <p className="mt-8 max-w-md text-base leading-relaxed text-white/70">
          A ground-control station for post-hurricane search and rescue — it turns a live drone
          feed into located survivors on a map, on a laptop, with the network off.
        </p>
        <a
          href={DEMO_URL}
          className="pill mt-8 flex items-center gap-2 bg-white px-6 py-3 text-sm font-medium text-[var(--ink)]"
        >
          See the live demo <ArrowRight size={16} aria-hidden />
        </a>
        <span className="mono absolute bottom-8 text-xs tracking-widest text-white/40">
          SCROLL ↓
        </span>
      </div>
    </section>
  );
}

/* ---- what it is ---- */
function WhatItIs() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="what" className="px-6 py-28 md:px-12 md:py-40">
      <div ref={ref} className="reveal mx-auto max-w-4xl">
        <h2 className="display text-4xl md:text-6xl">
          When every minute counts,
          <br />
          <span className="text-[var(--ink-faint)]">it finds people faster.</span>
        </h2>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-[var(--ink-soft)]">
          After a hurricane, a coordinator watches a live feed from an FPV drone, runs real-time
          human detection on every frame, computes each survivor&rsquo;s real-world coordinates,
          and plots them on a live map — with an honest uncertainty radius, never a false pin. The
          whole loop runs on-device: no cloud, no connection required.
        </p>
      </div>
    </section>
  );
}

/* ---- pipeline: rounded feature cards, staggered reveal + lift-on-hover ---- */
const PIPELINE = [
  { title: "Detect", body: "A fine-tuned YOLO model finds people in aerial frames, in real time, on the laptop's neural engine." },
  { title: "Localize", body: "Each detection becomes a ground coordinate by ray–earth intersection, with a Monte-Carlo uncertainty radius." },
  { title: "Coordinate", body: "One contact, three projections — map, video, list — over a single selection, so the operator never loses a survivor." },
  { title: "Offline by design", body: "Detect, localize, and display run with the network off. Pre-cached map tiles; nothing phones home." },
];
function Pipeline() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="pipeline" className="bg-[var(--paper-alt)] px-6 py-28 md:px-12 md:py-40">
      <div ref={ref} className="reveal mx-auto max-w-6xl">
