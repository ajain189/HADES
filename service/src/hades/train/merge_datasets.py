"""Merge the three staged Roboflow YOLO datasets into one single-`person` tree (Task 2.5.1).

Runs ON the cluster against the real staged labels (the part that can't be unit-tested
without the data — its primitives ARE tested in `dataset.py`). For each source it:

1. Reads the source `data.yaml` to learn that source's class names.
2. Builds a per-source `{index → "person" | DROP}` map: SARD/HERIDAL persons → person;
   VisDrone via `map_visdrone_class` (pedestrian+people → person, vehicles dropped); any
   class it can't classify as person/vehicle/ignore RAISES (no silent passthrough).
3. Rewrites every label file into the merged tree, re-indexed to class 0, dropping DROP
   boxes and degenerate (zero-area) boxes.
4. Re-splits HERIDAL by SCENE (`scene_split.py`) and **asserts the merged train is disjoint
   from the held-out test** two ways: (a) `assert_no_scene_leakage` — no HERIDAL flight
   location (scene code) spans train/test, which also covers same-scene augmented copies; and
   (b) `assert_no_leakage` — an exact decoded-pixel SHA-256 backstop for byte-identical dupes.
5. Emits one `dataset.yaml` (`nc:1 names:['person']`, absolute `path:`), asserts no split is
   empty, and writes a human-auditable summary.

This is a script, not a library entry — invoked as `python -m hades.train.merge_datasets`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .dataset import (
    DROP,
    ClassMap,
    assert_no_leakage,
    build_dataset_yaml,
    image_content_hash,
    normalize_label_file,
    parse_yolo_label,
    yolo_line,
)
from .scene_split import assert_no_scene_leakage, heridal_scene, split_scenes
from .train import map_visdrone_class

# Person class names seen across SARD/HERIDAL Roboflow exports (case-folded).
_PERSON_NAMES = {"person", "human", "people", "pedestrian"}
_SPLITS = ("train", "valid", "test")


def _read_yaml(path: Path) -> dict:
    import yaml

    return yaml.safe_load(path.read_text())


def _source_class_map(names: list[str], *, is_visdrone: bool) -> ClassMap:
    """Build `{source_index → "person"|DROP}` from a source's ordered class names."""
    mapping: dict[int, str] = {}
    for idx, name in enumerate(names):
        key = str(name).strip().lower()
        if is_visdrone:
            # map_visdrone_class raises on a genuinely unknown class — the collision guard.
            try:
                mapping[idx] = map_visdrone_class(key)
            except ValueError:
                # 'ignored regions' / 'others' are handled by dropping the box here; the
                # image-level ignore handling is applied separately. Unknown -> re-raise.
                if "ignor" in key or key == "others":
                    mapping[idx] = DROP
                else:
                    raise
        else:
            if key in _PERSON_NAMES:
                mapping[idx] = "person"
            else:
                raise ValueError(f"unexpected non-person class {name!r} in a person dataset")
    return ClassMap(mapping)


def _find_split_dir(root: Path, split: str) -> Path | None:
    """Locate a Roboflow split dir (handles `valid` vs `val` and a nested export folder)."""
    candidates = [root / split]
    if split == "valid":
        candidates.append(root / "val")
    for base in (root, *[p for p in root.iterdir() if p.is_dir()]):
        for s in ({split, "val"} if split == "valid" else {split}):
            d = base / s
            if (d / "images").is_dir():
                return d
    for c in candidates:
        if (c / "images").is_dir():
            return c
    return None


def _decode_image(path: Path):
    import numpy as np
    from PIL import Image

    return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)


#: Fraction of HERIDAL scenes held out as the test anchor when re-splitting by scene.
HERIDAL_TEST_FRACTION = 0.2
HERIDAL_SPLIT_SEED = 0


def _heridal_test_scenes(root: Path) -> set[str]:
    """Re-split HERIDAL by SCENE (not Roboflow's random frame split) and return test scenes.

    Roboflow split HERIDAL by frame, so a flight location lands in both train and test and
    inflates recall. We pool every HERIDAL image, collect its scene codes, and deterministically
    hold out whole scenes — so no location crosses the boundary.
    """
    scenes: set[str] = set()
    for split in _SPLITS:
        sdir = _find_split_dir(root, split)
        if sdir is None:
            continue
        for img in (sdir / "images").iterdir():
            if img.suffix.lower() in _IMAGE_EXTS:
                scenes.add(heridal_scene(img.name))
    _, test = split_scenes(
        scenes, test_fraction=HERIDAL_TEST_FRACTION, seed=HERIDAL_SPLIT_SEED
    )
    return test


def _process_source(name, root, cmap, out_root, split_out, summary, hashes):
    """Copy+normalize one source's images/labels into the destination tree's splits.

    HERIDAL is re-split by SCENE (held-out test scenes → merged test; every other HERIDAL
    image → train) so no flight location spans train/test. SARD/VisDrone keep their Roboflow
    split (their test folds into train; valid → val) — they are not the held-out anchor.
    """
    summary["per_source"][name] = {"kept": 0, "dropped": 0}
    heridal_test_scenes = _heridal_test_scenes(root) if name == "heridal" else set()
    if name == "heridal":
        summary["heridal_test_scenes"] = sorted(heridal_test_scenes)
        hashes.setdefault("test_scenes", set())
        hashes.setdefault("train_scenes", set())

    for split in _SPLITS:
        sdir = _find_split_dir(root, split)
        if sdir is None:
