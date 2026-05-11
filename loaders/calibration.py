"""Calibration record discovery + loader.

Walks configured roots looking for `*-calibration.json` files conforming to
[`mpa-atlas/schema/calibration-record.v0.1.json`](https://github.com/ronviers/mpa-atlas/blob/main/schema/calibration-record.v0.1.json),
returns lightweight index entries (substrate, profile_version, date) for
the picker and full payloads on demand.

Default roots: any sibling `H:/mpa-*` or `H:/mpc-*` directory's
`reference-driver/` or `reference-drivers/` subdirectory. Override with
env var `MPA_CALIBRATION_ROOTS` (semicolon-separated list of directories).
Read-only by contract.
"""
from __future__ import annotations

import glob
import json
import os
import sys
import threading
from dataclasses import dataclass
from typing import Any, Optional


# ── Root discovery ────────────────────────────────────────────────────────


def _default_calibration_roots() -> list[str]:
    """Resolve calibration-record search roots.

    Override with MPA_CALIBRATION_ROOTS (semicolon-separated dirs).
    Default: sibling mpa-*/reference-driver/, mpa-*/reference-drivers/,
    mpc-*/reference-driver/, mpc-*/reference-drivers/.
    """
    env = os.environ.get("MPA_CALIBRATION_ROOTS")
    if env:
        return [p.strip() for p in env.split(";") if p.strip()]

    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    h = os.path.dirname(repo)  # H:/ on this host
    roots = []
    for sib in glob.glob(os.path.join(h, "mpa-*")) + glob.glob(os.path.join(h, "mpc-*")):
        for sub in ("reference-driver", "reference-drivers"):
            d = os.path.join(sib, sub)
            if os.path.isdir(d):
                roots.append(d)
    return roots


CALIBRATION_ROOTS = _default_calibration_roots()


# ── Index entry ───────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CalibrationIndexEntry:
    """Lightweight summary; full payload fetched separately."""

    cal_id: str            # stable id derived from path relative to a root
    path: str              # absolute path
    substrate_class: str
    profile_version: str
    calibration_date: str
    calibration_authority: str
    profile_version_pinned: str
    supersedes: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "cal_id": self.cal_id,
            "path": self.path,
            "substrate_class": self.substrate_class,
            "profile_version": self.profile_version,
            "calibration_date": self.calibration_date,
            "calibration_authority": self.calibration_authority,
            "profile_version_pinned": self.profile_version_pinned,
            "supersedes": self.supersedes,
        }


# ── Loader ────────────────────────────────────────────────────────────────


class CalibrationLibrary:
    """Lazy discoverer + loader for calibration records under the
    configured roots. Records read once on construction; payloads cached
    after first read."""

    def __init__(self, roots: Optional[list[str]] = None):
        self.roots = list(roots) if roots is not None else list(CALIBRATION_ROOTS)
        self._lock = threading.Lock()
        self._cache: dict[str, dict[str, Any]] = {}
        self._index = self._load_index()

    def _load_index(self) -> dict[str, CalibrationIndexEntry]:
        out: dict[str, CalibrationIndexEntry] = {}
        for root in self.roots:
            if not os.path.isdir(root):
                continue
            for path in glob.glob(os.path.join(root, "*-calibration.json")):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        rec = json.load(f)
                except Exception as exc:
                    sys.stderr.write(f"[calibration] failed to load {path}: {exc}\n")
                    continue
                # Build a stable id from path (last 2 components joined).
                parts = os.path.normpath(path).replace("\\", "/").split("/")
                cal_id = "/".join(parts[-2:]) if len(parts) >= 2 else parts[-1]
                ref = rec.get("driver_profile_ref", {}) or {}
                seal = rec.get("seal", {}) or {}
                entry = CalibrationIndexEntry(
                    cal_id=cal_id,
                    path=path,
                    substrate_class=ref.get("substrate_class", "?"),
                    profile_version=ref.get("profile_version", "?"),
                    calibration_date=seal.get("calibration_date", "?"),
                    calibration_authority=seal.get("calibration_authority", "?"),
                    profile_version_pinned=seal.get("profile_version_pinned", "?"),
                    supersedes=rec.get("supersedes"),
                )
                out[cal_id] = entry
        return out

    def records(self) -> list[CalibrationIndexEntry]:
        return list(self._index.values())

    def get_index(self, cal_id: str) -> Optional[CalibrationIndexEntry]:
        return self._index.get(cal_id)

    def get_payload(self, cal_id: str) -> Optional[dict[str, Any]]:
        """Full calibration record (memoized)."""
        with self._lock:
            cached = self._cache.get(cal_id)
            if cached is not None:
                return cached
        entry = self._index.get(cal_id)
        if entry is None:
            return None
        try:
            with open(entry.path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as exc:
            sys.stderr.write(f"[calibration] failed to reload {entry.path}: {exc}\n")
            return None
        with self._lock:
            self._cache[cal_id] = payload
        return payload

    def health(self) -> dict[str, Any]:
        return {
            "roots": self.roots,
            "n_records": len(self._index),
            "per_substrate_class": _count_by(self._index.values(), "substrate_class"),
        }


def _count_by(entries, attr: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for e in entries:
        v = getattr(e, attr, "?")
        out[v] = out.get(v, 0) + 1
    return out


__all__ = ["CalibrationLibrary", "CalibrationIndexEntry", "CALIBRATION_ROOTS"]
