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
        <h2 className="display text-4xl md:text-6xl">The pipeline</h2>
        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {PIPELINE.map((p, i) => (
            <RevealCard key={p.title} delayMs={i * 90}>
              <span className="mono text-sm text-[var(--ink-faint)]">0{i + 1}</span>
              <h3 className="display mt-3 text-2xl">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-[var(--ink-soft)]">{p.body}</p>
            </RevealCard>
          ))}
        </div>
      </div>
    </section>
  );
}

function RevealCard({ children, delayMs }: { children: React.ReactNode; delayMs: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="reveal lift rounded-[20px] border border-[var(--hairline)] bg-[var(--paper)] p-8"
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/* ---- proof: big mono figures, staggered ---- */
const METRICS = [
  { value: "0.55", unit: "recall", note: "shipped model, HERIDAL test split" },
  { value: "1.1", unit: "m median", note: "localization error vs. ground truth" },
  { value: "22.4", unit: "ms p95", note: "in-app glass-to-glass (dev floor)" },
  { value: "16", unit: "GB Air", note: "runs offline on a field laptop" },
];
function Metrics() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="proof" className="px-6 py-28 md:px-12 md:py-40">
      <div ref={ref} className="reveal mx-auto max-w-6xl">
        <h2 className="display text-4xl md:text-6xl">Measured, not claimed.</h2>
        <p className="mt-6 max-w-2xl text-lg text-[var(--ink-soft)]">
          Every number here is validated against a labeled ground-truth set and reported honestly —
          including where it falls short.
        </p>
        <div className="mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((m, i) => (
            <MetricFig key={m.unit} m={m} delayMs={i * 90} />
          ))}
        </div>
      </div>
    </section>
  );
}
function MetricFig({ m, delayMs }: { m: (typeof METRICS)[number]; delayMs: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="reveal border-t border-[var(--ink)] pt-5"
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
    >
      <div className="mono display text-5xl md:text-6xl">{m.value}</div>
      <div className="mono mt-2 text-sm text-[var(--ink)]">{m.unit}</div>
      <div className="mt-1 text-sm text-[var(--ink-faint)]">{m.note}</div>
    </div>
  );
}

/* ---- in action: 2-up cards (scrub-rise for depth), links the demo ---- */
function InAction() {
  const ref = useReveal<HTMLDivElement>();
  const scrub = useScrub<HTMLDivElement>();
  return (
    <section className="bg-[var(--paper-alt)] px-6 py-28 md:px-12 md:py-40">
      <div ref={ref} className="reveal mx-auto max-w-6xl">
        <h2 className="display text-4xl md:text-6xl">See it in action</h2>
        <p className="mt-6 max-w-2xl text-lg text-[var(--ink-soft)]">
          A replayable mission runs the real localizer against a known scene — pins, ellipses, and
          confidence are live output, not mock-ups.
        </p>
        <div ref={scrub} className="scrub-rise mt-14 grid gap-4 md:grid-cols-2">
          <a
            href={DEMO_URL}
            className="lift group block overflow-hidden rounded-[20px] bg-[var(--ink)] p-10 text-white"
          >
            <span className="mono text-sm text-[var(--accent)]">● LIVE DEMO</span>
            <h3 className="display mt-4 text-3xl">Replay a mission</h3>
            <p className="mt-3 max-w-sm leading-relaxed text-white/70">
              Watch survivors get detected, localized, and plotted on the live coordinator map.
            </p>
            <span className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-white">
              Open the demo
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </a>
          <div className="lift overflow-hidden rounded-[20px] border border-[var(--hairline)] bg-[var(--paper)] p-10">
            <span className="mono text-sm text-[var(--ink-faint)]">THE LOOP</span>
            <h3 className="display mt-4 text-3xl">Frame → contact → pin</h3>
            <p className="mt-3 max-w-sm leading-relaxed text-[var(--ink-soft)]">
              Detections carry the frame they belong to, so the box, the survivor record, and the
              map pin always line up — even as the feed and the geometry move.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- FAQ accordion ---- */
const FAQS = [
  { q: "What is HADES?", a: "A desktop ground-control station for post-hurricane search and rescue: it ingests a live FPV-drone video feed, detects people, computes their coordinates, and shows them on a live survivor map." },
  { q: "Does it work without a connection?", a: "Yes — by design. The detect → localize → display loop runs entirely on-device with the network off. Map tiles are pre-cached before a mission; nothing is sent to the cloud." },
  { q: "How accurate is the detection?", a: "The shipped model reports recall 0.55 / precision 0.68 on the HERIDAL aerial-SAR test split — measured against labeled ground truth, with its limits disclosed rather than hidden." },
  { q: "How close are the coordinates?", a: "Median localization error is about 1.1 m versus known ground truth in calibrated tests, and every contact carries an honest uncertainty radius instead of a false-precision pin." },
  { q: "What does it run on?", a: "An Apple-Silicon MacBook — the field baseline is a 16 GB MacBook Air. Video plays at 30 fps; detection runs decoupled at 10 fps or better; glass-to-glass latency stays well under budget." },
  { q: "Does it record or upload video?", a: "No runtime model or tile fetch, no telemetry phone-home. The only optional network use is a user-triggered, post-mission export when connectivity returns." },
];
function Faq() {
  const ref = useReveal<HTMLDivElement>();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="px-6 py-28 md:px-12 md:py-40">
      <div ref={ref} className="reveal mx-auto grid max-w-6xl gap-12 md:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="display text-4xl md:text-6xl">Ask less.<br />Know more.</h2>
          <p className="mt-6 max-w-sm text-[var(--ink-soft)]">
            The questions a coordinator asks before they trust a tool with a life.
          </p>
        </div>
        <ul className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <li key={f.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-[var(--accent)]"
                >
                  <span className="text-lg font-medium">{f.q}</span>
                  {isOpen ? <Minus size={20} aria-hidden /> : <Plus size={20} aria-hidden />}
                </button>
                <div
                  className="grid transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
                >
                  <div className="overflow-hidden">
                    <p className="pb-6 pr-8 leading-relaxed text-[var(--ink-soft)]">{f.a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---- footer: the black block ---- */
function Footer() {
  return (
    <footer className="relative z-10 bg-[var(--ink)] px-6 py-24 text-white md:px-12 md:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <h2 className="display text-5xl md:text-7xl">
            Find them<br />
            <span className="text-[var(--accent)]">faster.</span>
          </h2>
          <p className="mt-6 max-w-sm text-white/60">
            Between a demo and a fielded tool — built for the hour after the storm.
          </p>
        </div>
        <FooterCol title="Explore" links={[{ label: "Live demo", href: DEMO_URL }, { label: "Documentation", href: `${DEMO_URL}#docs` }]} />
        <FooterCol title="Project" links={[{ label: "GitHub", href: "https://github.com" }, { label: "HERIDAL · SARD", href: "#proof" }]} />
      </div>
      <div className="mx-auto mt-16 flex max-w-6xl items-center justify-between border-t border-white/10 pt-8 text-sm text-white/40">
        <span className="mono">HADES — Ground Control</span>
        <span>On-device search &amp; rescue.</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h3 className="mono text-sm uppercase tracking-wide text-white/40">{title}</h3>
      <ul className="mt-4 space-y-3">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="text-white/80 transition-colors hover:text-white">{l.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
