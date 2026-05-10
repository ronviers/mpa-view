# mpa-view

A microscope for inspecting the MPA measurement isomorphism.

**Not a dashboard.** Not real-time. No alerts. **A viewer.** Consumes
the [mpa-central library](https://github.com/ronviers/mpa-central) of
characterized substrate cells (glass, quantum, brain) and renders them
through MPA primitives — vertex regimes, gFDR signatures, ground-truth
labels — so a human operator can *see* whether a substrate is
well-characterized or whether the canonical reading is failing.

The proposal lives at
[`H:/mpa-atlas/rfcs/MPA-View_Proposal.md`](https://github.com/ronviers/mpa-atlas/blob/main/rfcs/MPA-View_Proposal.md):

> Episode loader + calibration pipeline stepper + pattern library
> browser. The viewer is not a dashboard; it is a microscope for
> inspecting the measurement isomorphism. Institutional experience is
> the product.

The companion protocol is
[MPA-RFC-C v0.2 (Calibration)](https://github.com/ronviers/mpa-atlas/blob/main/rfcs/MPA-RFC-C-Calibration.md);
mpa-view's calibration mode consumes its calibration-record artifact.

## What's running at v0.1

- **Episode index.** Lists every library cell at
  `H:/mpa-central/library/data/{brain,glass,quantum}/*.json`, indexed
  by substrate / operating point / ẋ-kind / ground-truth regime label.
- **gFDR signature view.** Cugliandolo–Kurchan parametric plot —
  χ_d(τ_obs) vs (C_d_diag - C_d) at every sampled (t, dt), one curve
  per τ_obs window, colored by kernel width. Ground-truth regime label
  (`gt: c|s|k|r`) overlaid prominently.
- **Substrate-aware axes.** τ_obs grid is τ_env-anchored per cell per
  the [LIBRARY_SPEC](https://github.com/ronviers/mpa-central/blob/main/library/LIBRARY_SPEC.md);
  the view exposes that grid honestly rather than rescaling it.

## What's not yet running

- **Calibration pipeline stepper.** No sealed
  [calibration records](https://github.com/ronviers/mpa-atlas/blob/main/schema/calibration-record.v0.1.json)
  exist to step through yet. Scaffold ready; activates when the first
  record lands.
- **Cross-substrate strip view.** Render a row of small gFDR plots
  across operating points so regime migration is visceral. Queued.
- **Pattern library curation.** The view-of-views index — common
  signature shapes (s-aging diagonal, c-frozen suppressed locus,
  r-equilibrium unit-slope) named and bookmarked for training. Queued.

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
