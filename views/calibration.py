"""Calibration stepper view — prepare a record for the UI.

Schema-aware structuring of a calibration record (RFC-C v0.2 §2 /
calibration-record.v0.1.json) into stepper-ready steps. Each step is one
primitive (L, G_0, tau_obs_canonical, gamma_AB) plus two terminal steps
(validation, seal).

The output shape is what the UI's JS rendering expects; the substrate
itself never reads this view.
"""
from __future__ import annotations

from typing import Any


# Per-primitive cdv1 meaning + label, for the stepper header.
PRIMITIVE_META: dict[str, dict[str, str]] = {
    "L": {
        "label": "L · decay rate",
        "cdv1_meaning": (
            "Substrate's spontaneous relaxation rate to bath (cavity loss "
            "in laser analog). For sustained NESS, L is the energy/info "
            "drain rate that combustion / pumping / drive must balance."
        ),
        "required_evidence": "cessation trace",
    },
    "G_0": {
        "label": "G₀ · unsaturated maintenance budget",
        "cdv1_meaning": (
            "Active work supplied per unit time (small-signal gain in laser "
            "analog). The substrate's maintenance capacity above which "
            "coherence sustains."
        ),
        "required_evidence": "zero-amplitude extrapolation",
    },
    "tau_obs_canonical": {
        "label": "τ_obs · canonical observer averaging window",
        "cdv1_meaning": (
            "The framing window over which observations are averaged. "
            "Per RFC-S §1, the canonical representation is observer-relative "
            "and τ_obs is the camera position."
        ),
        "required_evidence": "kernel sweep across averaging windows",
    },
    "gamma_AB": {
        "label": "γ_AB · cross-saturation coefficients",
        "cdv1_meaning": (
            "Pairwise cross-saturation (cooperative if <0, competitive if "
            ">0). Single-mode substrates have vacuous γ_AB; multi-mode "
            "substrates declare per-pair values."
        ),
        "required_evidence": "perturbation-response linearity check (ε / G₀ < 0.1)",
    },
}


def prepare(record: dict[str, Any]) -> dict[str, Any]:
    """Build the stepper view from a sealed calibration record."""
    ref = record.get("driver_profile_ref", {}) or {}
    measurements = record.get("measurements", {}) or {}
    validation = record.get("validation", {}) or {}
    retirement = record.get("retirement_triggers", {}) or {}
    seal = record.get("seal", {}) or {}
    supersedes = record.get("supersedes")

    steps = []

    # ── L step ──
    L = measurements.get("L") or {}
    steps.append({
        "id": "L",
        "title": PRIMITIVE_META["L"]["label"],
        "cdv1_meaning": PRIMITIVE_META["L"]["cdv1_meaning"],
        "required_evidence": PRIMITIVE_META["L"]["required_evidence"],
        "measurement": {
            "value": L.get("value"),
            "uncertainty": L.get("uncertainty"),
            "sop_ref": L.get("sop_ref", "(no SOP ref)"),
            "evidence_ref": L.get("cessation_trace_ref", "(no evidence ref)"),
            "evidence_key": "cessation_trace_ref",
        },
        "retirement": {
            "drift_max": retirement.get("L_drift_max"),
            "failure_rule": retirement.get("cessation_failure_rule"),
        },
    })

    # ── G_0 step ──
    G0 = measurements.get("G_0") or {}
    steps.append({
        "id": "G_0",
        "title": PRIMITIVE_META["G_0"]["label"],
        "cdv1_meaning": PRIMITIVE_META["G_0"]["cdv1_meaning"],
        "required_evidence": PRIMITIVE_META["G_0"]["required_evidence"],
        "measurement": {
            "value": G0.get("value"),
            "uncertainty": G0.get("uncertainty"),
            "sop_ref": G0.get("sop_ref", "(no SOP ref)"),
            "evidence_ref": G0.get("extrapolation_evidence_ref", "(no evidence ref)"),
            "evidence_key": "extrapolation_evidence_ref",
        },
        "retirement": {
            "drift_max": retirement.get("G_0_drift_max"),
            "failure_rule": retirement.get("drive_excursion_rule"),
        },
    })

    # ── τ_obs step ──
    T = measurements.get("tau_obs_canonical") or {}
    steps.append({
        "id": "tau_obs_canonical",
        "title": PRIMITIVE_META["tau_obs_canonical"]["label"],
        "cdv1_meaning": PRIMITIVE_META["tau_obs_canonical"]["cdv1_meaning"],
        "required_evidence": PRIMITIVE_META["tau_obs_canonical"]["required_evidence"],
        "measurement": {
            "value": T.get("value"),
            "valid_range": T.get("valid_range"),
            "sop_ref": T.get("sop_ref", "(no SOP ref)"),
            "evidence_ref": T.get("sweep_evidence_ref", "(no evidence ref)"),
            "evidence_key": "sweep_evidence_ref",
        },
        "retirement": {
            "failure_rule": retirement.get("regime_drift_rule"),
        },
    })

    # ── γ_AB step ──
    gamma = measurements.get("gamma_AB") or {}
    gamma_entries = []
    for pair, payload in gamma.items():
        if not isinstance(payload, dict):
            continue
        gamma_entries.append({
            "pair": pair,
            "value": payload.get("value"),
            "uncertainty": payload.get("uncertainty"),
            "sop_ref": payload.get("sop_ref", "(no SOP ref)"),
            "evidence_ref": payload.get("linearity_evidence_ref", "(no evidence ref)"),
        })
    steps.append({
        "id": "gamma_AB",
        "title": PRIMITIVE_META["gamma_AB"]["label"],
        "cdv1_meaning": PRIMITIVE_META["gamma_AB"]["cdv1_meaning"],
        "required_evidence": PRIMITIVE_META["gamma_AB"]["required_evidence"],
        "vacuous": (len(gamma_entries) == 0),
        "vacuous_note": (
            "Single-mode substrate. γ_AB is vacuous; no pair entries. "
            "This is the substrate-class fingerprint for one-mode NESS "
            "(engines, lasers, single hot-cold cells)."
        ),
        "entries": gamma_entries,
        "retirement": {
            "drift_max": retirement.get("gamma_drift_max"),
        },
    })

    # ── validation step ──
    intents = validation.get("per_intent_metric_pass") or {}
    intent_rows = []
    for key in ("I1", "I2", "I3", "I4", "I5"):
        if key in intents:
            entry = intents[key]
            intent_rows.append({
                "intent": key,
                "passed": entry.get("passed"),
                "metric_value": entry.get("metric_value"),
                "threshold": entry.get("threshold"),
                "applies": True,
            })
        else:
            intent_rows.append({
                "intent": key,
                "applies": False,
                "note": "not_applicable",
            })
    steps.append({
        "id": "validation",
        "title": "validation · round-trip + per-intent metrics",
        "cdv1_meaning": (
            "Per RFC-S §5, a driver passes when forward and round-trip "
            "residuals fall below intent-specific thresholds on every "
            "supported intent. Empty residuals are admissible while no "
            "second driver exists to compare against — round-trip discipline "
            "kicks in at the second driver."
        ),
        "reference_dataset_ref": validation.get("reference_dataset_ref"),
        "forward_residuals": validation.get("forward_residuals"),
        "backward_residuals": validation.get("backward_residuals"),
        "intents": intent_rows,
    })

    # ── seal step ──
    steps.append({
        "id": "seal",
        "title": "seal · authority + immutability",
        "cdv1_meaning": (
            "Per RFC-C §3 invariant 7, the record is append-only once "
            "sealed. Re-calibration produces a successor record with a "
            "new seal. The substrate state hash pins the calibrated "
            "substrate state; drift past retirement triggers invalidates."
        ),
        "calibration_authority": seal.get("calibration_authority"),
        "calibration_date": seal.get("calibration_date"),
        "substrate_state_hash": seal.get("substrate_state_hash"),
        "profile_version_pinned": seal.get("profile_version_pinned"),
        "supersedes": supersedes,
    })

    return {
        "driver_profile_ref": ref,
        "substrate_state_hash": seal.get("substrate_state_hash"),
        "calibration_date": seal.get("calibration_date"),
        "steps": steps,
    }


__all__ = ["prepare", "PRIMITIVE_META"]
