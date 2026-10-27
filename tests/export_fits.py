#!/usr/bin/env python3
"""
Export one FITS frame for the node test of the numeric core.

  python3 -I tests/export_fits.py <frame.fits> <output_prefix>

Writes <output_prefix>.bin (float32, row-major, first channel, numpy row
order) and <output_prefix>.json ({w, h, theta}). theta is the normal angle of
the constant-declination direction, from the CD matrix (needs a celestial WCS).
Keep the outputs outside the repository: they are image data.
"""
import json, math, sys
import numpy as np
from astropy.io import fits

src, prefix = sys.argv[1], sys.argv[2]
with fits.open(src) as f:
    hdu = next(h for h in f if h.data is not None)
    data = np.asarray(hdu.data, dtype=np.float32)
    hdr = hdu.header
if data.ndim == 3:
    data = data[0]
h, w = data.shape
cd = np.array([[hdr["CD1_1"], hdr["CD1_2"]], [hdr["CD2_1"], hdr["CD2_2"]]])
t = np.linalg.solve(cd, [1.0, 0.0])            # pixel direction of increasing RA
theta = (math.degrees(math.atan2(t[1], t[0])) - 90) % 180
data.tofile(prefix + ".bin")
json.dump({"w": w, "h": h, "theta": theta}, open(prefix + ".json", "w"))
print("%s: %d x %d, theta %.3f" % (prefix, w, h, theta))
