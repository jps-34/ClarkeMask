#!/usr/bin/env python3
"""
Build the PixInsight update repository served from docs/ (GitHub Pages).

  python3 tools/build_repo.py --user <github_user>

Creates, for the current script version (read from the main script):
  docs/ClarkeMask-<version>-PI194.zip   V8 scripts, PixInsight 1.9.4 and later
  docs/updates.xri                      repository index (unsigned)

The archive follows the layout required by PixInsight:
  src/scripts/ClarkeMask/<every .js file of scripts/>  (+ its .xsgn if present next to it)
  src/scripts/ClarkeMask/LICENSE

Order for a signed release:
  1. sign each script with CodeSign (this creates the .xsgn file next to it);
  2. run this script (the .xsgn files are packed, the SHA-1 digest computed);
  3. sign docs/updates.xri with CodeSign (last step: any later change to the
     archive or to updates.xri invalidates the signature);
  4. commit and push.
"""
import argparse, datetime, glob, hashlib, os, re, sys, zipfile
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = "ClarkeMask"
MAIN_SCRIPT = "scripts/ClarkeMask.js"      # carries var VERSION = "x.y.z"

PACKAGE = {
    "suffix": "PI194",
    "version": "1.9.4:1.9.99",
    "title": "ClarkeMask {v} (PixInsight 1.9.4 and later)",
    "desc": "Masks geostationary satellite trails in registered light frames, so that integration "
            "rejects them pixel by pixel. Runs inside WBPP as an event script, right after "
            "registration, or standalone from the Script menu. Never modifies the original or "
            "calibrated frames. Parallel detection with PixInsight 1.9.5 and later. English or "
            "French interface.",
}
NOTICE = "Copyright (c) 2026 Jacques Pouyaud. MIT License. Source: https://github.com/{user}/ClarkeMask"


def script_version(path):
    if not os.path.exists(path):
        sys.exit("Main script not found: " + path)
    m = re.search(r'var VERSION\s*=\s*"([^"]+)"', open(path, encoding="utf-8").read())
    if not m:
        sys.exit("VERSION not found in " + path)
    return m.group(1)


def build_zip(version, outdir):
    scripts = sorted(glob.glob(os.path.join(ROOT, "scripts", "*.js")))
    zname = "%s-%s-%s.zip" % (NAME, version, PACKAGE["suffix"])
    zpath = os.path.join(outdir, zname)
    entries = [(os.path.join(ROOT, "LICENSE"), "src/scripts/%s/LICENSE" % NAME)]
    unsigned = []
    for src in scripts:
        base = os.path.basename(src)
        entries.append((src, "src/scripts/%s/%s" % (NAME, base)))
        sig = os.path.splitext(src)[0] + ".xsgn"
        if os.path.exists(sig):
            entries.append((sig, "src/scripts/%s/%s" % (NAME, os.path.basename(sig))))
        else:
            unsigned.append(base)
    # fixed timestamps: the same sources always give the same archive (and SHA-1)
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f, arc in entries:
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(f, "rb").read())
    sha1 = hashlib.sha1(open(zpath, "rb").read()).hexdigest()
    return zname, sha1, unsigned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", required=True, help="GitHub user name (GitHub Pages host)")
    ap.add_argument("--date", default=datetime.date.today().strftime("%Y%m%d"), help="release date YYYYMMDD")
    a = ap.parse_args()
    server = "https://%s.github.io/%s/" % (a.user, NAME)
    outdir = os.path.join(ROOT, "docs")
    os.makedirs(outdir, exist_ok=True)
    open(os.path.join(outdir, ".nojekyll"), "w").close()
    for f in os.listdir(outdir):                      # drop archives from older releases
        if f.startswith(NAME + "-") and f.endswith(".zip"):
            os.remove(os.path.join(outdir, f))
    v = script_version(os.path.join(ROOT, MAIN_SCRIPT))
    zname, sha1, unsigned = build_zip(v, outdir)
    print("%-34s sha1 %s  %s" % (zname, sha1, "UNSIGNED: " + ", ".join(unsigned) if unsigned else "signed"))
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<xri version="1.0">', '   <description>',
             '      <p>ClarkeMask: geostationary satellite trail masks for WBPP integration.</p>',
             '      <p>Add %s under Resources &gt; Updates &gt; Manage Repositories.</p>' % escape(server),
             '   </description>',
             '   <platform os="all" arch="noarch" version="%s">' % PACKAGE["version"],
             '      <package fileName="%s" sha1="%s" type="script" releaseDate="%s" serverURL="%s">'
             % (zname, sha1, a.date, escape(server)),
             '         <title>%s</title>' % escape(PACKAGE["title"].format(v=v)),
             '         <description>',
             '            <p>%s</p>' % escape(PACKAGE["desc"]),
             '            <p>%s</p>' % escape(NOTICE.format(user=a.user)),
             '         </description>',
             '      </package>',
             '   </platform>',
             '</xri>']
    open(os.path.join(outdir, "updates.xri"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("docs/updates.xri written (unsigned): sign it with CodeSign as the very last step.")


if __name__ == "__main__":
    main()
