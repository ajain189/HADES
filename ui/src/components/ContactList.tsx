import { useMemo, useState } from "react";

import { useClearanceStore } from "../store/clearanceStore";
import { buildContactRows, type ContactRow, type SortKey, type SortSpec } from "../store/contactView";
import { useContactStore } from "../store/contacts";
import { useSelectionStore } from "../store/selection";
import { contactStatus } from "../ui/contactStatus";
import { formatAge } from "../ui/format";
import { statusGlyph, statusTextClass } from "../ui/status";
import { ConfidenceBar } from "./ConfidenceBar";
import { Placeholder } from "./Placeholder";

/* The prioritized survivor list (impl-plan Task 5.4). One row per contact with the
 * NON-NEGOTIABLE columns: track id, class, detection AND localization confidence as
 * SEPARATE meters, clearance, age, CONVERGING/STABLE, heading-limited. Rows are bound
 * bidirectionally to the global selection spine (click commits, hover previews). Default
 * sort = actionability (urgent on top); cleared contacts demote, never vanish. Numbers are
 * mono/tabular. The algorithm proposes, the operator disposes (sortable headers). */

const FRAME_RATE = 30; // age_frames → seconds for display

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: null, label: "" }, // status glyph
  { key: "track", label: "TRK" },
  { key: null, label: "CLASS" },
  { key: "det", label: "DET" },
  { key: "loc", label: "LOC" },
  { key: null, label: "CLR" },
  { key: "age", label: "AGE" },
  { key: "convergence", label: "CONV" },
  { key: null, label: "HDG" },
];

export function ContactList() {
  const contacts = useContactStore((s) => s.contacts);
  const clearance = useClearanceStore((s) => s.states);
  const [sort, setSort] = useState<SortSpec>({ key: "actionability", dir: "desc" });

  const rows = useMemo(
    () => buildContactRows(contacts, clearance, sort),
    [contacts, clearance, sort],
  );

  if (rows.length === 0) {
    return <Placeholder label="No contacts yet" hint="Survivors plot here as they're detected" />;
  }

  const toggleSort = (key: SortKey | null) => {
    if (!key) return;
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  };

  return (
    <table className="w-full border-collapse font-mono text-xs" role="grid" aria-label="Survivor contacts">
      <thead className="sticky top-0 bg-surface-1 text-text-lo">
        <tr>
          {COLUMNS.map((col, i) => (
            <th
              key={i}
              role="columnheader"
              scope="col"
              aria-sort={
                col.key && sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
              }
              className={`px-1 py-1 text-left font-medium ${col.key ? "cursor-pointer select-none hover:text-text-mid" : ""}`}
              onClick={() => toggleSort(col.key)}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
