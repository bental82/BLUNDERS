#!/usr/bin/env python3
"""Inline everything into dist/clamp-trainer.html — one file, no server.

Run from the repo root:  python3 build/bundle.py

index.html fetches the JSON at runtime, so it needs to be served over HTTP.
This produces the same app as a single file you can open from disk, mail to
yourself, or keep on a phone. Only Google Fonts stays remote; without a
connection the page falls back to system faces and still works.
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist", "clamp-trainer.html")


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as fh:
        return fh.read()


html = read("index.html")
css = read("style.css")
js = read("app.js")
course = read("data", "course.json")
pieces = read("data", "pieces.json")

# swap the stylesheet link for the stylesheet itself
html = html.replace('<link rel="stylesheet" href="./style.css">',
                    "<style>\n" + css + "\n</style>")

# swap the script tag and the fetch bootstrap for inline data + a direct call
inlined = ("<script>\nvar PIECES=" + pieces + ";\nvar DATA=" + course + ";\n</script>\n"
           "<script>\n" + js + "\nstartTrainer();\n</script>")
html, n = re.subn(r'<script src="\./app\.js"></script>.*?</script>',
                  lambda m: inlined, html, count=1, flags=re.S)
if n != 1:
    raise SystemExit("could not find the bootstrap scripts in index.html")

html = html.replace('<div id="boot">Loading the course&hellip;</div>', "")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(html)
print("written %s (%.2f MB)" % (OUT, os.path.getsize(OUT) / 1048576))
