# ClarkeMask: design notes

Working notes for development. Statements marked **(to test)** are hypotheses, not facts.

## 1. Problem

Near the geostationary belt the sky drifts parallel to the belt, so a target on it stays on it
all session. Each geostationary object is fixed in hour angle: during one exposure it draws a
trail along the constant-declination direction, of length

    L ~ t_exp x 15.04"/s x cos(dec) / pixel scale

Several objects at nearly the same declination give parallel trails packed in a narrow band, in
most frames. Per-pixel overlap between frames is usually low (each object crosses a given sky
position once), but the trails are faint: their per-pixel excess can sit at or below the clipping
level of the usual rejection algorithms **(to test: bias of an unmasked stack)**. Discarding the
frames is not an option; masking the trail pixels is.

## 2. Where it runs: inside WBPP

### Event script hook

WBPP (3.1.x, `src/scripts/BatchPreprocessing/`) runs its pipeline as a serial operation queue and
can carry one user **event script** (`BPP-OperationQueue.js`, "THE EVENT SCRIPT"):

* hooks `onPipelineStart`, `onOperationStart`, `onOperationDone`, `onPipelineEnd`, each called
  with `( env, state )`;
* for trackable operations, `env` carries what the operation publishes through `envForScript()`;
  the registration operation (`BPP-Operations.js`, `RegistrationOperation`) publishes
  `name: "Registration"`, `status` and `group` (the frame group);
* `group.activeFrames()` lists the frames; `frame.current` is the path of the file the next steps
  will read, i.e. the registered frame after registration;
* local normalization and integration are queued after registration and run after the hook
  returns.

So `onOperationDone` with `env.name == "Registration"` is the insertion point: registered frames,
before LN and integration.

### How a per-frame mask reaches the integration

ImageIntegration takes no mask per image: each row of `II.images` is
`[enabled, filePath, drizzlePath, localNormalizationPath]` (`BPP-Helper.js`,
`enableTargetFrames`). The mask must therefore be carried by the pixel values.

For light frames WBPP sets `rangeClipLow = true`, `rangeLow = 0` (`BPP-Processing.js`, light
integration case). That is how the zero borders left by registration are excluded frame by frame.
A masked pixel written as 0 follows the same path: at integration, each pixel is stacked from the
frames not masked there, and rejection statistics are computed on what remains.

### In place, with one mask file per frame

* The registered frame is modified in place. A masked copy would break the association of the
  `.xdrz` and `.xnml` files, which WBPP derives from the frame's base name.
* Registered frames are WBPP intermediates: originals and calibrated frames are never touched.
* One mask file per frame (compressed XISF) is written to `<WBPP output>/ClarkeMask/groupNN/`,
  with the coverage map, a CSV report per frame and `trails.csv` (one line per trail, with the
  length diagnostic), for visual checking and to tell what was masked; the
  run log goes to `<WBPP output>/ClarkeMask/ClarkeMask.log`. A HISTORY keyword in each masked
  frame records the number of trails and pixels.
* The frame is written to a temporary file next to it, then replaces it: a failure never leaves a
  half-written frame.

### Constraints of the hook

* The event script is compiled with `eval` (`compileEventScript`): `#include` is not processed
  there. Decided: the event script loads `ClarkeMaskCore.js` and `ClarkeMaskEngine.js` at run time
  with an indirect eval, from the folder of the event script (`engine.pipelineScriptFile`).
* WBPP holds one event script at a time: a user who already has one must chain both.
* A failing event script is reported as a warning and the pipeline carries on: errors must be
  logged clearly, and a frame that could not be processed must be left untouched.

### Parallel detection

PixInsight 1.9.5 runs JavaScript on `Thread` objects, each with a V8 runtime of its own (nothing
shared, data passed by structured clone). The detection, the costly part (several seconds per frame on one core), runs
there: one thread per frame reads it with `FileFormatInstance`, builds the detection image and runs
`detectAll`; the main thread masks and saves the frames in order as their detections arrive
(`ImageWindow` does not exist in a thread). Same code, so the same results as the serial path
(checked: identical masks and reports, XISF float and FITS 16-bit). The core is rebuilt in each
thread from the source of `ClarkeMaskCoreFactory`, with the few engine helpers it needs.

* Threads: setting `ClarkeMask/threads`, 0 = automatic (processors allowed by the platform,
  limited by the available memory, a frame and its buffers per thread), 1 = serial.
* PixInsight 1.9.4 (no `Thread`): serial, unchanged.
* A frame whose thread fails is detected again in the main thread. Stop: the threads poll an abort
  flag between grids, and every thread is joined before the group ends.
* An optional Python helper was considered and prototyped (branch `dev/python`): slower than the
  threads, a second implementation to keep in sync, a dependency for users, and bit differences of
  the system math library against V8's fdlibm. Dropped.

## 3. Standalone dialog

A Script menu entry for frames registered outside WBPP, or for other stackers: same detection,
masked copies written next to the inputs, 0 or NaN as the "no data" value. It also holds the user
settings (maximum angle, maximum angle confirmed by length) with their explanations, used by the
WBPP event script.

Viewing the masks (light: one compressed mask per frame, opened on demand): a list of the frames
with their trails (length class, angle, confirmed or reported); selecting one opens the frame
with its mask shown as a PixInsight mask overlay; the coverage map opens with an STF. The same
works on the output of a WBPP run (`ClarkeMask/groupNN/`).

## 4. Detection

Input: one registered frame, mono or RGB. Detection runs on a 2x2-binned channel mean (masks are
several pixels wide, nothing is lost); the mask is written at full resolution on every channel.

1. **Trail direction** from the astrometric solution: the pixel direction of constant declination
   at the frame centre. Registered frames share the grid of the registration reference and carry
   its solution (verified with WBPP, plate solving off, source frames solved at acquisition), so
   the direction is computed once per group, from the reference frame first. **An astrometric
   solution is required, by design** (decided with the author: plate solving is standard practice
   today). Without one, the group is left untouched and the log says how to get one (plate solving
   at acquisition, in WBPP, or with ImageSolver). No fallback direction is planned.
2. **Rectify and take segment medians**: for each distance to the line through the centre (1 px
   steps) and each segment along the trail, bilinear samples and their median. Stars are
   rejected, continuous trails kept. Pixels at 0 (no data) are ignored.
3. **Per-pixel noise**: median over all cells of each cell's MAD (includes correlated noise).
4. **Perpendicular high-pass** on the segment medians (running median across the trails) to
   remove nebulae and gradients: excess E in per-pixel noise units.
5. **Hysteresis**: a trail core is an 8-connected run of cells above a multiple of the measured
   noise of E, over a minimum number of segments; in each segment the mask extends across the
   trail while E stays above the edge level (about 0.5 sigma at native scale), plus a margin.
   Thresholds follow the measured noise, so they adapt to interpolated frames.
6. **Merge and plausibility**: collinear pieces separated by a short gap are merged; a trail must
   be straight and thin, otherwise it is reported and not masked. Length compared with L (single
   object) or a chain of L (collocated objects end to end) is for reporting, not a hard cut.
7. **Ends** refined sample by sample along the trail, not on the segment grid.

Implemented in `scripts/ClarkeMaskCore.js` (pure JavaScript, validated under node with
`tests/run_core.js` on frames exported by `tests/export_fits.py`). Every heuristic, parameter and
known limit is documented in [DETECTOR.md](DETECTOR.md).

Not covered: trails at other angles (non-geostationary objects). They hit one frame each and are
left to the normal rejection.

## 5. Coverage map

Registered frames share one pixel grid: per pixel, the frames valid after masking. Masking does
not lose signal (the mean is computed from fewer frames); it loses exposure, hence SNR. A pixel
that lost k of N frames keeps (N-k)/N of the exposure and, with equal frame weights,
sqrt((N-k)/N) of the SNR (an estimate: WBPP weights the frames).

The report is given over the field covered by every frame before masking (registration borders
excluded):

* a score line: the worst case (frames lost, exposure and SNR kept, share of the field) and the
  mean SNR kept over the field;
* one line per number of frames lost: exposure kept, SNR kept, pixels, share of the field (also
  in `coverage.csv`);
* a warning when pixels keep less than a set fraction of the frames;
* `coverage.xisf`: map of the exposure fraction kept (1 = untouched), to view with an STF.

## 6. Validation on a real WBPP run

Run headless (automation mode) on a short raw OSC sequence near the belt, without calibration,
with local normalization and rejection maps, once without and once with the event script:

* **Hook**: the event script is installed, the registration `done` event carries the group, and
  `activeFrame.current` is the registered file. LN and integration then read the masked frames.
* **In-place save**: astrometric solution, alignment matrix, signatures and noise/signal
  properties are kept; only `XISF:OutputHints` is dropped. The noise and signal estimates used for
  the weights predate the masking (negligible for a small masked area).
* **Bias (question 1)**: trails are still detected in the unmasked master; none in the masked
  one. At trail positions the unmasked rejection maps show no more low rejection than the
  background: the usual rejection does not remove these trails.
* **Range rejection with LN (question 2)**: in the masked run, `rejection_low` at the mask
  positions equals the fraction of masked frames plus the background rate: each pixel is
  integrated from the frames that are clean there.
* **LN model (question 3)**: outside the masks the two masters agree to a small fraction of the
  noise (indicative).
* **Mono**: a one-channel registered frame gives the same trails and is masked the same way.

Then on a full calibrated, debayered and registered sequence of the same field (preview, then
integration with the WBPP light settings: ESD rejection, range rejection of 0), originals left
untouched:

* **Detection on calibrated frames**: trails in every frame; the faintest detections checked one
  by one on rectified strips are real; no false positive found; lengths match the geostationary
  drift for the exposure.
* **Range rejection**: `rejection_low` at mask positions equals the masked fraction plus the
  background rate, as on raw frames.
* **Size of the effect**: with a longer sequence and ESD rejection, the unmasked master no longer
  shows detectable trails: ESD removes only a small part of the trail values, and what is left
  sits below the per-pixel noise of the master, but along coherent lines (clearly visible in the
  difference of the two masters). The largest differences are on bright stars crossed by a mask
  (removing a frame changes the star core slightly), not on the background.
* **Reasoning, to verify**: the bias left by unmasked trails does not average down with more
  frames of the same geometry, while the noise does; on longer integrations (several nights on a
  target that stays on the belt) the lines should come out of the noise.
* **Limit found, then addressed**: trails a degree or two off the belt direction (inclined
  geosynchronous objects) were only partly masked. The detection now also runs on grids tilted
  around the belt direction, with one decision per trail and a filter against false trails made
  of crossings of dense parallel trails (DETECTOR.md, sections 3.11 and 3.12).

## 7. Open questions

1. Drizzle: are pixels rejected by range rejection written to the `.xdrz` rejection data, so that
   DrizzleIntegration honours the masks? (Not settable in automation mode: interactive test.)
2. WBPP execution cache: behaviour on a second run when registered files were modified in place,
   and whether a cached registration still raises the `done` event. (Automation instances do not
   keep the cache: interactive test.)
3. Separate RGB channels output of WBPP (one virtual group per channel): untested.
4. Width of the angle search: user settings (`ClarkeMask/maxAngle`, default 2.5 deg;
   `ClarkeMask/maxConfirmedAngle`, default 7 deg), to be exposed in the dialog with their
   explanations.

## 8. Out of scope for the first version

* FastIntegration (no registration operation).
* Masking before registration (interpolation would smear the mask edges).
* Non-geostationary trails.
