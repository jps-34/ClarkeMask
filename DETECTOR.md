# ClarkeMask detector: heuristics and parameters

This document describes, step by step, how ClarkeMask decides that a structure in a frame is a
geostationary trail, and which pixels it masks. It matches `scripts/ClarkeMaskCore.js` (numeric
core) and `scripts/ClarkeMaskEngine.js` (PixInsight layer); parameter names are those of the
`DEFAULTS` objects of these two files. Any change to the detector must update this document.

## 1. What "geostationary trail" means here

A geostationary object is fixed with respect to the Earth. While the mount tracks the stars, the
object stays at the same declination and drifts relative to the stars at the sidereal rate, so
during one exposure it draws a straight segment along the **constant-declination direction**, of
length

    L = t_exp x 15.04"/s x cos(dec) / pixel scale

Several objects at nearly the same declination give parallel segments packed in a narrow band.

This holds at **any hour angle**, not only on the meridian. An object fixed with respect to the
Earth keeps a fixed hour angle and a fixed topocentric declination; its right ascension
(sidereal time minus hour angle) grows at the sidereal rate. Relative to the tracked stars it
therefore moves in right ascension only, along its own declination circle, east or west of the
meridian alike. What changes with the hour angle is the topocentric declination of the **belt**
(the locus of all geostationary objects, shifted by parallax): it is most southern on the
meridian for a northern observer and closer to the equator away from it. The belt is a curve,
tangent to a constant-declination line on the meridian only. Hence two different things:

* each trail is parallel to the constant-declination direction of the frame, whatever the hour
  angle: this direction is the detector's `theta`;
* the band where the trails gather drifts across the field during the night, as the field moves
  along the curved belt: the band position is therefore not used as a criterion.

Exceptions: objects not fixed with respect to the Earth (inclined geosynchronous orbits, drifting
objects) change declination during the exposure, so their trails are slightly tilted
(section 7). Station-keeping motions of active satellites are far too small to matter over one
exposure.

The detector does **not** identify satellites. It retains a structure that is:

1. oriented along the constant-declination direction of the frame, within `maxAngle`,
2. significantly brighter than the noise,
3. continuous over a minimum length,
4. straight,
5. thin.

Criteria 2 to 5 are the shape of a real trail; criterion 1 is what restricts the detector to the
geostationary belt. Length, position in the band and repetition across frames are **reported,
not used as criteria** (see section 6).

## 2. Units

Detection runs on a **detection image** binned 2x2 (`binning` = 2). Unless stated otherwise,
lengths below are in pixels of that image; multiply by 2 for full-resolution pixels. Noise levels
are in units of the per-pixel noise of the detection image (`sigPix`, section 3.3). On
registered (interpolated) frames this noise is correlated, so `sigPix` is not simply the native
noise divided by 2: the ratio has to be measured, not assumed.

## 3. Steps

### 3.1 Detection image (engine)

* Mean of the channels (mono: the single channel), then 2x2 mean.
* A pixel at exactly 0 carries no data (registration border, pixel already masked): a channel at
  0 makes the mean 0, and a 2x2 block with any 0 gives 0. Zeros are ignored by every later step.
* Why: trails are several full-resolution pixels wide, so 2x2 binning loses nothing and divides
  the work by 4; the channel mean uses all the signal and works the same for mono and colour.

### 3.2 Trail direction (engine)

* From the astrometric solution: two points at the image centre declination, 0.05 deg / cos(dec)
  either side in right ascension, converted to pixels; the normal to that chord is `theta`.
* Computed **once per group**, from the registration reference frame first, then from the first
  frame that has a solution. Registered frames share the reference grid and carry its solution.
* **An astrometric solution is required, by design.** No solution in the group: nothing is
  masked, and the log says how to get one (plate solving at acquisition, in WBPP, or with
  ImageSolver). There is no fallback direction.
* Assumption: one direction for the whole field. Lines of constant declination are slightly
  curved in the image on wide fields or far from the celestial equator; the segment test below
  absorbs small deviations (section 3.4).

### 3.3 Rectified grid and segment medians (core)

* The image is resampled (bilinear) on a grid aligned with `theta`: rows are distances `d` to the
  line through the image centre (1 px steps), columns are **segments** of `segment` = 64 samples
  along the trail direction.
* Each cell (one row, one segment) gets the **median** of its samples. A cell with fewer than
  `minValid` = 50% valid samples is undefined.
* Why the median: a star occupies only a few samples of a segment and is ignored; a trail fills
  the segment and passes.
* Per-pixel noise `sigPix`: for each cell, 1.4826 x MAD of its samples; `sigPix` is the median of
  these values over the cells of one row in eight (a median over tens of thousands of cells; the
  core threshold does not depend on it, section 3.5). It includes correlated noise.

### 3.4 Perpendicular high-pass (core)

* In each segment column, the running median of the cell medians across `d` over `highPass` = 31
  rows (at least 11 defined cells) is subtracted. The result divided by `sigPix` is the excess
  **E** of each cell, in per-pixel noise units.
* Why: nebulae, gradients and halos are wider than the window and are removed; a trail a few
  pixels wide is kept.
* Direction tolerance of one grid: a trail must stay in roughly the same rows over one segment.
  An angle error a shifts the trail by `segment` x tan(a) rows across a segment, so one grid
  catches faint trails within a few tenths of a degree (bright trails further). Trails off the
  belt direction are caught by repeating the detection on tilted grids (section 3.11).

### 3.5 Contrast threshold and continuity (core)

* Noise of E: robust sigma (`sigE`) of all defined cells, around their median.
* **Core** cells: E >= median + `coreK` x `sigE`, `coreK` = 10. The threshold follows the
  measured noise, so it adapts to raw, calibrated or interpolated frames.
* Core cells are grouped into 8-connected components (neighbouring rows and segments).

### 3.6 Merging collinear pieces (core)

* A component is appended to an earlier one when it starts 1 to `maxGap` + 1 segments after its
  last segment (`maxGap` = 2: up to two missing segments) and its first centre is within
  `mergeDistance` = 3 rows of the other's last centre.
* Why: a trail crossing a bright star or fading for a short while is split by the core
  threshold; this rebuilds it.
* Gaps are filled with the fitted centre (section 3.7) and the median width of the trail.

### 3.7 Length, straightness and thinness (core)

* **Minimum length**: the merged trail must span at least `minSegments` = 3 segments
  (192 px, about 380 full-resolution px). Shorter candidates are dropped **without being
  reported**.
* Centre of each segment: E-weighted mean row over its mask range (section 3.8). A straight line
  is fitted through the centres (least squares).
* **Straightness**: the largest deviation of a centre from the line (`bend`) must not exceed
  `maxBend` = 3 px (6 full-resolution px). Otherwise: reported as `bent`, not masked. Exception:
  when the candidate was built by merging several pieces (section 3.6), the pieces are judged
  one by one instead (two objects end to end, slightly offset, are not one bent trail).
* **Thinness**: the median width of the core (rows above the core threshold) must not exceed
  `maxCoreWidth` = 15 px (30 full-resolution px). Otherwise: reported as `wide`, not masked.
* Why: arcs of nebula, galaxy edges and star halos that pass the earlier steps are curved or wide.

### 3.8 Mask extent across the trail (core)

* In each segment, from the core rows outwards, the mask extends while E >= `edgeSigma` = 1.0
  (detection-image noise units; capped at the core threshold).
* Why: the faint wings of the trail, below the core threshold but above the noise, are masked too.

### 3.9 Ends (core)

* For the first and last segments, an along-trail profile is taken sample by sample: mean over
  the segment's mask rows, minus the column background, in noise units, smoothed by a running
  median of `endSmooth` = 9 samples.
* From the middle of the end segment outwards, over one and a half segment, the end is the last
  sample still at or above max(`edgeSigma`, 0.25 x the segment's peak E).
* Why: the segment grid alone would cut the trail up to half a segment short or long.

### 3.10 Rasterization at full resolution (core, engine)

* Each segment piece becomes a parallelogram that follows the fitted line of the trail (not the
  grid rows), scaled by 2, widened by `margin` = 2 full-resolution px on each side; the first and
  last pieces are lengthened by `endMargin` = 8 px.
* Every full-resolution pixel inside is masked, in every channel.

### 3.11 Angle search around the belt direction (core, `detectAll`)

* Steps 3.3 to 3.9 run on the grid at `theta` and on grids tilted by multiples of `angleStep` =
  0.75 deg either side. One grid catches trails within about half a step of its angle, so the
  outermost fine grids are the first whose reach covers `maxAngle` (`angleRange`, derived). When
  the expected length is known (section 6.1), coarser grids (`confirmStep` = 1.5 deg) go on until
  their reach covers `maxConfirmedAngle`. With the defaults: 7 fine grids up to 2.25 deg, then
  coarse grids at 3.75, 5.25 and 6.75 deg, 13 grids in all (7 without exposure time).
* Why a coarser step beyond `maxAngle`: there, a trail is masked only when it is about one
  expected length with both ends free (confirmation by length, below), so neither a crossing
  artefact nor a fragment can pass; and long straight trails stay detectable further from their
  grid angle. Cost: a faint inclined object far from a coarse grid may be missed; such trails are
  a bonus beyond the main criterion.
* Why: objects not fixed with respect to the Earth (inclined geosynchronous orbits) drift in
  declination and draw trails slightly tilted from the belt direction (section 1).
* The direction of each trail in the image is the grid angle corrected by its fitted slope.
  **Angle criterion**: a trail further than `maxAngle` from `theta` is not masked, unless its
  length confirms a geosynchronous object (below); otherwise it is reported as `angle`.
  `maxAngle` is a **user setting** (PixInsight setting `ClarkeMask/maxAngle`, 0 to 10 deg,
  default 2.5), explained in the READMEs.
* **Confirmation by length**: between `maxAngle` and `maxConfirmedAngle` (user setting
  `ClarkeMask/maxConfirmedAngle`, 0 to 15 deg, default 7), a straight trail is masked when its
  length is about one expected length (class `single`, within 10%) with both ends free (not `cut`):
  it moves at the sidereal rate, which confirms a geosynchronous object (inclined orbit). It is
  marked `confirmed by length` in the log and in `trails.csv`. Needs the exposure time
  (`EXPTIME` or `EXPOSURE` keyword); without it, nothing is confirmed and the search stops at
  `maxAngle`.
* Cost: the detection time is multiplied by the number of grids (PJSR runs single-threaded).

### 3.12 One decision per trail (core, `detectAll`)

* The same trail is found on several grids, sometimes as fragments. All versions are sorted by
  **strength** (sum of the segment peaks: longest and most contrasted first); a version lying on
  a stronger one (direction within 2 x `angleStep`, midpoint within its half width plus
  `mergeDistance`, inside its extent plus one segment) is the same trail. The strongest version
  decides for the whole trail: masked, or reported (`angle`); its fragments go with it.
* When the trail is masked, an accepted version that **extends it by more than a quarter segment**
  beyond the strongest version is masked too: a trail whose brightness varies along its path may
  be strongest as its bright part on one grid and longest (with its faint part) on another.
  Versions within the extent of the strongest are ignored (they would only widen the mask).
* **Crossings**: a tilted grid crossing a pack of close parallel trails collects their light and
  produces short false trails at a few degrees. A candidate lying for more than `maxCovered` = 50%
  of its length on stronger trails (within their half width plus 2 px) is dropped.
* A `bent` or `wide` candidate is reported once, unless a trail covers it.

## 4. Parameters at a glance

| Parameter | Value | Unit | Role | Decides / shapes |
|---|---|---|---|---|
| `binning` | 2 | | detection image binning | |
| `theta` | from the astrometric solution | deg | trail direction | decides (direction) |
| `segment` | 64 | samples | cell length along the trail | decides (star rejection, angle tolerance) |
| `minValid` | 0.5 | fraction | valid samples for a cell | |
| `highPass` | 31 | px | perpendicular background window | decides (nebula rejection) |
| `coreK` | 10 | x noise of E | core threshold | decides (contrast) |
| `minSegments` | 3 | segments | minimum trail span | decides (length) |
| `maxGap` | 2 | segments | gap bridged when merging | shapes |
| `mergeDistance` | 3 | px | offset allowed when merging | shapes |
| `maxBend` | 3 | px | straightness | decides |
| `maxCoreWidth` | 15 | px | thinness | decides |
| `edgeSigma` | 1.0 | x sigPix | mask edge across the trail | shapes |
| `endSmooth` | 9 | samples | end profile smoothing | shapes |
| `margin` | 2 | full-res px | added across the trail | shapes |
| `endMargin` | 8 | full-res px | added at each end | shapes |
| `maxAngle` | 2.5 (user setting) | deg | largest angle from `theta` masked | decides (direction) |
| `maxConfirmedAngle` | 7 (user setting) | deg | largest angle masked when the length confirms a geosynchronous object | decides (direction, with length) |
| `angleStep` | 0.75 | deg | step between the fine grids (up to `maxAngle`) | |
| `confirmStep` | 1.5 | deg | step between the coarse grids (beyond `maxAngle`, confirmation only) | |
| `angleRange` | derived from `maxAngle` | deg | tilt of the outermost grids | decides (directions searched) |
| `maxCovered` | 0.5 | fraction | crossing filter | decides (false trails in dense bands) |

## 5. What is not touched

* Pixels outside the masks: every frame keeps contributing there.
* Stars under a mask: excluded only in the frame where the trail crosses them; the integrated star
  comes from the other frames.
* Trails at other angles (aircraft, low and medium orbits): left to the usual rejection.

## 6. Reported, not used as criteria

For each frame the report gives every trail with: centre `d`, length, median width, peak E,
`bend`, number of segments, angle from `theta`; and every rejected candidate with its reason
(`bent`, `wide`, `angle`). `trails.csv` lists them all, one line per trail.

### 6.1 Length diagnostic

* **Expected length** of a geosynchronous trail: the sidereal drift during the exposure,
  15.041"/s x cos(dec) x exposure / pixel scale, divided by cos(angle from the belt) for a tilted
  trail. Exposure from the `EXPTIME` (or `EXPOSURE`) keyword of each frame; scale and declination
  from the astrometric solution of the reference frame. No site information needed.
* **Ratio** of the measured length to the expected one, and a **class**:
  * `single`: within `lengthTolerance` = 10% of the expected length;
  * `overlap`: longer: objects at the same declination whose trails overlap or follow each other
    end to end (collocated satellites; a brightness step along the trail, double where they
    overlap, shows it);
  * `cut`: shorter, with an end at the image edge or at a border without data;
  * `partial`: shorter, both ends free.
* **Why it is not a criterion.** On real data, shorter-than-expected trails with free ends are
  mostly faint trails whose fainter part falls below the threshold (the brightness of a satellite
  varies along its path); near the equinoxes a geostationary satellite can also enter the Earth's
  shadow mid-exposure. Longer-than-expected trails are mostly collocated satellites. Rejecting on
  length would leave real geosynchronous trails unmasked, with no false trail to remove in
  exchange.
* **What it tells, and how it is used**: a trail at about one expected length with free ends
  moves at the sidereal rate, which confirms a geosynchronous object; this is used to mask such
  trails beyond `maxAngle` (section 3.11, confirmation by length). A trail that is clearly
  shorter with free ends and bright enough to be fully detected moves slower (eccentric orbit,
  other kind of object).
* **Mind the case**: the class uses the length of the strongest version of the trail; a length
  confirmation therefore never relies on a fragment.

### 6.2 Other diagnostics

* **Position**: trails of a group gather in a narrow band that drifts slowly during the night.
* **Repetition**: an object fixed in hour angle comes back at about the same `d` in consecutive
  frames.

## 7. Known limits

* **Trails further than `maxAngle` from the belt direction** (more inclined geosynchronous
  objects) are reported, not masked.
* **No astrometric solution**: the group is left untouched (a solution is required by design).
* **Faint trails below the core threshold** are not masked; their wings are, when the trail itself
  is detected.
* **Single direction per field**: on very wide fields, constant-declination lines curve; not
  modelled.
* **Coincidences**: a straight thin structure of another origin, aligned with the belt direction
  by chance and long enough, would be masked (length is reported, not a criterion).

## 8. Candidate criteria

1. **Consistency across frames**: the same object at about the same `d` in neighbouring frames.
