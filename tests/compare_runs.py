#!/usr/bin/env python3
"""
Compares two runs of tests/run_group_pi.js (for instance serial and threaded).

  python3 -I tests/compare_runs.py <run_a> <run_b>

Checks that trails.csv and coverage.csv are identical, that ClarkeMask.csv is
identical except for the timing column, and that every <frame>_mask.xisf has
the same pixel data (compared byte by byte; uncompressed or zlib, with or
without byte shuffling). Exit code 1 on any difference. Needs numpy.
"""
import os
import re
import sys
import zlib

import numpy as np


def mask_pixels(path):
    with open(path, "rb") as f:
        head = f.read(16)
        xml = f.read(int.from_bytes(head[8:12], "little")).decode("utf-8")
        img = re.search(r"<Image\b[^>]*>", xml).group(0)
        attr = dict(re.findall(r'(\w+)="([^"]*)"', img))
        pos, size = (int(v) for v in attr["location"].split(":")[1:3])
        f.seek(pos)
        raw = f.read(size)
    comp = attr.get("compression")
    if comp:
        codec, _, *rest = comp.split(":")
        if not codec.startswith("zlib"):
            raise SystemExit("unsupported compression " + codec)
        raw = zlib.decompress(raw)
        if codec.endswith("+sh") and rest and int(rest[0]) > 1:
            item = int(rest[0])
            n = len(raw) // item
            raw = np.frombuffer(raw, np.uint8, n * item).reshape(item, n).T.tobytes() + raw[n * item:]
    return np.frombuffer(raw, dtype=np.uint8)


def table(path, drop=None):
    rows = [line.split(",") for line in open(path).read().splitlines()]
    if drop is not None:
        col = rows[0].index(drop)
        rows = [r[:col] + r[col + 1:] for r in rows]
    return rows


a, b = sys.argv[1], sys.argv[2]
bad = 0
for name, drop in (("trails.csv", None), ("coverage.csv", None), ("ClarkeMask.csv", "seconds")):
    same = table(os.path.join(a, name), drop) == table(os.path.join(b, name), drop)
    bad += not same
    print("%-15s %s" % (name, "same" if same else "DIFFERENT"))
masks = sorted(f for f in os.listdir(a) if f.endswith("_mask.xisf"))
if masks != sorted(f for f in os.listdir(b) if f.endswith("_mask.xisf")):
    bad += 1
    print("mask files      DIFFERENT lists")
diff = sum(int(np.count_nonzero(mask_pixels(os.path.join(a, m)) != mask_pixels(os.path.join(b, m)))) for m in masks
           if os.path.exists(os.path.join(b, m)))
bad += diff > 0
print("masks           %d files, %d pixels differ" % (len(masks), diff))
sys.exit(1 if bad else 0)
