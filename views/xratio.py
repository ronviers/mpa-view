"""X-ratio canonical view — the superheterodyne IF.

Per [v9 §FDR signatures](../../mpa-atlas/framework/v9_compressed.md), the
MPA regime invariants are derivatives of the (χ, C) parametric, not the
parametric itself:

    X(τ) = χ(τ) / (C(0) − C(τ))             FDR violation factor
    X_c  = lim_τ X = 0                       (c-regime)
    X_r  = lim_τ X = 1                       (r-regime, equilibrium FDR)
    α_s  = slope of aging segment in χ vs (C(0)−C)   (s-regime)
    N_f  = ∫min(0,χ)dτ / ∫|χ|dτ              (k_frust regime)

Substrate-native data lives at substrate-specific τ_env (per
LIBRARY_SPEC §"τ_env-anchored sampling"). RFC-S's RG flow says the
canonical representation is the fixed-point at chosen τ_obs — the
"intermediate frequency" you mix substrate-native data down to before
regime-reading. This view is that mix-down: estimates X per
(cell, τ_window) by linear fit on the asymptotic tail of χ vs (C₀−C),
rescales τ_window by τ_env, and reports per-point asymptote-reached
status so the operator knows which estimates are trustworthy.

Estimator:
  - Sort samples by x = C_d_diag − C_d (long lag = more decorrelation).
  - X estimate = pointwise ratio χ / (C_d_diag − C_d) at the last sample,
    matching the framework's `X = lim_τ` definition directly.
  - Asymptote-reached if the last N=max(3, n//4) ratios all agree within
    ±25 %; else "curving" (limit not reached on the experiment window —
    common for below-T_c cells where the substrate ages on the
    experiment timescale).

**Calibration caveat.** The framework's `X_r = 1` and `X_c = 0`
references are in *calibrated* units (Kubo's slope = β = 1/T for
equilibrium glass, equivalent for other substrates). Substrate-native
χ and C have substrate-specific units; raw X computed here will only
hit the reference values after the substrate's calibration record
supplies the normalization. Until then: relative migration across
cells is informative; absolute identification against framework
references is not.
"""
from __future__ import annotations

from typing import Any, Optional


def _safe_ratio(num: float, den: float) -> Optional[float]:
    """χ / (C_diag − C) with a small-denominator floor. None if not
    meaningful (denominator is at noise scale relative to χ)."""
    if abs(den) < 1e-12:
        return None
    return num / den


def prepare(payload: dict[str, Any]) -> dict[str, Any]:
    """Compute X per (cell, τ_window). Returns a per-cell summary
    consumable by the X-ratio overlay view.

    Returns:
        {
          "task_id": str, "substrate": str, "operating_point_label": str,
          "xdot_kind": str, "gt": str | None,
          "tau_env_analytic": float | None,
          "tau_env_method": str | None,
          "tau_env_eff": float | None,           # rescaling denominator used
          "tau_env_eff_source": "tau_env_analytic" | "fallback_t_obs",
          "points": [
            {
              "tau_window": float,
              "tau_window_rescaled": float | None,  # tw / tau_env_eff
              "X": float | None,                     # asymptotic FDR ratio
              "asymptote_status": "reached" | "curving" | "no_fit",
              "N_f": float,                          # frac of pts with χ < 0
              "n_fit_samples": int,
              "n_total_samples": int,
            },
            ...
          ]
        }
    """
    op = payload.get("operating_point", {}) or {}
    sched = payload.get("schedule", {}) or {}
    samples = payload.get("results", {}).get("all_samples", []) or []
    tau_windows = sched.get("tau_windows", []) or []

    tau_env_block = payload.get("tau_env_analytic") or {}
    tau_env_analytic = tau_env_block.get("value")
    tau_env_method = tau_env_block.get("method")
    t_obs = sched.get("t_obs")

    # Heterodyne LO mix-down: prefer τ_env_analytic; fall back to t_obs
    # when τ_env is null (below-T_c aging cells, per LIBRARY_SPEC).
    if tau_env_analytic is not None and tau_env_analytic > 0:
        tau_env_eff = float(tau_env_analytic)
        tau_env_eff_source = "tau_env_analytic"
    elif t_obs is not None and t_obs > 0:
        tau_env_eff = float(t_obs)
        tau_env_eff_source = "fallback_t_obs"
    else:
        tau_env_eff = None
        tau_env_eff_source = "none"

    points: list[dict[str, Any]] = []
    for tw_idx, tw in enumerate(tau_windows):
        # Walk every sample, pull (C_diag - C, χ) at this τ_window.
        pts: list[tuple[float, float]] = []
        for sample in samples:
            pw_list = sample.get("per_window", []) or []
            if tw_idx >= len(pw_list):
                continue
            pw = pw_list[tw_idx]
            chi = pw.get("chi_d_mean")
            cd = pw.get("C_d_mean")
            cdd = pw.get("C_d_diag_mean")
            if chi is None or cd is None or cdd is None:
                continue
            x = float(cdd - cd)
            y = float(chi)
            pts.append((x, y))
        n_total = len(pts)
        rescaled_tw = (float(tw) / tau_env_eff) if tau_env_eff else None
        if n_total < 3:
            points.append({
                "tau_window": float(tw),
                "tau_window_rescaled": rescaled_tw,
                "X": None,
                "asymptote_status": "no_fit",
                "N_f": 0.0,
                "n_tail_samples": 0,
                "n_total_samples": n_total,
            })
            continue
        # Sort by x ascending (longer lag → larger x = more decorrelation).
        pts.sort(key=lambda p: p[0])
        # Pointwise ratio at each sample; X-estimate is the asymptotic ratio.
        ratios = []
        for x, y in pts:
            r = _safe_ratio(y, x)
            if r is not None:
                ratios.append(r)
        if not ratios:
            X_est = None
            asymp_status = "no_fit"
        else:
            # X estimate is the median of the last K ratios (robust to outliers).
            n_tail = max(3, n_total // 4)
            n_tail = min(n_tail, len(ratios))
            tail_ratios = sorted(ratios[-n_tail:])
            X_est = tail_ratios[len(tail_ratios) // 2]
            # Asymptote-reached if all tail ratios agree within ±25 % of median.
            if abs(X_est) < 1e-12:
                # Near-zero; absolute spread test instead.
                spread = max(tail_ratios) - min(tail_ratios)
                asymp_status = "reached" if spread < 1e-6 else "curving"
            else:
                relspread = (max(tail_ratios) - min(tail_ratios)) / abs(X_est)
                asymp_status = "reached" if relspread < 0.25 else "curving"
        # N_f: fraction of total points with χ < 0 at this τ_window.
        n_neg = sum(1 for p in pts if p[1] < 0)
        nf = n_neg / n_total
        points.append({
            "tau_window": float(tw),
            "tau_window_rescaled": rescaled_tw,
            "X": float(X_est) if X_est is not None else None,
            "asymptote_status": asymp_status,
            "N_f": float(nf),
            "n_tail_samples": len(ratios) and min(max(3, n_total // 4), len(ratios)),
            "n_total_samples": n_total,
        })

    return {
        "task_id": (payload.get("substrate", "") + "__"
                    + op.get("label", "") + "__"
                    + payload.get("xdot_kind", "")),
        "substrate": payload.get("substrate"),
        "operating_point": op,
        "operating_point_label": op.get("label"),
        "xdot_kind": payload.get("xdot_kind"),
        "gt": op.get("gt"),
        "tau_env_analytic": tau_env_analytic,
        "tau_env_method": tau_env_method,
        "tau_env_eff": tau_env_eff,
        "tau_env_eff_source": tau_env_eff_source,
        "points": points,
    }


__all__ = ["prepare"]
