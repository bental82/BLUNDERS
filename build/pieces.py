#!/usr/bin/env python3
"""Write data/pieces.json — the inline SVG for each piece, for every set.

Run from the repo root:
    python3 build/pieces-round.py build/pieces-round.json   # only if that set changed
    python3 build/pieces-fetch.py                          # only to re-pull the external sets
    python3 build/pieces.py

Two sets come out, keyed by name:

  cburnett  the standard Staunton rendering shipped inside python-chess,
            by Cburnett, CC BY-SA 3.0
  round     flat silhouettes with a heavy outline, drawn for this repo by
            build/pieces-round.py
  chessnut, totoy, staunty, tatiana
            fetched and normalised by build/pieces-fetch.py -- see that file
            for provenance and licences

All are normalised to the same four tokens -- #fff and #ececec for the light
piece, #000 and #3c3c3c for the dark one -- which is what lets app.js recolour
any of them by substituting those literals.
"""
import json, os, re
import chess.svg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "pieces.json")

ROUND = os.path.join(ROOT, "build", "pieces-round.json")
EXTERNAL = os.path.join(ROOT, "build", "pieces-external.json")
WRAP = '<svg viewBox="0 0 45 45">%s</svg>'
ID = re.compile(r'\s+id="[^"]*"')


def prep(svg):
    """Store every set as complete <svg> markup, with element ids stripped --
    all 32 pieces live in one document, so ids would duplicate."""
    if not svg.startswith("<svg"):
        svg = WRAP % re.sub(r"\s+", " ", svg).strip()
    return ID.sub("", svg)


out = {
    "cburnett": {k: prep(v) for k, v in chess.svg.PIECES.items()},
    "round": {k: prep(v) for k, v in json.load(open(ROUND, encoding="utf-8")).items()},
}
out.update({n: {k: prep(v) for k, v in s.items()}
            for n, s in json.load(open(EXTERNAL, encoding="utf-8")).items()})
codes = set("prbnqkPRBNQK")
for name, s in out.items():
    assert set(s) == codes, "%s is missing %s" % (name, codes - set(s))
    for k, v in s.items():
        assert "url(#" not in v, "%s %s references an id that would collide" % (name, k)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(out, fh)
print("written %s (%d sets, %d bytes)" % (OUT, len(out), os.path.getsize(OUT)))
