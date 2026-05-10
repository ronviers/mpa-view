# mpa-view

A microscope for inspecting the MPA measurement isomorphism.

**Not a dashboard.** Not real-time. No alerts. **A viewer.** Consumes
the [mpa-central library](https://github.com/ronviers/mpa-central) of
characterized substrate cells (glass, quantum, brain) and renders them
through MPA primitives — vertex regimes, gFDR signatures, ground-truth
labels — so a human operator can *see* whether a substrate is
well-characterized or whether the canonical reading is failing.

The mission, plain: episode loader + calibration pipeline stepper +
pattern library browser. Institutional experience is the product —
operators learn what a well-characterised substrate looks like by
seeing many of them through the same canonical lens, and learn what
a *failing* canonical reading looks like by the same exposure.

The companion protocol is
[MPA-RFC-C v0.2 (Calibration)](https://github.com/ronviers/mpa-atlas/blob/main/rfcs/MPA-RFC-C-Calibration.md);
mpa-view's calibration mode consumes its calibration-record artifact.

## What's running

Three view tabs:

1. **single cell.** All ~31 τ_obs window curves superimposed for one
   library cell. The raw substrate-native parametric.
2. **strip · substrate-native.** All cells matching the (substrate,
   ẋ-kind) filter, ordered left→right by the regime-migration
   parameter (T for glass, p_base for quantum, scenario-order for
   brain). Per-cell auto-scaling (the τ_env-anchored time grids
   differ in absolute scale by ~100× per LIBRARY_SPEC; shared axes
   squashed below-T_c cells into invisibility, so this view trades
   magnitude comparison for shape readability).
3. **X-ratio · canonical.** Substrate-native (χ, C) data mixed down
   to the canonical X-ratio space the framework defines its regime
   invariants in (per RFC-S §1's RG-flow framing). τ_window rescaled
   by τ_env_analytic (LO mix-down); X estimated as `lim χ/(C₀−C)`
   per (cell, τ_window) per [v9 §FDR signatures](https://github.com/ronviers/mpa-atlas/blob/main/framework/v9_compressed.md).
   Two stacked panels: log-Y X with framework r-canonical reference
   at X=1 (calibrated-units caveat surfaced), linear N_f for the
   k_frust signature. Filled markers = asymptote reached, hollow =
   curving.

Filters in the left panel: substrate / gt / ẋ-kind. Cell list
shows gt-regime color badges. URL hash `#<task_id>` deep-links to
a specific cell.

## What's not yet running

- **Calibration pipeline stepper.** No sealed
  [calibration records](https://github.com/ronviers/mpa-atlas/blob/main/schema/calibration-record.v0.1.json)
  exist to step through yet. Scaffold ready; activates when the first
  record lands.
- **Cross-substrate overlay in canonical X-ratio space.** Currently
  the X-ratio view is single-substrate; the next move is to overlay
  glass + quantum + brain in the same canonical-X plot to instance
  the framework's cross-substrate transfer claim (universality
  classes visceral). See [`docs/handoff_next_session.md`](docs/handoff_next_session.md).
- **Pattern library curation.** Bookmark named canonical signature
  shapes for operator training. Deferred until v0.1 use shows what's
  worth bookmarking.

## Running

```
python H:/mpa-view/server.py
```

Then open <http://127.0.0.1:18766>. Override host/port with
`MPA_VIEW_HOST` / `MPA_VIEW_PORT`.

The server is stdlib-only (no Flask, no FastAPI). Plotly is loaded from
CDN; if you need offline operation, vendor `plotly.min.js` into
`static/vendor/`.

## Conventions

- mpa-view conforms to the `mpa-*` repo convention: `docs/handoff_next_session.md`,
  `dev_profile.json`, top-level entry script. Discipline notes in
  [`H:/mpa-atlas/CLAUDE.md`](https://github.com/ronviers/mpa-atlas/blob/main/CLAUDE.md)
  govern the protocol-shaped surfaces (calibration record schema,
  reference drivers); implementation code in this repo is normal
  engineering, not thin-RFC.
- Library reads are read-only. mpa-view never writes back into
  `H:/mpa-central/library/`.
- Single-client by design (matches mpa-visualizer's pattern). No
  multi-tenant concerns.
