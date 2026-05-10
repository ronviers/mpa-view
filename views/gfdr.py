"""gFDR signature view.

Cugliandolo–Kurchan parametric: χ_d(τ_obs) plotted against
(C_d_diag - C_d) at every sampled (t, dt). One curve per τ_obs window,
ordered along the curve by sample index. The ground-truth regime label
(`gt`) is included so the operator can see whether the canonical
reading matches the substrate's known character.

Reading the plot:
- **r-regime** (equilibrium / fully relaxed): unit-slope linear locus,
  χ ≈ (C_diag - C) / T, no aging.
- **s-regime** (aging): broken-line locus, slope steeper than 1 at
  short lags, shallower at long lags — the Cugliandolo–Kurchan
  diagonal. The hallmark of mpa-meaningful character.
- **c-regime** (frozen / committed): suppressed, near-horizontal locus
  at short lags — most fluctuations don't elicit response.
- **k-regime** (critical / conflict): scale-free / fractal locus near
  T_c; the hardest to read by eye.
"""
from __future__ import annotations

from typing import Any


def prepare(payload: dict[str, Any]) -> dict[str, Any]:
    """Build Plotly trace data for the gFDR parametric plot.

    Returns:
        {
          "task_id": str,
          "substrate": str,
          "operating_point_label": str,
          "xdot_kind": str,
          "gt": str | None,
          "tau_env_analytic": float | None,
          "n_realizations": int | None,
          "axes": { "x_label": str, "y_label": str },
          "traces": [
            {
              "tau_window": float,
              "x": [...],   # C_d_diag - C_d at each sample
              "y": [...],   # chi_d_mean
              "x_sem": [...] | None,
              "y_sem": [...] | None,
              "sample_t": [...],
              "sample_dt": [...],
              "n_points": int
            },
            ...
          ],
          "regime_overlay": { "label": str, "color": str }
        }
    """
    op = payload.get("operating_point", {}) or {}
    sched = payload.get("schedule", {}) or {}
    samples = payload.get("results", {}).get("all_samples", []) or []
    tau_windows = sched.get("tau_windows", []) or []

    # Re-organise: per τ_window, walk every sample and pull (chi, C_diag-C).
    traces: list[dict[str, Any]] = []
    for tw_idx, tw in enumerate(tau_windows):
        xs: list[float] = []
        ys: list[float] = []
        x_sems: list[float | None] = []
        y_sems: list[float | None] = []
        sample_t: list[float] = []
        sample_dt: list[float] = []
        for sample in samples:
            t = sample.get("t")
            dt = sample.get("dt")
            per_window = sample.get("per_window", []) or []
            if tw_idx >= len(per_window):
                continue
            pw = per_window[tw_idx]
            chi = pw.get("chi_d_mean")
            c_d = pw.get("C_d_mean")
            c_d_diag = pw.get("C_d_diag_mean")
            if chi is None or c_d is None or c_d_diag is None:
                continue
            x = c_d_diag - c_d
            xs.append(float(x))
            ys.append(float(chi))
            # SEM may be null (brain) — pass None through so the UI can
            # decide whether to draw error bars.
            chi_sem = pw.get("chi_d_sem")
            cd_sem = pw.get("C_d_sem")
            cd_diag_sem = pw.get("C_d_diag_sem")
            x_sem = None
            if cd_sem is not None and cd_diag_sem is not None:
                # Independent-error proxy (low-effort upper bound).
                x_sem = float((cd_sem ** 2 + cd_diag_sem ** 2) ** 0.5)
            y_sem = float(chi_sem) if chi_sem is not None else None
            x_sems.append(x_sem)
            y_sems.append(y_sem)
            sample_t.append(float(t) if t is not None else 0.0)
            sample_dt.append(float(dt) if dt is not None else 0.0)
        if not xs:
            continue
        traces.append({
            "tau_window": float(tw),
            "x": xs,
            "y": ys,
            "x_sem": x_sems if any(s is not None for s in x_sems) else None,
            "y_sem": y_sems if any(s is not None for s in y_sems) else None,
            "sample_t": sample_t,
            "sample_dt": sample_dt,
            "n_points": len(xs),
        })

    gt = op.get("gt")
    regime_color = {
        "c": "#3f88c5",   # blue — coherent / committed
        "s": "#e6af2e",   # gold — sustained aging
        "k": "#a23b72",   # magenta — critical / conflict
        "r": "#a8a8a8",   # grey — relaxed / equilibrium
    }.get(gt or "", "#000000")

    return {
        "task_id": payload.get("substrate", "") + "__"
                   + op.get("label", "") + "__"
                   + payload.get("xdot_kind", ""),
        "substrate": payload.get("substrate"),
        "operating_point_label": op.get("label"),
        "xdot_kind": payload.get("xdot_kind"),
        "gt": gt,
        "tau_env_analytic": (payload.get("tau_env_analytic") or {}).get("value"),
        "tau_env_method": (payload.get("tau_env_analytic") or {}).get("method"),
        "n_realizations": sched.get("n_realizations"),
        "schedule": {
            "t_w": sched.get("t_w"),
            "t_obs": sched.get("t_obs"),
            "n_sample_times": sched.get("n_sample_times"),
        },
        "axes": {
            "x_label": "C_d_diag(t) − C_d(t, t+dt)",
            "y_label": "χ_d(t, t+dt)",
        },
        "traces": traces,
        "regime_overlay": {"label": gt or "—", "color": regime_color},
    }


__all__ = ["prepare"]
