# mpa-view — next-session handoff

**Status (2026-05-10):** Bootstrapped this session. v0.1 ships the
episode index + gFDR signature view, reading the
[mpa-central library](https://github.com/ronviers/mpa-central) cells
through MPA primitives (Cugliandolo–Kurchan parametric, ground-truth
regime overlay).

**What's running:**

- `server.py` — stdlib `http.server` on `127.0.0.1:18766` (override
  with `MPA_VIEW_HOST` / `MPA_VIEW_PORT`).
- `loaders/library.py` — reads the manifest at
  `H:/mpa-central/library/MANIFEST.json`, indexes 60+ cells, lazily
  loads per-cell payloads.
- `views/gfdr.py` — converts a cell payload to plot-ready Plotly
  traces (one per τ_obs window, parametrized by sample order).
- `static/shell.{html,css,js}` — single-page UI: filter by
  substrate / gt / ẋ-kind, click a cell, watch the gFDR locus.
- Regime ground-truth (`gt: c|s|k|r`) is overlaid prominently as a
  color badge so the operator can read the canonical signature against
  the substrate's known character.

**What's not yet running:**

| Slot | Status | Notes |
|---|---|---|
| Calibration pipeline stepper | scaffold only | Activates when the first sealed [calibration record](https://github.com/ronviers/mpa-atlas/blob/main/schema/calibration-record.v0.1.json) (RFC-C v0.2) lands. No records exist yet. |
| Cross-substrate strip view | **landed** (2026-05-10) | Tab in the right pane: when filters narrow to a single substrate + ẋ-kind, renders a grid of mini gFDR plots ordered by the substrate's regime-migration parameter (T for glass, p_base for quantum, scenario-order for brain). Shared axis range across the strip for honest visual comparison. |
| Pattern library curation | not started | Curated bookmarks of canonical signature shapes (s-aging diagonal, c-frozen suppressed locus, r-equilibrium unit-slope). Trains operators by example. |
| Driver-profile versioning replay | not started | Once an old episode is on file with a sealed driver profile, replay it through a newer profile. Calibration is the gating dependency. |
| Brain Langevin reference driver consumption | gated on mpa-atlas | Brain library cells render fine, but framework-canonical claims on them require [`reference-drivers/brain-langevin.md`](https://github.com/ronviers/mpa-atlas/blob/main/reference-drivers/) per RULES.md rule 14. mpa-atlas handoff item 2 covers it. |

---

## Open item 1 — X-ratio derivation view

The current strip view shows the raw `χ_d vs (C_d_diag − C_d)` parametric. The MPA-canonical regime invariants live in *derivatives* of that parametric, not in the parametric itself (per [v9 §FDR signatures](https://github.com/ronviers/mpa-atlas/blob/main/framework/v9_compressed.md)):

- `X(τ) = χ(τ) / (C(0) − C(τ))` — the FDR violation factor
- `X_c = lim_τ X = 0` (c-regime), `X_r = 1` (r-regime)
- `α_s = slope of aging segment in χ vs (C₀−C)` (s-regime, ∈ (0,1))
- `N_f = ∫min(0,χ)dτ / ∫|χ|dτ` (k_frust regime, transient-negative fraction)

The current view asks the operator to *eyeball* asymptotic slopes on per-cell auto-scaled axes — slopes that often live at the curve's high-(C₀−C) tail and aren't visually distinct on linear axes. An **X-ratio strip** would compute these directly and plot:

- **Per cell:** `X(τ_window)` vs `τ_window` (one cell, one curve, walks across kernel widths)
- **Across cells:** asymptotic `X` value at the longest-lag tail vs operating-point parameter (T for glass, p_base for quantum, scenario for brain). Reference horizontal lines at `X=0` and `X=1`. The walk c → s → k → r should visibly traverse the [0, 1] band, with k-cells landing at negative X due to N_f > 0.

This is the view that converts shape-eyeballing into regime-reading.

**Implementation notes:**

- Need an asymptotic-slope estimator. First-pass: fit a line through the last N points of each (cell, τ_window) curve, take the slope as `X`. N=5 or so. Robust to brain's `SEM=null` because slope is from means; uncertainty propagation deferred.
- For `N_f`: count points with `χ_d_mean < 0` per (cell, τ_window), normalize by total points. Trivial.
- Handle below-T_c glass cells (`tau_env_analytic = null`) honestly: the asymptotic limit may not exist on the experiment timescale; surface that as a "limit not reached" annotation rather than computing a misleading number.

**Done when:** new tab "X-ratio · regime derivation" alongside `single` / `strip`; given a (substrate, ẋ-kind), renders the X-ratio walk across operating points; below-T_c cells annotated with "limit not reached" where applicable; clicking a point drills back to the single-cell view for that (cell, τ_window).

**Effort:** A few hours. The math is mechanical (linear fit on tails); the honesty-about-limit-not-reached part is the load-bearing UX work.

---

## Open item 2 — Calibration pipeline stepper

The proposal's second bullet: a stepper that walks through a
calibration record (RFC-C v0.2 schema) primitive by primitive
(`L`, `G_0`, `τ_obs`, `γ_AB`), surfacing the substrate-native SOP
provenance and the validation evidence at each step. The stepper is
the "calibration mode" the proposal contrasts against runtime.

Blocked on: no sealed calibration records exist yet. The first one
will likely come from running an mpc-glass or mpc-quantum experiment
through RFC-C's protocol and emitting a record matching the schema at
[`schema/calibration-record.v0.1.json`](https://github.com/ronviers/mpa-atlas/blob/main/schema/calibration-record.v0.1.json).

**Done when:** mpa-view loads a calibration record by path; a stepper
UI walks through `measurements.{L, G_0, tau_obs_canonical, gamma_AB}`
in order; each step shows the measured value, uncertainty, SOP
reference, and the evidence file (cessation trace, drive sweep, etc.)
inline.

**Effort:** A few hours once the first record exists. Mechanical
schema → UI mapping.

---

## Open item 3 — Pattern library curation

A curated set of *bookmarked views* — saved (cell, view-type, zoom,
annotation) tuples that name canonical signature shapes ("s-aging
diagonal at moderate aging", "c-frozen suppressed locus at deep
freeze", etc.). The pattern library is what trains operators to
recognise when a substrate is well-characterised.

This is a UI feature (save / name / annotate / share) plus a small
JSON store of bookmarks under `pattern-library/`. Out of scope until
v0.1 has logged enough use to know what shapes are worth bookmarking;
premature curation is anti-pattern.

---

## Conventions reminder

- mpa-view conforms to the `mpa-*` repo convention. Single handoff per
  repo at `docs/handoff_next_session.md`. Multiple parallel pending
  items live as "Open item N" subsections within this single file.
- A handoff carries only transient content (this open item, what to do,
  done-when, effort). Architectural commitments / framework reasoning
  live in the README, the proposal, or the protocol RFCs in
  [mpa-atlas](https://github.com/ronviers/mpa-atlas).
- When an open item closes, **delete its section in the same commit
  as the deliverable**. Absorb any durable content into its real home
  first. When the last item closes, delete this file.
