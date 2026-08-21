#!/usr/bin/env python3
"""Fetch the extra piece sets and normalise them for this app.

    python3 build/pieces-fetch.py            # writes build/pieces-external.json

Sets come from lichess (lichess-org/lila, public/piece/<name>/), whose
COPYING.md documents a licence for every one. Only sets that are structurally
safe to inline are taken: no <style> blocks, and no colour that cannot be
reduced to the four tokens below. Element ids are allowed -- build/pieces.py
namespaces them per piece, since all 32 share one document -- but a set whose
ids are not self-contained is rejected there.

  chessnut  Alexis Luengas          Apache 2.0
  totoy     Kosal Sen               CC BY 4.0
  merida    Armando Hernandez Marroquin  GPLv2+
  staunty   sadsnake1               CC BY-NC-SA 4.0
  tatiana   sadsnake1               CC BY-NC-SA 4.0

The two CC BY-NC-SA sets are free for non-commercial use, which is what this
private trainer is; the other two carry no such restriction. Attribution for
all four is in the README.

Every set draws with its own palette, so each colour is mapped by luminance
onto the four tokens app.js recolours: #ffffff and #ececec for the light
piece, #000000 and #3c3c3c for the dark one.
"""
import json, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "pieces-external.json")
BASE = "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/"
SETS = ["chessnut", "totoy", "staunty", "tatiana", "merida"]
CODES = {"P": "wP", "N": "wN", "B": "wB", "R": "wR", "Q": "wQ", "K": "wK",
         "p": "bP", "n": "bN", "b": "bB", "r": "bR", "q": "bQ", "k": "bK"}

LIGHT, LIGHT2, DARK, DARK2 = "#ffffff", "#ececec", "#000000", "#3c3c3c"
HEX = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")


def full(h):
    h = h.lstrip("#")
    return "#" + ("".join(c * 2 for c in h) if len(h) == 3 else h).lower()


def lum(h):
    h = full(h).lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def palette(colours):
    """Map a set's own colours onto the four tokens app.js knows how to recolour."""
    if len(colours) <= 2:                       # a plain two-tone set: no shading to keep
        order = sorted(colours, key=lum)
        return {order[0]: DARK, order[-1]: LIGHT} if len(order) == 2 else {order[0]: DARK}
    out = {}
    for c in colours:
        L = lum(c)
        out[c] = (LIGHT if L >= 235 else LIGHT2) if L >= 128 else (DARK if L < 45 else DARK2)
    return out


def clean(svg):
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!DOCTYPE[^>]*>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r'\s(width|height)="[^"]*"', "", svg, count=2)   # CSS sizes it
    return re.sub(r"\s+", " ", svg).strip()


def fetch(name, code):
    with urllib.request.urlopen(BASE + name + "/" + CODES[code] + ".svg", timeout=60) as r:
        return clean(r.read().decode("utf-8"))


out = {}
for name in SETS:
    raw = {c: fetch(name, c) for c in CODES}
    colours = {full(m.group(0)) for s in raw.values() for m in HEX.finditer(s)}
    assert colours, name + " has no colours to map"
    pal = palette(colours)
    pieces = {}
    for c, s in raw.items():
        s = HEX.sub(lambda m: pal[full(m.group(0))], s)
        # a shape with no fill of its own paints black; make that explicit so it recolours
        if not re.match(r"<svg[^>]*\sfill=", s):
            s = s.replace("<svg", '<svg fill="' + DARK + '"', 1)
        assert "<style" not in s, name + " " + c + " carries a <style> block"
        pieces[c] = s
    out[name] = pieces
    print("%-9s %2d pieces, %d colours -> %s" % (
        name, len(pieces), len(colours), sorted(set(pal.values()))))

json.dump(out, open(OUT, "w", encoding="utf-8"))
print("written %s (%d bytes)" % (OUT, os.path.getsize(OUT)))
