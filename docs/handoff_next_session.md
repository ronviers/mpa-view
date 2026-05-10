# mpa-view — next-session handoff

**Status (2026-05-10):** v0.1.3. Three view tabs landed: `single cell`,
`strip · substrate-native`, `X-ratio · canonical`. Reads 60 cells from
`H:/mpa-central/library/` (16 brain / 22 glass / 22 quantum). Server
at `127.0.0.1:18766` (override via `MPA_VIEW_HOST` / `MPA_VIEW_PORT`).
Github at <https://github.com/ronviers/mpa-view>.

The X-ratio view is the load-bearing piece — it mixes substrate-native
(χ, C) data down to the canonical X-ratio space the framework defines
regime invariants in (per [RFC-S §1](https://github.com/ronviers/mpa-atlas/blob/main/rfcs/MPA-RFC-S_Scale-Management.md#1-canonical-representation-at-observer-position-p)
RG-flow framing; per [v9 §FDR signatures](https://github.com/ronviers/mpa-atlas/blob/main/framework/v9_compressed.md)
for X / α_s / N_f definitions). The other two views are stepping
stones that helped us get there honestly.

Read in this order before picking up:

1. This file.
2. [README.md](../README.md) — what's running, how to run it.
3. [`H:/mpa-atlas/CLAUDE.md`](https://github.com/ronviers/mpa-atlas/blob/main/CLAUDE.md) §Scope — implementation code in this repo is normal engineering, not thin-RFC. Protocol-shaped surfaces (calibration record schema, reference drivers) live in mpa-atlas and obey thin-RFC discipline.

---

## Open item 1 — Cross-substrate overlay in canonical X-ratio space

**The single highest-leverage next move.** Currently the X-ratio view
requires a single (substrate, ẋ-kind) filter — it overlays cells
*within* one substrate. The cross-substrate overlay would relax that:
plot glass spin-relative + quantum detection-event + brain velocity
(or whatever channel pairing makes sense) on the same canonical-X
plot. Same x-axis (τ_window/τ_env_eff). Different markers per
substrate; color still by gt-regime.

**Why this matters:** the framework's strongest empirical claim is
that c → s → r migration is a *cross-substrate universality* — same
α_s slope across substrates within tolerance, per [character_compressed.md
§gFDR signatures](https://github.com/ronviers/mpa-atlas/blob/main/framework/character_compressed.md).
The current per-substrate view can't instance that claim because
each substrate is rendered alone. The overlay can.

**Implementation:**

- Relax the single-substrate filter requirement on the X-ratio view.
- Allow multi-substrate selection (or default to "all" when no
  substrate filter is active).
- Per-substrate marker symbol (circle / square / triangle), color
  still gt-regime.
- Per-cell hover already shows substrate; that stays.
- Honest annotation: cells from different substrates land at
  different absolute X because they have different un-normalized
  units; relative migration shapes are what's comparable, not
  absolute heights. (Same calibration caveat as the per-substrate
  X-ratio view, just louder.)

**Done when:** X-ratio view renders multi-substrate overlays
correctly; one combined cluster per (substrate, gt) visible; the
operator can read whether s-cells from glass and quantum land at
similar canonical X positions (the cross-substrate transfer test).

**Effort:** A few hours. Mechanical extension of the existing
`renderXratio` / `renderXratioPlots` paths in `static/shell.js`.

---

## Open item 2 — Calibration pipeline stepper

**Gating:** No sealed calibration records exist yet. The
[`calibration-record.v0.1.json`](https://github.com/ronviers/mpa-atlas/blob/main/schema/calibration-record.v0.1.json)
schema shipped with [RFC-C v0.2](https://github.com/ronviers/mpa-atlas/blob/main/rfcs/MPA-RFC-C-Calibration.md);
the first record will likely come from running an mpc-glass or
mpc-quantum experiment through the protocol.

The stepper is a tab that walks through a record primitive by
primitive (`L`, `G_0`, `τ_obs_canonical`, `γ_AB`), surfacing the
substrate-native SOP provenance and the validation evidence at
each step. The stepper is the "calibration mode" the project's
mission contrasts against runtime.

**Done when:** mpa-view loads a calibration record by path; a
stepper UI walks through `measurements.{L, G_0, tau_obs_canonical,
gamma_AB}` in order; each step shows the measured value,
uncertainty, SOP reference, and the evidence file (cessation
trace, drive sweep, etc.) inline.

**Effort:** A few hours once the first record exists. Mechanical
schema → UI mapping.

---

## Open item 3 — Pattern library curation

A curated set of *bookmarked views* — saved (cell, view-type, zoom,
annotation) tuples that name canonical signature shapes ("highest
N_f at T_c in EA-glass spin-flip", "monotonic 3-decade X walk in
quantum detection-event", etc.). The pattern library is what trains
operators to recognise when a substrate is well-characterised.

This is a UI feature (save / name / annotate / share) plus a small
JSON store of bookmarks under `pattern-library/`. Out of scope until
v0.1 has logged enough use to know what shapes are worth bookmarking;
premature curation is anti-pattern.

---

## Notable findings to surface upstream

These came out of using the views built this session — they're
empirical observations the microscope generated. They belong in
mpa-atlas (reference drivers / RFC-C) eventually:

1. **Per-invariant ẋ-channel preferences for structural-glass.** Spin-flip
   is the right ẋ-channel for reading `N_f` (the k_frust signature);
   spin-relative is the right channel for `X-ratio` (and eventually
   `α_s`) reading. The reference driver's Calibration section should
   declare which channel is canonical for which invariant. mpa-atlas
   handoff item 1.
2. **N_f peaks at T_c in glass spin-flip.** T=1.000 (gt=k) cell shows
   N_f mean 0.318 (max 0.500) — empirically the highest in the strip.
   That's the framework's k_frust signature instancing precisely
   where it should. Worth noting in `reference-drivers/structural-glass.md`
   as an empirical confirmation.
3. **gt-label vs gFDR-signature disagreements as calibration content.**
   T=0.200 (gt=c) glass spin-flip shows N_f ≈ 0.21 — substantial
   transient-negative response that doesn't fit the c-label's
   thermodynamic prior. Either the gt label needs revision (the
   thermodynamic-T criterion misses frustration-instantiation) or
   the reference driver should declare that c-cells in spin-flip
   show N_f anyway. Calibration discipline ought to specify which
   wins when label and signature disagree.

---

## Conventions reminder

- mpa-view conforms to the `mpa-*` repo convention. Single handoff
  per repo at `docs/handoff_next_session.md`. Multiple parallel
  pending items live as "Open item N" subsections within this
  single file.
- A handoff carries only transient content (open item, what to do,
  done-when, effort). Architectural commitments / framework
  reasoning live in their real homes — README, [`H:/mpa-atlas/CLAUDE.md`](https://github.com/ronviers/mpa-atlas/blob/main/CLAUDE.md),
  the protocol RFCs, the framework documents.
- When an open item closes, **delete its section in the same commit
  as the deliverable**. Absorb any durable content into its real home
  first. When the last item closes, delete this file.
