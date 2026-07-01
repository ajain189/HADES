import { useMemo, useState } from "react";

import { ContactDetailPanel } from "../components/ContactDetailPanel";
import { MissionLog } from "../components/MissionLog";
import { ConfidenceBar } from "../components/ConfidenceBar";
import { useClearanceStore } from "../store/clearanceStore";
import { buildContactRows } from "../store/contactView";
import { useContactStore } from "../store/contacts";
import { useSelectionStore } from "../store/selection";
import type { ClearanceState } from "../store/clearance";
import { contactStatus } from "../ui/contactStatus";
import { formatAge } from "../ui/format";
import { statusGlyph, statusTextClass } from "../ui/status";

/* REVIEW — Mission Review / Contacts (DESIGN-SYSTEM §11.2 / Stage 4.2). The roomy, full-page
 * contact manager for post-mission triage. It's a DIFFERENT task from the live rail, so it earns
 * a different surface: a wider, comfortable-density table + a clearance FILTER (the rail can't
 * filter) + the shared per-contact detail + the mission timeline. It reads the SAME global
 * stores, so a contact selected on OPS is still focused here (§11.3, the spine invariant).
 * Sorting/clearance/detail reuse the existing infrastructure — only the manager chrome is new. */

const FRAME_RATE = 30;

const CLEARANCE_FILTERS: { value: "ALL" | ClearanceState; label: string }[] = [
  { value: "ALL", label: "All clearances" },
  { value: "NEW", label: "New" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "EN_ROUTE", label: "En route" },
  { value: "SEARCHED_NEGATIVE", label: "Searched · negative" },
  { value: "FOUND", label: "Found" },
];

export function ReviewPage() {
  const contacts = useContactStore((s) => s.contacts);
  const clearance = useClearanceStore((s) => s.states);
  const selectedId = useSelectionStore((s) => s.selectedId);
  const select = useSelectionStore((s) => s.select);
  const [filter, setFilter] = useState<"ALL" | ClearanceState>("ALL");

  const rows = useMemo(
    () => buildContactRows(contacts, clearance, { key: "actionability", dir: "desc" }),
    [contacts, clearance],
  );
  const shown = filter === "ALL" ? rows : rows.filter((r) => r.clearance === filter);

  return (
    <div data-testid="page-review" className="grid h-full grid-cols-[1fr_360px] grid-rows-[1fr_auto] gap-3 bg-bg-base p-3">
      {/* the roomy table — full height of the left column, as an elevated card */}
      <section aria-label="Contact table" className="row-span-2 flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface-1 shadow-card">
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-5">
          <div className="space-y-1">
            <h1 className="font-ui text-2xl font-bold tracking-tight text-text-hi">Mission Review</h1>
            <p className="text-2xs text-text-lo">
              {shown.length} of {rows.length} contacts
            </p>
          </div>
          <label className="flex items-center gap-2 font-ui text-2xs font-medium text-text-mid">
            Filter
            <select
              data-testid="review-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value as "ALL" | ClearanceState)}
              className="rounded-sm border border-hairline bg-surface-2 px-3 py-1.5 font-ui text-text-hi outline-none focus-visible:shadow-focus"
            >
              {CLEARANCE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <table data-testid="review-table" className="w-full border-collapse font-mono text-sm" role="grid" aria-label="Mission contacts">
            <thead className="sticky top-0 bg-surface-1 text-text-lo">
              <tr className="text-left">
                <th className="w-8 px-3 py-2" />
