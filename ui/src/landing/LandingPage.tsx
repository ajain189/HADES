import { ArrowRight, ArrowUpRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BeforeAfter } from "./BeforeAfter";
import { DroneHero } from "./DroneHero";
import { gsap, REDUCED, ScrollTrigger, useParallax, useReveals, useSmoothScroll } from "./motion";

/* HADES demonstration site v3. One family (Archivo), one accent (the logo teal), warm
 * tinted neutrals, native-sticky pinning, and a hero you can grab. Every product image is
 * real output; every number is measured. No demo links: the site shows, it does not hand
 * out the console. */

const BASE = import.meta.env.BASE_URL ?? "/";
const A = (p: string) => `${BASE}landing/${p}`;

/* ---------------- hash router ---------------- */
type Route = "home" | "technology" | "team";
function parseRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  return h === "technology" || h === "team" ? h : "home";
}

export function LandingPage() {
  const [route, setRoute] = useState<Route>(parseRoute);
  useSmoothScroll();
  useEffect(() => {
    const onHash = () => {
      ScrollTrigger.getAll().forEach((t) => t.kill());
      window.scrollTo(0, 0);
      setRoute(parseRoute());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useReveals([route]);
  useParallax([route]);

  return (
    <div className="landing">
      <Nav route={route} />
      {route === "home" && <Home />}
      {route === "technology" && <Technology />}
      {route === "team" && <Team />}
      <Footer />
    </div>
  );
}

/* ---------------- nav ---------------- */
function Nav({ route }: { route: Route }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const link = (to: Route, label: string) => (
    <a href={to === "home" ? "#/" : `#/${to}`} className={`nav-link ${route === to ? "is-active" : ""}`}>
      {label}
    </a>
  );
  return (
    <header className={`site-nav ${scrolled ? "is-scrolled" : ""}`}>
      <a href="#/" className="nav-brand" aria-label="HADES home">
        <img src={A("logo.png")} alt="" />
        <span>HADES</span>
      </a>
      <nav className="nav-links">
        {link("home", "Overview")}
        {link("technology", "Technology")}
        {link("team", "Team")}
      </nav>
    </header>
  );
}

/* =================================================================== HOME */
function Home() {
  return (
    <main>
      <Hero />
      <Statement />
      <LogoStrip />
      <SeeSection />
      <PipelineRail />
      <Showcase />
      <Inspiration />
      <MetricsSection />
      <Closing />
    </main>
  );
}

/* ---- hero: sticky inside a tall wrapper; the airframe opens as you scroll ---- */
const HERO_WORDS = ["Detect", "Localize", "Confirm", "Coordinate"];
function Hero() {
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div className="hero-wrap" ref={wrapRef}>
      <section className="hero">
        <h1 className="hero-word" aria-label="HADES">
          <img src={A("logo.png")} alt="" className="hero-word-mark" />
          {"HADES".split("").map((ch, i) => (
            <span
              key={i}
              className="hero-ch"
              style={{ "--ci": String((i * 7) % 10) } as React.CSSProperties}
            >
              {ch}
            </span>
          ))}
        </h1>

        <DroneHero wrapRef={wrapRef} />

        <p className="hero-desc">
          A ground control station for post hurricane search and rescue.
          <br />
          Built by students at NCSSM.
        </p>

        <ol className="hero-steps" aria-hidden>
          {HERO_WORDS.map((w, i) => (
            <li key={w} style={{ "--si": String(i) } as React.CSSProperties}>
              {w}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/* ---- statement: the promise, revealed word by word as you scroll through it ---- */
const STATEMENT =
  "HADES turns a live drone feed into located survivors on a map. Real time detection, real world coordinates, one laptop, no network.";
function Statement() {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || REDUCED) return;
    const words = el.querySelectorAll<HTMLElement>("span");
    const tween = gsap.fromTo(
      words,
      { opacity: 0.14 },
      {
        opacity: 1,
        ease: "none",
        stagger: 0.06,
        scrollTrigger: { trigger: el, start: "top 78%", end: "bottom 45%", scrub: 0.4 },
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);
  return (
    <section className="statement">
      <h2 className="statement-kick" data-reveal>
        Find them faster.
      </h2>
      <p ref={ref} className="statement-text">
        {STATEMENT.split(" ").map((w, i) => (
          <span key={i}>{w} </span>
        ))}
      </p>
    </section>
  );
}

/* ---- recognition ---- */
const LOGOS = [
  { src: "logos/duke-pratt.svg", alt: "Duke Pratt School of Engineering", h: 46 },
  { src: "logos/mit-csail.svg", alt: "MIT CSAIL", h: 62 },
  { src: "logos/ncsef.png", alt: "North Carolina Science and Engineering Fair", h: 58 },
  { src: "logos/samsung-sft.png", alt: "Samsung Solve for Tomorrow", h: 68 },
];
function LogoStrip() {
  return (
    <section className="logo-strip" data-reveal>
      <p className="logo-strip-label">Recognized and supported by</p>
      <div className="logo-strip-row">
        {LOGOS.map((l) => (
          <img key={l.src} src={A(l.src)} alt={l.alt} style={{ height: l.h }} loading="lazy" />
        ))}
      </div>
    </section>
  );
}

/* ---- the before/after moment ---- */
function SeeSection() {
  return (
    <section className="section">
      <div className="section-head" data-reveal="left">
        <h2 className="section-title">
          See what the eye
          <br />
          <span className="ink-faint">cannot.</span>
        </h2>
        <p className="section-lede">
          A survivor is a handful of pixels in a four thousand pixel aerial frame. This is a real
          frame from the HERIDAL search and rescue test set. Drag the divider: every box is live
          output from the shipped model, not an illustration.
        </p>
      </div>
      <div data-reveal="zoom">
        <BeforeAfter />
      </div>
    </section>
  );
}

/* ---- pipeline: pin-free horizontal drift ---- */
const STEPS = [
  {
    n: "01",
    title: "Detect",
    body: "A YOLO11 model fine tuned on aerial search imagery finds people in every frame, running on the laptop's neural engine at ten frames a second while video plays at thirty.",
  },
  {
    n: "02",
    title: "Localize",
    body: "Each detection becomes a ray from the camera through the aircraft's pose, intersected with the ground: a real coordinate with an honest uncertainty radius, never a false precision pin.",
  },
  {
    n: "03",
    title: "Confirm",
    body: "Tracks persist across frames and cluster in world space. Confidence builds and contacts get promoted. Visibility is never gated, only priority.",
  },
  {
    n: "04",
    title: "Coordinate",
    body: "One contact, three views: map, video, list, over a single selection. The operator never loses a survivor between views, and every event lands in the mission log.",
  },
];
function PipelineRail() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track || REDUCED || window.innerWidth < 900) return;
    const overflow = () => Math.max(0, track.scrollWidth - section.clientWidth + 96);
    const tween = gsap.fromTo(
      track,
      { x: () => overflow() * 0.18 },
      {
        x: () => -overflow(),
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top 85%",
          end: "bottom 15%",
          scrub: 0.5,
          invalidateOnRefresh: true,
        },
      },
    );
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);
  return (
    <section className="rail-section" ref={sectionRef}>
      <div className="section-head rail-head">
        <h2 className="section-title">Frame to found.</h2>
      </div>
      <div className="rail-track" ref={trackRef}>
        {STEPS.map((s) => (
          <article key={s.n} className="rail-card">
            <span className="rail-num">{s.n}</span>
            <h3 className="rail-title">{s.title}</h3>
            <p className="rail-body">{s.body}</p>
          </article>
        ))}
        <article className="rail-card rail-card-dark">
          <span className="rail-num">05</span>
          <h3 className="rail-title">Offline, by design</h3>
          <p className="rail-body">
            The whole loop runs with the network off. Map tiles are cached before the mission,
            inference stays on the laptop, nothing phones home. Built for the hour after the
            storm, when nothing else works.
          </p>
        </article>
      </div>
    </section>
  );
}

/* ---- the ground station, shown not linked ---- */
function Showcase() {
  return (
    <section className="section">
      <div className="section-head" data-reveal="right">
        <h2 className="section-title">One screen runs the search.</h2>
        <p className="section-lede">
          The coordinator's view: live aerial imagery with the flight path, confirmed contacts
          with their confidence, the camera with its detections, and a mission timeline. The
          scene below is a real search frame and the four contacts are real model output.
        </p>
      </div>
      <figure className="shot" data-reveal="zoom" data-parallax="0.05">
        <img
          src={A("dashboard.png")}
          alt="The HADES ground control screen: aerial search area with flight path and four located contacts, camera feed with a detection, contact list and mission timeline"
        />
      </figure>
      <dl className="shot-notes">
        <div data-reveal="left">
          <dt>One selection</dt>
          <dd>Click a survivor anywhere and the map, the video, and the list agree.</dd>
        </div>
        <div data-reveal>
          <dt>Honest uncertainty</dt>
          <dd>Every contact carries a radius you can trust, never a pin that lies.</dd>
        </div>
        <div data-reveal="right">
          <dt>Video never blocks</dt>
          <dd>Detection can fall behind under load. The feed and the operator do not.</dd>
        </div>
      </dl>
    </section>
  );
}

/* ---- why we built it ---- */
function Inspiration() {
  return (
    <section className="inspo">
      <div className="inspo-grid">
        <div className="inspo-copy" data-reveal="left">
          <h2 className="section-title">It started with our friends.</h2>
          <p>
            NCSSM is a residential school. Our classmates come from every corner of North
            Carolina, and when Hurricane Helene hit the western part of the state, some of their
            families and hometowns were cut off: no cell service, no power, roads gone.
          </p>
          <p>
            We kept asking the same question. When nothing works, how do you find people fast?
            We decided our answer would come from the skills we already had: drones, math, and
            code. HADES is that answer, built end to end at our desks and on our workbench.
          </p>
        </div>
        <figure className="inspo-photo" data-reveal="right" data-parallax="0.06">
          <img src={A("team.jpg")} alt="The HADES team at NCSSM" />
          <figcaption>The team, at school in Durham</figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ---- measured, not claimed ---- */
const METRICS = [
  { value: 0.85, fmt: (v: number) => v.toFixed(2), unit: "recall", note: "current model on the HERIDAL test split" },
  { value: 1.1, fmt: (v: number) => v.toFixed(1), unit: "meters median error", note: "localization against surveyed ground truth" },
  { value: 22.4, fmt: (v: number) => v.toFixed(1), unit: "ms glass to glass", note: "95th percentile in-app latency" },
  { value: 32, fmt: (v: number) => String(Math.round(v)), unit: "GB MacBook Air", note: "the whole system, offline, in the field" },
];
function MetricsSection() {
  return (
    <section className="section section-tight">
      <div className="section-head" data-reveal>
        <h2 className="section-title">Measured, not claimed.</h2>
        <p className="section-lede">
          Every number is validated against labeled ground truth and reported honestly,
          including where it falls short.
        </p>
      </div>
      <div className="metric-grid">
        {METRICS.map((m) => (
          <Metric key={m.unit} m={m} />
        ))}
      </div>
    </section>
  );
}
function Metric({ m }: { m: (typeof METRICS)[number] }) {
  const numRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = numRef.current;
    if (!el) return;
    if (REDUCED) {
      el.textContent = m.fmt(m.value);
      return;
    }
    const state = { v: 0 };
    const tween = gsap.to(state, {
      v: m.value,
      duration: 1.4,
      ease: "power4.out",
      scrollTrigger: { trigger: el, start: "top 85%", once: true },
      onUpdate: () => {
        el.textContent = m.fmt(state.v);
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [m]);
  return (
    <div className="metric" data-reveal>
      <span className="metric-num" ref={numRef}>
        0
      </span>
      <span className="metric-unit">{m.unit}</span>
      <span className="metric-note">{m.note}</span>
    </div>
  );
}

/* ---- closing ---- */
function Closing() {
  return (
    <section className="closing" data-reveal>
      <h2 className="closing-title">
        Built for the hour
        <br />
        after the storm.
      </h2>
      <a href="#/technology" className="pill pill-dark">
        Explore the technology <ArrowRight size={16} aria-hidden />
      </a>
    </section>
  );
}

/* =================================================================== TECHNOLOGY */
const FAQS = [
  { q: "Does it work without a connection?", a: "Yes, by design. Detect, localize, and display run entirely on the laptop with the network off. Map tiles are cached before a mission and nothing is sent to the cloud." },
  { q: "How accurate is the detection?", a: "The current model reaches 0.85 recall on the HERIDAL aerial search test split, measured against labeled ground truth, with its limits disclosed rather than hidden." },
  { q: "How close are the coordinates?", a: "Median localization error is about 1.1 meters against known ground truth in calibrated tests, and every contact carries an honest uncertainty radius instead of a false precision pin." },
  { q: "What does it run on?", a: "An Apple Silicon MacBook. The field machine is a 32 GB MacBook Air. Video plays at 30 frames a second, detection runs decoupled at 10 or better, and latency stays inside the 120 ms budget." },
  { q: "What is the aircraft?", a: "A 3D printed airframe over an F405 flight controller, 2306 motors, a DJI O4 Pro air unit for the video link, ELRS for control and telemetry, and a 6S battery. The hero model is the actual CAD assembly, and every part is listed below." },
  { q: "What happens when it finds someone?", a: "The detection becomes a tracked contact, gets confirmed across frames, and lands on the map with coordinates and an uncertainty radius. Every event is written to the mission log so a coordinator can task a ground team immediately." },
  { q: "Does it record or upload video?", a: "No model or tile fetch at runtime and no telemetry phoning home. The only optional network use is an operator triggered export after the mission, once connectivity returns." },
];
function Technology() {
  return (
    <main className="page">
      <section className="section page-hero">
        <h1 className="page-title" data-reveal>
          A search party
          <br />
          <span className="ink-faint">in a backpack.</span>
        </h1>
        <p className="section-lede" data-reveal>
          Two processes on one laptop: a Python detection service that captures, detects, and
          georeferences, and a coordinator interface, joined by two local sockets carrying
          frames on one side and detections with telemetry on the other, aligned frame for
          frame.
        </p>
      </section>

      <section className="section section-tight">
        <ol className="tech-list">
          {[
            {
              t: "Detection that earns its recall",
              p: "YOLO11s, fine tuned on the HERIDAL and SARD aerial search datasets and exported to Core ML for the Apple Neural Engine. Input resolution 960, chosen because recall peaks there on held out scenes while clearing the frame budget six times over.",
            },
            {
              t: "Coordinates with honesty attached",
              p: "Each detection is projected by monocular ray to ground intersection from the aircraft's position, altitude, and camera pose. Confirmed contacts are fused across frames with a Monte Carlo uncertainty estimate.",
            },
            {
              t: "Video that never blocks",
              p: "The feed decodes in hardware and always displays at full frame rate. Detection runs decoupled and drops to latest. Under load the boxes thin out; the video never stutters.",
            },
            {
              t: "Degrades gracefully",
              p: "Link loss, dropped frames, mid stream resolution changes, a throttled fanless laptop. The pipeline is built against all of them, and the field target is a stock MacBook Air with the network off.",
            },
          ].map((row, i) => (
            <li key={row.t} className="tech-row" data-reveal={i % 2 ? "right" : "left"}>
              <span className="tech-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{row.t}</h3>
              <p>{row.p}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section section-tight">
        <div className="section-head" data-reveal>
          <h2 className="section-title">The aircraft, part by part.</h2>
          <p className="section-lede">
            The drone is built, not bought: every component below is on the workbench today, and
            the assembly you can spin on the home page is its actual CAD.
          </p>
        </div>
        <ul className="craft-list">
          {[
            { part: "3D printed airframe", role: "A monocoque printed in-house. It carries the whole stack and survives the crashes that teach us." },
            { part: "DJI O4 Pro air unit and camera", role: "The digital video link. It flies the survivor's eye view back to the laptop in real time." },
            { part: "F405 flight controller", role: "Keeps the aircraft level and streams attitude and GPS telemetry, which the localizer needs to turn pixels into coordinates." },
            { part: "ELRS receiver", role: "The control link. Long range, low latency, and a second telemetry path over serial." },
            { part: "2306 motors with 5 inch tri-blades", role: "Four of each. Sized for wind that follows a storm, not for racing." },
            { part: "6S battery", role: "The flight window. Every design choice upstream is measured against the minutes it buys." },
          ].map((c, i) => (
            <li key={c.part} className="craft-row" data-reveal={i % 2 ? "right" : "left"}>
              <strong>{c.part}</strong>
              <span>{c.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="section faq-section">
        <div className="faq-grid">
          <div>
            <h2 className="section-title" data-reveal>
              The hard questions.
            </h2>
            <Faq />
          </div>
          <figure className="faq-photo" data-reveal="right">
            <img src={A("drone-build-1.jpg")} alt="The assembled HADES airframe held in one hand" />
          </figure>
        </div>
      </section>
    </main>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <ul className="faq" data-reveal>
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <li key={f.q}>
            <button type="button" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen} className="faq-q">
              <span>{f.q}</span>
              {isOpen ? <Minus size={20} aria-hidden /> : <Plus size={20} aria-hidden />}
            </button>
            <div className="faq-a" style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
              <div>
                <p>{f.a}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* =================================================================== TEAM */
function Team() {
  return (
    <main className="page">
      <section className="section page-hero">
        <h1 className="page-title" data-reveal>
          Students who
          <br />
          <span className="ink-faint">ship hardware.</span>
        </h1>
        <p className="section-lede" data-reveal>
          HADES is built by a student team at the North Carolina School of Science and
          Mathematics: airframe, avionics, detection model, localization math, and the
          coordinator interface, end to end.
        </p>
      </section>

      <figure className="team-photo" data-reveal="zoom">
        <img src={A("team.jpg")} alt="The HADES team" />
        <figcaption>The HADES team, NCSSM</figcaption>
      </figure>

      <section className="section">
        <div className="section-head" data-reveal>
          <h2 className="section-title">Built, not bought.</h2>
          <p className="section-lede">
            The airframe is printed, the stack is soldered, and the code is ours. The assembly
            you can spin on the home page exists on a workbench.
          </p>
        </div>
        <div className="build-grid">
          <figure className="build-shot" data-reveal="left">
            <img src={A("drone-build-1.jpg")} alt="The assembled HADES airframe in hand" loading="lazy" />
            <figcaption>First assembly, motors mounted</figcaption>
          </figure>
          <figure className="build-shot" data-reveal="right">
            <img src={A("drone-build-2.jpg")} alt="The HADES workbench mid build" loading="lazy" />
            <figcaption>The bench, avionics and iteration</figcaption>
          </figure>
        </div>
      </section>

      <section className="section section-tight">
        <div className="section-head" data-reveal>
          <h2 className="section-title">Recognition.</h2>
        </div>
        <ul className="honor-list">
          {[
            { logo: "logos/samsung-sft.png", name: "Samsung Solve for Tomorrow", note: "national program, community problem engineering" },
            { logo: "logos/ncsef.png", name: "NC Science and Engineering Fair", note: "state level competition" },
            { logo: "logos/duke-pratt.svg", name: "Duke Pratt School of Engineering", note: "mentorship and review" },
            { logo: "logos/mit-csail.svg", name: "MIT CSAIL", note: "research guidance" },
          ].map((h) => (
            <li key={h.name} className="honor-row" data-reveal>
              <img src={A(h.logo)} alt="" />
              <div>
                <strong>{h.name}</strong>
                <span>{h.note}</span>
              </div>
              <ArrowUpRight size={18} className="honor-arrow" aria-hidden />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/* ---------------- footer ---------------- */
function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-panel">
        <div className="footer-grid">
          <div data-reveal="left">
            <h2 className="footer-title">Find them faster.</h2>
            <p className="footer-sub">Between a demo and a fielded tool. Built for the hour after the storm.</p>
          </div>
          <div className="footer-col" data-reveal>
            <h3>Explore</h3>
            <a href="#/">Overview</a>
            <a href="#/technology">Technology</a>
            <a href="#/team">Team</a>
          </div>
          <div className="footer-col" data-reveal="right">
            <h3>School</h3>
            <a href="https://www.ncssm.edu" rel="noreferrer" target="_blank">
              NCSSM
            </a>
          </div>
        </div>
        <div className="footer-base">
          <span>HADES Ground Control</span>
          <span>On device search and rescue</span>
        </div>
        <div className="footer-word" data-reveal="zoom" aria-hidden>
          HADES
        </div>
      </div>
    </footer>
  );
}
