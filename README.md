# ClarkeMask

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

* **Inside WBPP**: an event script runs right after registration, before local normalization and
  integration. Masked pixels are set to 0, which WBPP integration already rejects for light frames.
* **Detection**: the trail direction comes from the frame's astrometric solution (constant
  declination); each trail is followed segment by segment, its width taken from its own profile.
  Criteria and parameters: [DETECTOR.md](DETECTOR.md). Requires an astrometric solution (plate
  solving at acquisition, or ImageSolver on the reference frame). A mirrored solution ("flipped",
  as seen with some WCS written at acquisition) is detected from the trails themselves and corrected.
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

Both values are set in the dialog, saved in the PixInsight settings and used by the WBPP event
script.

## Setting: detection threads

The frames of a group are detected in parallel, one per thread;
masking and saving stay in order, and the results are the same as in series. **Auto** (default)
uses as many threads as the processors allowed in the PixInsight preferences, limited by the
available memory (each thread holds one frame); **1** detects in series. Set in the dialog, used by
the WBPP event script.

## Requirements

* PixInsight 1.9.5 or later.
* Registered light frames (mono or colour) with an **astrometric solution**: a WCS written by the
  acquisition software, or the reference frame solved with ImageSolver before WBPP. Frames
  registered by WBPP carry the solution of the reference frame. The plate solving option of WBPP
  does not help here: it only solves the masters, after integration.
* For the confirmation by length: the exposure time in the headers (`EXPTIME` or `EXPOSURE`).

## Installation

1. *Resources > Updates > Manage Repositories*, add `https://jps-34.github.io/ClarkeMask/`
2. *Check for Updates*, restart PixInsight (enable *Allow unsigned update repositories* until the
   repository is signed).
3. *Script > JPS > ClarkeMask* (*Script > Utilities* up to 0.2.3). The WBPP event script `ClarkeMask-WBPP.js` is installed in
   the same folder; its path is shown at the bottom of the dialog.

Or download the `scripts/` folder and run `ClarkeMask.js` with *Script > Execute Script File*
(the four files must stay together).

## Usage

**With WBPP** (masking in place of the registered frames, before local normalization and
integration):

1. Run *Script > JPS > ClarkeMask* once to check the settings; the dialog shows the path of
   the event script.
2. In WBPP, *Pipeline > Event Script*: enable it and select `ClarkeMask-WBPP.js` from the
   ClarkeMask folder.
3. Run WBPP as usual. Masks, coverage map and reports are in `<WBPP output>/ClarkeMask/`.

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
