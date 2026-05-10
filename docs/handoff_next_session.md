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
| Cross-substrate strip view | not started | Render a row of small gFDR plots across operating points so regime migration is visceral (proposal's "pattern library makes universality classes visceral"). |
| Pattern library curation | not started | Curated bookmarks of canonical signature shapes (s-aging diagonal, c-frozen suppressed locus, r-equilibrium unit-slope). Trains operators by example. |
| Driver-profile versioning replay | not started | Once an old episode is on file with a sealed driver profile, replay it through a newer profile. Calibration is the gating dependency. |
| Brain Langevin reference driver consumption | gated on mpa-atlas | Brain library cells render fine, but framework-canonical claims on them require [`reference-drivers/brain-langevin.md`](https://github.com/ronviers/mpa-atlas/blob/main/reference-drivers/) per RULES.md rule 14. mpa-atlas handoff item 2 covers it. |

---

## Open item 1 — Cross-substrate strip view

The proposal's third bullet: *"A rheologist inspecting a glass cessation
archetype and a QEC logical fidelity decay can see that both are
exponential extraction processes with different time constants. The
pattern library makes universality classes visceral."*

Implement as a tab / toggle that, given a (substrate, ẋ-kind, gt-class)
slice, renders a row of small gFDR plots — one per operating point — so
the operator sees regime migration as a single visual sweep. Glass at
T=0.5/0.7/0.85/0.95/1.00/1.10 should walk visibly through s-aging into
critical-then-r. Quantum at p=1e-4 → 5e-2 should walk r → s → k. Brain
across scenarios should walk c (committed) → s (suspended) → k
(conflict) → r (reset).

**Done when:** a strip-view tab exists; a single click on a (substrate,
ẋ) pair renders the strip ordered by operating-point parameter; the
operator can read regime migration without clicking through cells one
by one.

**Effort:** A few hours. Mechanical — same `views/gfdr.py` data prep
applied to N cells, laid out in a grid. Plotly subplot grid.

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
