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


def prep(svg, name, code):
    """Store every set as complete <svg> markup.

    All 32 pieces end up in one document, so an id that appears in each piece
    would resolve to whichever copy loaded first and paint the whole board
    from it. Ids a piece actually refers to are namespaced per set and piece;
    ids nothing refers to are dropped.
    """
    if not svg.startswith("<svg"):
        svg = WRAP % re.sub(r"\s+", " ", svg).strip()
    refs = sorted(set(re.findall(r"url\(#([^)]+)\)", svg)), key=len, reverse=True)
    tag = "%s-%s-" % (name, code)
    svg = re.sub(r'\s+id="([^"]+)"',
                 lambda m: ' id="%s%s"' % (tag, m.group(1)) if m.group(1) in refs else "",
                 svg)
    for r in refs:
        svg = svg.replace("url(#%s)" % r, "url(#%s%s)" % (tag, r))
    return svg


out = {
    "cburnett": {k: prep(v, "cburnett", k) for k, v in chess.svg.PIECES.items()},
    "round": {k: prep(v, "round", k)
              for k, v in json.load(open(ROUND, encoding="utf-8")).items()},
}
out.update({n: {k: prep(v, n, k) for k, v in s.items()}
            for n, s in json.load(open(EXTERNAL, encoding="utf-8")).items()})

codes = set("prbnqkPRBNQK")
seen = set()
for name, s in out.items():
    assert set(s) == codes, "%s is missing %s" % (name, codes - set(s))
    for k, v in s.items():
        where = "%s %s" % (name, k)
        ids = set(re.findall(r'id="([^"]+)"', v))
        for r in set(re.findall(r"url\(#([^)]+)\)", v)):
            assert r in ids, "%s refers to #%s, which it does not define" % (where, r)
        clash = ids & seen
        assert not clash, "%s reuses id %s" % (where, sorted(clash))
        seen |= ids
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(out, fh)
print("written %s (%d sets, %d bytes)" % (OUT, len(out), os.path.getsize(OUT)))
