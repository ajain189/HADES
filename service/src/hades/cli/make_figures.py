"""`hades-make-figures` - render the routine documentation charts (Task 7.2).

Reads the flat data files written by `hades-export-doc-data` and renders one PNG per
figure into `docs/documentation/figures/`. Every chart draws from a real exported file -
no figure invents numbers - and is styled to the HADES design system (the cool-charcoal
canvas + the rationed status hues from docs/DESIGN-SYSTEM.md), so the set reads as one
deliberate family rather than default matplotlib.

The Wolfram hero visuals (Task 7.3) and the qualitative showcase frames (Task 7.4) are
rendered elsewhere; this module owns the bar/line/calibration charts only.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")  # headless render; no display needed
import matplotlib.pyplot as plt  # noqa: E402

# --- design-system palette (docs/DESIGN-SYSTEM.md) --------------------------------------
# Chroma lives in data, not chrome: a near-achromatic charcoal canvas, one structural blue,
# and the rationed status hues used for their real meanings (orange = world-urgency only,
# magenta = system-integrity failure only).
BG_BASE = "#0B0E14"
SURFACE_1 = "#141821"
SURFACE_3 = "#28303E"
HAIRLINE = "#33456A"
TEXT_HI = "#E6EDF3"
TEXT_MID = "#AAB4C0"
TEXT_LO = "#8593AD"
BLUE_CORE = "#3B7BC8"
BLUE_BRIGHT = "#5E9BD6"
ST_NOMINAL = "#2FB67C"  # green: healthy / pass
ST_INFO = "#33C5E0"  # cyan: informational / converging
ST_CAUTION = "#E6A23C"  # amber: caution / SWEEP-grade
ST_WARNING = "#E8531F"  # hazard orange: world-urgency (the chosen / headline accent)
ST_CRITICAL = "#F5326B"  # magenta-red: system-integrity failure (the collapse)
ST_STALE = "#7E78A8"  # violet-slate: unknown / off the severity ramp

EXPECTED_FIGURES = [
    "fig-detection-conf-sweep",
    "fig-resolution-tradeoff",
    "fig-quant-delta",
    "fig-loc-error-by-geometry",
    "fig-coverage-calibration",
    "fig-fps-by-resolution",
    "fig-ane-speedup",
    "fig-latency-budget",
]


def _style_axes(ax: plt.Axes) -> None:
    """Apply the charcoal canvas + hairline grid to a single axes."""
    ax.set_facecolor(SURFACE_1)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    for spine in ("left", "bottom"):
        ax.spines[spine].set_color(HAIRLINE)
    ax.tick_params(colors=TEXT_MID, labelsize=9)
    ax.yaxis.label.set_color(TEXT_MID)
    ax.xaxis.label.set_color(TEXT_MID)
    ax.title.set_color(TEXT_HI)
    ax.grid(True, axis="y", color=HAIRLINE, alpha=0.35, linewidth=0.6)
    ax.set_axisbelow(True)


def _new_fig(w: float = 7.2, h: float = 4.2) -> tuple[plt.Figure, plt.Axes]:
    fig, ax = plt.subplots(figsize=(w, h), dpi=160)
    fig.patch.set_facecolor(BG_BASE)
    _style_axes(ax)
    return fig, ax


def _save(fig: plt.Figure, out_dir: Path, fid: str) -> None:
    fig.tight_layout()
    fig.savefig(out_dir / f"{fid}.png", facecolor=fig.get_facecolor())
    plt.close(fig)


def _read_csv(data: Path, name: str) -> list[dict[str, str]]:
    with (data / name).open() as f:
        return list(csv.DictReader(f))


def _read_json(data: Path, name: str) -> Any:
    return json.loads((data / name).read_text())


# --- detection figures ------------------------------------------------------------------


def _fig_conf_sweep(data: Path, out: Path) -> None:
    rows = sorted(_read_csv(data, "detection_conf_sweep.csv"), key=lambda r: float(r["conf"]))
    recall = [float(r["recall"]) for r in rows]
    precision = [float(r["precision"]) for r in rows]
    confs = [float(r["conf"]) for r in rows]
    fig, ax = _new_fig()
    ax.plot(recall, precision, "-o", color=BLUE_BRIGHT, markerfacecolor=ST_WARNING,
            markeredgecolor=ST_WARNING, linewidth=1.8, markersize=8)
    for rc, pr, cf in zip(recall, precision, confs):
        ax.annotate(f"conf {cf:g}", (rc, pr), textcoords="offset points", xytext=(8, 6),
                    color=TEXT_LO, fontsize=8)
    ax.set_xlabel("recall")
    ax.set_ylabel("precision")
    ax.set_title("Detection operating points (confidence sweep, HERIDAL held-out)")
    ax.set_xlim(0.3, 0.8)
    ax.set_ylim(0.3, 0.75)
    _save(fig, out, "fig-detection-conf-sweep")


def _fig_resolution(data: Path, out: Path) -> None:
    rows = sorted(_read_csv(data, "detection_resolution.csv"), key=lambda r: int(r["resolution"]))
    res = [r["resolution"] for r in rows]
    recall = [float(r["recall"]) for r in rows]
    precision = [float(r["precision"]) for r in rows]
    chosen = [r["chosen"] == "true" for r in rows]
    x = range(len(res))
