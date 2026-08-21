#!/usr/bin/env python3
"""Write data/pieces.json — the inline SVG for each piece.

Run from the repo root:  python3 build/pieces.py

The set is Cburnett's, shipped inside python-chess. Licensed CC BY-SA 3.0.
Only needs re-running if you switch piece sets.
"""
import json, os, re
import chess.svg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "pieces.json")

out = {k: re.sub(r"\s+", " ", v).strip() for k, v in chess.svg.PIECES.items()}
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(out, fh)
print("written %s (%d pieces, %d bytes)" % (OUT, len(out), os.path.getsize(OUT)))
