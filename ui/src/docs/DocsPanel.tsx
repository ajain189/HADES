import { X } from "lucide-react";

import {
  DOC_HONESTY,
  DOC_INTRO,
  DOC_SECTIONS,
  DOC_TAGLINE,
  DOC_TOOLS,
  type DocFigure,
} from "./docsContent";

/* Phase 7 Task 7.6 - the in-app docs panel. Renders the single docs source (docsContent.ts)
 * styled to the design system, so the same content the README carries appears inside the
 * Electron app, the web app, and the demo site (all three share this UI). Asset URLs resolve
 * relative to the page base so figures load under file://, a Pages subpath, and a server root. */

const BASE = import.meta.env.BASE_URL ?? "/";
const asset = (p: string) => `${BASE}docs/${p}`;

function Figure({ fig }: { fig: DocFigure }) {
  return (
    <figure className="m-0 overflow-hidden rounded border border-hairline bg-surface-1">
      <img
        data-testid="docs-figure"
        src={asset(fig.src)}
        alt={fig.alt}
        loading="lazy"
        className="block w-full"
      />
      <figcaption className="px-3 py-2 font-mono text-[11px] leading-snug text-text-lo">
        {fig.caption}
      </figcaption>
    </figure>
  );
}

interface DocsPanelProps {
  onClose: () => void;
}

export function DocsPanel({ onClose }: DocsPanelProps) {
  const service = DOC_TOOLS.filter((t) => t.group === "service");
  const ui = DOC_TOOLS.filter((t) => t.group === "ui");

  return (
    <section
      data-testid="docs-panel"
      aria-label="Documentation"
      className="min-h-0 flex-1 overflow-auto bg-bg-base text-text-hi"
    >
      <div className="mx-auto max-w-[1040px] px-8 py-8">
        {/* header: logo + close */}
        <div className="mb-6 flex items-start justify-between gap-6">
          <div className="flex items-center gap-5">
            <img
              data-testid="docs-logo"
              src={asset("HADES_logo.png")}
              alt="HADES"
              className="h-20 w-20 shrink-0"
            />
            <div>
              <h1 className="m-0 text-xl font-semibold tracking-tight text-text-hi">HADES</h1>
              <p className="m-0 mt-1 text-sm text-text-mid">{DOC_TAGLINE}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="docs-close"
            onClick={onClose}
            aria-label="Close documentation"
            className="flex items-center gap-1.5 rounded border border-hairline bg-surface-2 px-3 py-1.5 font-mono text-xs text-text-mid hover:bg-surface-3"
          >
            <X size={14} aria-hidden />
            close
          </button>
        </div>

        <p className="mb-4 max-w-[78ch] text-sm leading-relaxed text-text-mid">{DOC_INTRO}</p>
        <p className="mb-8 max-w-[78ch] rounded border border-hairline bg-surface-1 px-4 py-3 font-mono text-[12px] leading-relaxed text-text-lo">
          {DOC_HONESTY}
        </p>

        {/* metric families */}
        {DOC_SECTIONS.map((section) => (
