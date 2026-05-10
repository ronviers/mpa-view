"""mpa-central library reader.

Reads `H:/mpa-central/library/MANIFEST.json` for the cell index and
loads individual cell JSON files on demand. Read-only by contract; we
never write back into the library.

Cells are indexed by `task_id` (e.g. `glass__T0.500__spin-relative`),
matching the manifest's keys.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from dataclasses import dataclass
from typing import Any, Optional


# ── Library location ──────────────────────────────────────────────────────


def _default_library_root() -> str:
    """Resolve the library root. Override with MPA_LIBRARY_ROOT.

    Default targets the canonical H:/mpa-central/library on this host.
    """
    env = os.environ.get("MPA_LIBRARY_ROOT")
    if env:
        return env
    # Walk up from this file in case the repo is checked out somewhere
    # other than H:/mpa-view, then jump to the sibling mpa-central path.
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    sibling = os.path.normpath(os.path.join(repo, "..", "mpa-central", "library"))
    if os.path.isdir(sibling):
        return sibling
    # Last-resort hard-coded default for this host.
    return r"H:\mpa-central\library"


LIBRARY_ROOT = _default_library_root()
MANIFEST_PATH = os.path.join(LIBRARY_ROOT, "MANIFEST.json")


# ── Cell index entry ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class CellIndexEntry:
    """A single (substrate, operating-point, ẋ-kind) cell as listed in
    the manifest. Lightweight; full cell payload is fetched separately.
    """
    task_id: str           # e.g. "glass__T0.500__spin-relative"
    substrate: str         # "brain" | "glass" | "quantum"
    operating_point_label: str
    operating_point: dict[str, Any]
    xdot_kind: str
    gt: Optional[str]      # ground-truth regime: "c" | "s" | "k" | "r" | None
    status: str            # "done" | "failed" | ...
    output_path: str       # absolute path to the cell JSON file
    n_realizations: Optional[int]
    tau_env_analytic: Optional[float]
    tau_env_method: Optional[str]
    wall_seconds: Optional[float]
    completed_at: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "substrate": self.substrate,
            "operating_point_label": self.operating_point_label,
            "operating_point": self.operating_point,
            "xdot_kind": self.xdot_kind,
            "gt": self.gt,
            "status": self.status,
            "n_realizations": self.n_realizations,
            "tau_env_analytic": self.tau_env_analytic,
            "tau_env_method": self.tau_env_method,
            "wall_seconds": self.wall_seconds,
            "completed_at": self.completed_at,
        }


# ── Manifest reader ───────────────────────────────────────────────────────


class Library:
    """Lazy library-cell reader. Manifest read once on construction;
    individual cell payloads cached after first read."""

    def __init__(self, root: str = LIBRARY_ROOT):
        self.root = root
        self._lock = threading.Lock()
        self._cell_cache: dict[str, dict[str, Any]] = {}
        self._index = self._load_index()

    def _load_index(self) -> dict[str, CellIndexEntry]:
        manifest_path = os.path.join(self.root, "MANIFEST.json")
        if not os.path.isfile(manifest_path):
            sys.stderr.write(
                f"[library] manifest not found at {manifest_path}\n"
                "Set MPA_LIBRARY_ROOT or check that mpa-central is checked out.\n"
            )
            return {}
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        out: dict[str, CellIndexEntry] = {}
        for task_id, raw in data.get("tasks", {}).items():
            task = raw.get("task", {})
            op = task.get("operating_point", {})
            tau_env = task.get("tau_env_analytic", {}) or {}
            run_meta = raw.get("run_meta", {}) or {}
            entry = CellIndexEntry(
                task_id=task_id,
                substrate=task.get("substrate", ""),
                operating_point_label=op.get("label", ""),
                operating_point=op,
                xdot_kind=task.get("xdot_kind", ""),
                gt=op.get("gt"),
                status=raw.get("status", "unknown"),
                output_path=raw.get("output", ""),
                n_realizations=run_meta.get("n_realizations"),
                tau_env_analytic=tau_env.get("value"),
                tau_env_method=tau_env.get("method"),
                wall_seconds=raw.get("wall_seconds"),
                completed_at=raw.get("completed_at"),
            )
            out[task_id] = entry
        return out

    def cells(self) -> list[CellIndexEntry]:
        """All cells in manifest order. Index is read-only after init."""
        return list(self._index.values())

    def get_cell_index(self, task_id: str) -> Optional[CellIndexEntry]:
        return self._index.get(task_id)

    def get_cell_payload(self, task_id: str) -> Optional[dict[str, Any]]:
        """Full cell JSON (memoized). None if the cell or file is missing."""
        with self._lock:
            cached = self._cell_cache.get(task_id)
            if cached is not None:
                return cached
        entry = self._index.get(task_id)
        if entry is None or not entry.output_path:
            return None
        # The manifest stores Windows paths. Normalize across platforms.
        path = entry.output_path.replace("\\", os.sep).replace("/", os.sep)
        if not os.path.isabs(path):
            path = os.path.join(self.root, path)
        if not os.path.isfile(path):
            sys.stderr.write(f"[library] cell file missing: {path}\n")
            return None
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        with self._lock:
            self._cell_cache[task_id] = payload
        return payload

    def health(self) -> dict[str, Any]:
        """Smoke-check report: counts per substrate, gt distribution,
        any cells whose output file is unreachable."""
        per_sub: dict[str, int] = {}
        per_gt: dict[str, int] = {}
        unreachable: list[str] = []
        for entry in self._index.values():
            per_sub[entry.substrate] = per_sub.get(entry.substrate, 0) + 1
            key = entry.gt or "?"
            per_gt[key] = per_gt.get(key, 0) + 1
            path = entry.output_path.replace("\\", os.sep).replace("/", os.sep)
            if path and not os.path.isfile(path):
                unreachable.append(entry.task_id)
        return {
            "library_root": self.root,
            "manifest_path": os.path.join(self.root, "MANIFEST.json"),
            "n_cells": len(self._index),
            "per_substrate": per_sub,
            "per_gt": per_gt,
            "unreachable_cells": unreachable,
        }


__all__ = ["Library", "CellIndexEntry", "LIBRARY_ROOT", "MANIFEST_PATH"]
