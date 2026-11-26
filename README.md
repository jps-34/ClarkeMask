# ClarkeMask

**<ins>Version 0.3.0 changes the method of the masking in WBPP, and where it is selected. It no
longer uses an Event Script: in WBPP, *Pipeline* tab, untick *Event Script* and select
`ClarkeMask-PipelineBuilder.js` under *Pipeline builder* instead. WBPP's own files are no longer
modified.</ins>**

**PixInsight script: masks geostationary satellite trails in each light frame, so that WBPP
integration rejects them pixel by pixel.**

*Version française : [README.fr.md](README.fr.md)*

Targets close to the geostationary belt (the Clarke belt) collect satellite trails in most
sub-frames. The sky drifts parallel to the belt, so the target stays on it all night; the trails
are parallel, packed in a narrow band, often faint. Pixel rejection at integration is not designed
for that case: discarding the frames would discard most of the session.

ClarkeMask repairs instead of discarding: it finds every trail in each registered frame and masks
only the pixels it covers. At integration each pixel is then stacked from the frames that are
clean at that place, so the number of values varies from pixel to pixel.

## How it works

* **Inside WBPP**: a pipeline builder adds a masking step right after registration, before local
  normalization and integration. Masked copies of the frames, with 0 under the masks, are handed to
  the rest of WBPP's pipeline, whose integration already rejects 0 for light frames. WBPP's own files
  are not modified.
* **Detection**: the trail direction comes from the frame's astrometric solution (constant
  declination); each trail is followed segment by segment, its width taken from its own profile.
  Criteria and parameters: [DETECTOR.md](DETECTOR.md). Requires an astrometric solution (plate
  solving at acquisition, or ImageSolver on the reference frame). A mirrored solution ("flipped",
  as seen with some WCS written at acquisition and converted by PixInsight before 1.9.6) is detected from the trails themselves and corrected.
* **One mask file per frame**, kept in a `ClarkeMask` folder of the WBPP output for checking.
* Mono and colour (OSC) frames alike.
* **Cost of the masks**: masking loses exposure, not signal. A score line gives the worst case
  (frames lost, exposure and SNR kept, share of the field) and the mean SNR kept, with a table per
  number of frames lost and a map of the exposure kept.
* No AI, no change to the original or calibrated frames.

## Setting: maximum angle from the belt

A strictly geostationary satellite draws its trail exactly along the east-west direction of the
sky (constant declination). Inclined geosynchronous satellites, older ones especially, drift
slowly in declination and draw trails tilted by a few degrees. **Maximum angle** sets how far
from the belt direction a trail is still masked; straight trails further out are only reported.

* **2.5 deg (default)**: geostationary and slightly inclined objects.
* Larger values also mask more inclined objects, but the detection takes longer (it is repeated
  on more tilted directions), and other kinds of objects become more likely at large angles.
* 0: belt direction only.

**Beyond it, confirmation by length** (`ClarkeMask/maxConfirmedAngle`, default 7 deg): a
geosynchronous object moves at the sidereal rate, so its trail has a known length (sidereal drift
during the exposure). Between the maximum angle and this second limit, a straight trail is masked
when its length matches, with both ends inside the image; otherwise it is only reported. Larger
values search more tilted directions and take longer. Needs the exposure time in the headers.

Both values are set in the dialog, saved in the PixInsight settings and used by the WBPP pipeline
builder.

## Setting: detection threads

The frames of a group are detected in parallel, one per thread;
masking and saving stay in order, and the results are the same as in series. **Auto** (default)
uses as many threads as the processors allowed in the PixInsight preferences, limited by the
available memory (each thread holds one frame); **1** detects in series. Set in the dialog, used by
the WBPP pipeline builder.

## Requirements

* PixInsight 1.9.6 or later (the builder is tested with WBPP 3.2.0).
* Registered light frames (mono or colour) with an **astrometric solution**: a WCS written by the
  acquisition software, or the reference frame solved with ImageSolver before WBPP. Frames
  registered by WBPP carry the solution of the reference frame. The plate solving option of WBPP
  does not help here: it only solves the masters, after integration.
* For the confirmation by length: the exposure time in the headers (`EXPTIME` or `EXPOSURE`).

## Installation

1. *Resources > Updates > Manage Repositories*, add `https://jps-34.github.io/ClarkeMask/`
2. *Check for Updates*, restart PixInsight. The repository and the script are signed with my
   Certified PixInsight Developer identity, `jps-34`. If PixInsight reports an **unknown code signing
   identity**, install the PixInsight update first (*Check for Updates*, restart), then check for
   updates again.
3. *Script > JPS > ClarkeMask* (*Script > Utilities* up to 0.2.3). The WBPP pipeline builder `ClarkeMask-PipelineBuilder.js` is
   installed in the same folder; its path is shown at the bottom of the dialog.

Or download the `scripts/` folder and run `ClarkeMask.js` with *Script > Execute Script File*
(`ClarkeMask.js`, its signature `ClarkeMask.xsgn`, `ClarkeMaskCore.js` and `ClarkeMaskEngine.js` must stay together;
`ClarkeMask-PipelineBuilder.js` needs nothing else).

## Usage

**With WBPP** (masked copies of the registered frames, used by WBPP's local normalization,
integration and drizzle):

1. Run *Script > JPS > ClarkeMask* once to check the settings; the dialog shows the path of
   the pipeline builder.
2. In WBPP, *Pipeline > Pipeline builder*: enable it and select `ClarkeMask-PipelineBuilder.js`
   from the ClarkeMask folder. The Pipeline panel then shows a *ClarkeMask masking* step after each
   registration. Leave *Event Script* unticked.
3. Run WBPP as usual. Masks, coverage map, reports and the log are in `<WBPP output>/ClarkeMask/`.

A masked copy of each frame with trails is written to `<WBPP output>/ClarkeMask/copies/`, with its
own drizzle data, and the next steps of WBPP use it; WBPP's registered frames are not modified. A
last step removes the image copies; their `.xdrz` and `.xnml` files stay. **Disk space:** during the
run, one full copy per masked frame. Geostationary trails often cross every frame: then allow as
much free space as the registered frames take.

**Safety checks.** Besides the documented interface of WBPP's pipeline builder, the builder relies
on parts of WBPP that may change in a future version: it checks them before queuing anything, and
the frames before handing them the copies. If something is not as expected, if a group has no
astrometric solution, or if a frame cannot be processed, it stops the run with a message in the
console, rather than letting WBPP integrate unmasked frames. Its log names the version of WBPP; a
version other than the tested one is reported. On a second run with the same frames, registration
comes from WBPP's cache, while local normalization is computed again.

**Standalone** (*Script > JPS > ClarkeMask*), on registered frames; the inputs are never
modified:

1. **Add frames...** (registered frames with an astrometric solution) and choose an output folder.
2. **Preview**: masks, report and cost of the masks, nothing else is written.
3. **Show frame with its mask** (or double-click a frame): the frame opens with its mask as an
   overlay; **Show coverage map** opens the fraction of the exposure kept per pixel.
4. **Apply**: masked copies `<frame>_cm.xisf` in the output folder, with 0 under the masks
   (PixInsight) or NaN (other stackers).

To view the result of a WBPP run, choose `<WBPP output>/ClarkeMask/groupNN` as the output folder
and add the corresponding registered frames.

## Acknowledgements

Thanks to [nico1038](https://telescopius.com/profile/nico1038) for testing ClarkeMask on real data
and for the precise report behind version 0.2.1: reference frames whose astrometric solution
PixInsight converts as mirrored ("flipped") after a meridian flip.

## License

Copyright (c) 2026 Jacques Pouyaud. Released under the
[GNU General Public License, version 3 or later](LICENSE) (GPL-3.0-or-later): you may use, study,
share and modify it; any distributed work that includes this code must be released under the same
licence, with its source code. Versions up to 0.2.1 were released under the MIT License, which
still applies to copies of those versions.

**Credit request.** If you reuse the method or the code of ClarkeMask, in a script, an application
or a tutorial, please credit it by name with a link to this repository. This is a request, not a
licence condition; when the code itself is reused, the GPL already requires keeping the copyright
notice.

Bug reports and suggestions welcome as GitHub issues.

*Code written by Claude (Anthropic), under the direction of Jacques Pouyaud.*
