# Changelog

## 0.2.4 (2026-10-27)
* Menu: the script moves from *Script > Utilities* to *Script > JPS*, the folder that groups
  the PixInsight scripts of Jacques Pouyaud. No change to the behaviour.

## 0.2.3 (2026-10-27)
* PixInsight 1.9.5 or later required (update repository, archive `ClarkeMask-0.2.3-PI195.zip`,
  READMEs): the version the script is developed and tested on, and the first with the threads used
  by the parallel detection. Versions up to 0.2.2 declared 1.9.4, never tested on it. No change to
  the behaviour.

## 0.2.2 (2026-10-27)
* Licence changed from MIT to the GNU General Public License, version 3 or later
  (GPL-3.0-or-later). Versions up to 0.2.1 remain available under the MIT License. No change to
  the behaviour.
* README: credit request for reuse of the method or the code.

## 0.2.1 (2026-10-27)
* Trail direction checked against the trails: a mirrored astrometric solution (wrong parity,
  shown as "flipped" by PixInsight, seen with some WCS written at acquisition) gave the mirrored
  direction, and nothing was masked in the whole group. The engine now detects along the
  direction and its mirror on up to three frames and uses the one where the trails are, with a
  line in the log; when neither shows a trail, the log says so instead of masking nothing
  silently. Reported by [nico1038](https://telescopius.com/profile/nico1038), thanks.
* Documentation and messages: the plate solving of WBPP only solves the masters, after
  integration; the frames need a WCS written at acquisition, or a reference solved with
  ImageSolver.

## 0.2.0 (2026-10-27)
* Parallel detection (PixInsight 1.9.5 and later): the frames of a group are detected on PJSR
  threads, one per frame, while the main thread masks and saves them in order; same results as in
  series (identical masks and reports on XISF float and FITS 16-bit frames), several times faster
  on a multi-core machine. Setting **detection threads** (`ClarkeMask/threads`, Auto by default:
  processors allowed by the platform, limited by the available memory; 1 = serial) in the dialog,
  used by the WBPP event script. Stop acts during the detection. Serial with PixInsight 1.9.4.
* Core: the namespace is built by `ClarkeMaskCoreFactory()`, whose source is sent to the threads.
* Log: total time of each group and number of threads.
* Masks written as 8-bit integer and the coverage map as 32-bit float, as intended (both were
  written with the default 16-bit integer format).
* Tests: `tests/run_group_pi.js` (a group in preview mode with a given number of threads) and
  `tests/compare_runs.py` (two runs compared: reports, coverage, masks).

## 0.1.0 (2026-10-27)
* First version: masking of geostationary satellite trails inside WBPP (event script) or from
  the ClarkeMask dialog, validated on real data (raw and calibrated). PixInsight update repository
  built in `docs/` (unsigned), served at `https://jps-34.github.io/ClarkeMask/` once published.
* Project skeleton: READMEs, design notes, maintenance notes, update repository builder.
* Numeric core (`scripts/ClarkeMaskCore.js`): trail detection along a given direction and mask
  rasterization at full resolution; node test harness in `tests/`.
* PixInsight layer (`scripts/ClarkeMaskEngine.js`): trail direction from the astrometric
  solution, once per group; 0 written under the masks in every channel, frame replaced through a
  temporary file; one compressed mask file per frame, CSV report; mono and RGB.
* Cost of the masks per group: score line (worst case and mean SNR kept), table of exposure and
  SNR kept per number of frames lost with the share of the field, map of the exposure fraction
  kept (`coverage.xisf`, `coverage.csv`).
* Preview (`dryRun`): masks, report and predicted cost written, frames left untouched.
* `DETECTOR.md`: every heuristic of the detector, its parameter, value, unit, purpose and limits;
  what decides, what only shapes the mask, what is only reported.
* Angle search: detection also on grids tilted up to 2.25 deg either side of the belt direction
  (inclined geosynchronous objects), one decision per trail, filter against false trails made of
  crossings of dense parallel trails, explicit angle criterion (`maxAngle`, trails beyond reported
  as `angle`), masks that follow the fitted line, merged pieces judged one by one when bent.
* User setting **maximum angle from the belt** (`ClarkeMask/maxAngle`, default 2.5 deg), read by
  the engine and the WBPP event script; the tilted grids follow it. Explained in the READMEs.
* Length diagnostic: expected length of a geosynchronous trail from the exposure and the
  astrometric solution, ratio and class per trail (`single`, `overlap`, `cut`, `partial`), counts
  in the log, one line per trail in `trails.csv`. Reported, not a criterion (DETECTOR.md 6.1).
* Confirmation by length: beyond the maximum angle and up to `ClarkeMask/maxConfirmedAngle`
  (user setting, default 7 deg), a straight trail of about one expected length with both ends free
  is masked as a geosynchronous object; marked "confirmed by length" in the log and `trails.csv`.
  Beyond the maximum angle the search uses coarser grids (1.5 deg), enough for the confirmation.
* Dialog (`scripts/ClarkeMask.js`, *Script > Utilities > ClarkeMask*), English or French: list of
  registered frames with their results, the two angle settings (saved at once, used by the WBPP
  event script), value under the masks (0 or NaN), output folder; Preview (masks, report, cost)
  and Apply (masked copies `<frame>_cm.xisf`, inputs never modified); frame with its mask as an
  overlay, coverage map; path of the WBPP event script; Reset (standard icon, bottom left), Stop.
* Engine: masked copies into a folder, NaN as the value under the masks, NaN treated as no data,
  hooks for the dialog (stop between frames, per-frame result, UI events during detection).
* WBPP event script run on its own (Script > Execute Script File): it now says, in English and
  French, that it must be selected in WBPP (Pipeline tab, Event Script box), instead of doing
  nothing silently.
* Dialog: summary of the results in the interface language (totals, worst case, cost per number
  of frames lost, expected length), shorter status texts, coverage map window named
  `ClarkeMask_coverage`, note when the maximum angle is at or above the confirmation limit.
* Faster detection (about x1.7): segments wholly outside the image skipped, sliding median for the
  perpendicular high-pass (same results), per-pixel noise estimated on one row of cells in eight
  (masks unchanged on the frames tested).
* WBPP event script (`scripts/ClarkeMask-WBPP.js`): masks each light group right after
  registration, before local normalization and integration; own log in the WBPP output.
