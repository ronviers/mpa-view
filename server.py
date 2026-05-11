"""H:/mpa-view/server.py — the microscope's HTTP front end.

Serves a single-page app and JSON endpoints for the library cells.

Routes:
  GET /                      -> static/shell.html
  GET /static/<path>         -> static/<path>
  GET /api/cells             -> { cells: [CellIndexEntry, ...] }
  GET /api/cell/<task_id>    -> raw library payload (large)
  GET /api/view/gfdr/<id>    -> gFDR view's prepare() output (smaller, plot-ready)
  GET /api/health            -> library health-check report

Single-client by design (matches mpa-visualizer convention). No SSE, no
streaming — library cells are static artifacts, plain GET is enough.

Override host/port with MPA_VIEW_HOST / MPA_VIEW_PORT.
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from loaders.library import Library
from loaders.calibration import CalibrationLibrary
from views import gfdr as view_gfdr
from views import xratio as view_xratio
from views import calibration as view_calibration


_HERE = os.path.dirname(os.path.abspath(__file__))
_LIBRARY = Library()
_CALIBRATIONS = CalibrationLibrary()


# ── Content-type table ────────────────────────────────────────────────────


_CONTENT_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


# ── Handler ───────────────────────────────────────────────────────────────


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Quiet 200s; surface anything else.
        msg = fmt % args
        if " 200 " in msg or msg.endswith(" 200 -"):
            return
        sys.stderr.write(f"[{self.log_date_time_string()}] {msg}\n")

    # ── Routing ──────────────────────────────────────────────────────────

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            return self._send_static_file("shell.html")
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            if ".." in rel:
                return self.send_error(404)
            return self._send_static_file(rel)
        if path == "/api/health":
            return self._send_json(_LIBRARY.health())
        if path == "/api/cells":
            return self._send_json({
                "cells": [c.to_dict() for c in _LIBRARY.cells()],
            })
        if path.startswith("/api/cell/"):
            task_id = path[len("/api/cell/"):]
            return self._send_cell(task_id)
        if path.startswith("/api/view/gfdr/"):
            task_id = path[len("/api/view/gfdr/"):]
            return self._send_view_gfdr(task_id)
        if path.startswith("/api/view/xratio/"):
            task_id = path[len("/api/view/xratio/"):]
            return self._send_view_xratio(task_id)
        if path == "/api/calibrations":
            return self._send_json({
                "roots": _CALIBRATIONS.roots,
                "records": [r.to_dict() for r in _CALIBRATIONS.records()],
            })
        if path.startswith("/api/view/calibration/"):
            cal_id = path[len("/api/view/calibration/"):]
            return self._send_view_calibration(cal_id)
        return self.send_error(404, f"unknown route: {path}")

    # ── API responses ────────────────────────────────────────────────────

    def _send_cell(self, task_id: str):
        payload = _LIBRARY.get_cell_payload(task_id)
        if payload is None:
            return self.send_error(404, f"cell not found: {task_id}")
        return self._send_json(payload)

    def _send_view_gfdr(self, task_id: str):
        payload = _LIBRARY.get_cell_payload(task_id)
        if payload is None:
            return self.send_error(404, f"cell not found: {task_id}")
        try:
            view = view_gfdr.prepare(payload)
        except Exception as exc:  # diagnostic
            return self.send_error(500, f"gfdr view failed: {type(exc).__name__}: {exc}")
        return self._send_json(view)

    def _send_view_xratio(self, task_id: str):
        payload = _LIBRARY.get_cell_payload(task_id)
        if payload is None:
            return self.send_error(404, f"cell not found: {task_id}")
        try:
            view = view_xratio.prepare(payload)
        except Exception as exc:  # diagnostic
            return self.send_error(500, f"xratio view failed: {type(exc).__name__}: {exc}")
        return self._send_json(view)

    def _send_view_calibration(self, cal_id: str):
        # cal_id is URL-encoded; e.g. "mpa-engine%2Freference-driver%2Fcamry-...-calibration.json"
        from urllib.parse import unquote
        cal_id = unquote(cal_id)
        payload = _CALIBRATIONS.get_payload(cal_id)
        if payload is None:
            return self.send_error(404, f"calibration record not found: {cal_id}")
        try:
            view = view_calibration.prepare(payload)
        except Exception as exc:
            return self.send_error(500, f"calibration view failed: {type(exc).__name__}: {exc}")
        return self._send_json(view)

    # ── Helpers ──────────────────────────────────────────────────────────

    def _send_static_file(self, rel: str):
        full = os.path.join(_HERE, "static", rel)
        if not os.path.isfile(full):
            return self.send_error(404, f"static missing: {rel}")
        ext = os.path.splitext(full)[1].lower()
        ctype = _CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        suffix = "; charset=utf-8" if ctype.startswith(("text/", "application/")) else ""
        self.send_header("Content-Type", ctype + suffix)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, body: object, status: int = 200):
        encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


# ── Main ──────────────────────────────────────────────────────────────────


def main():
    host = os.environ.get("MPA_VIEW_HOST", "127.0.0.1")
    port = int(os.environ.get("MPA_VIEW_PORT", "18766"))
    try:
        server = ThreadingHTTPServer((host, port), Handler)
    except PermissionError as exc:
        sys.stderr.write(
            f"Could not bind {host}:{port}: {exc}\n"
            "On Windows the port may be in Hyper-V's excluded range. Try "
            "MPA_VIEW_PORT=18900 or 30000+.\n"
        )
        sys.exit(1)
    h = _LIBRARY.health()
    print(f"mpa-view running at http://{host}:{port}")
    print(f"library root: {h['library_root']}")
    print(f"library cells: {h['n_cells']} ({h['per_substrate']})")
    print(f"per-gt: {h['per_gt']}")
    if h["unreachable_cells"]:
        print(f"WARNING: {len(h['unreachable_cells'])} cells unreachable: {h['unreachable_cells'][:5]}...")
    ch = _CALIBRATIONS.health()
    print(f"calibration records: {ch['n_records']} across {len(ch['roots'])} root(s)")
    if ch["n_records"]:
        print(f"  per substrate-class: {ch['per_substrate_class']}")
    print("Open the URL in a browser. Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping...")
        server.server_close()


if __name__ == "__main__":
    main()
