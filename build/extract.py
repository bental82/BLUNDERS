#!/usr/bin/env python3
"""Turn the Chessable PGN export into data/course.json.

Run from the repo root:  python3 build/extract.py

Needs python-chess:      pip install chess

For every game in the PGN this works out which side the student plays, which
plies are quiz moves and which are played for them, and pulls out the arrows
([%cal]) and circles ([%csl]) plus every alternative line the author tagged.
Legal moves are precomputed per quiz position so the browser needs no engine.
"""
import re, json, os, sys, collections
import chess, chess.pgn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, "source", "Preventing Blunders in Chess.pgn")
OUT  = os.path.join(ROOT, "data", "course.json")

CAL = re.compile(r"\[%cal\s+([^\]]*)\]")
CSL = re.compile(r"\[%csl\s+([^\]]*)\]")
CMD = re.compile(r"\[%\w+\s*[^\]]*\]")
NAGTXT = {1:"!",2:"?",3:"!!",4:"??",5:"!?",6:"?!",10:"=",11:"=",13:"∞",
          14:"⩲",15:"⩱",16:"±",17:"∓",18:"+−",
          19:"−+",22:"⨀",36:"↑"}


def split_cmt(t):
    """Strip PGN command tags out of a comment, returning (text, arrows, circles)."""
    t = t or ""
    cal, csl = [], []
    for m in CAL.finditer(t):
        for a in m.group(1).split(","):
            a = a.strip()
            if len(a) >= 5:
                cal.append(a[0] + a[1:5])
    for m in CSL.finditer(t):
        for a in m.group(1).split(","):
            a = a.strip()
            if len(a) >= 3:
                csl.append(a[0] + a[1:3])
    txt = CMD.sub("", t)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip(), cal, csl


def nagstr(nags):
    return "".join(NAGTXT.get(x, "") for x in sorted(nags) if x in NAGTXT)


def line_of(node, limit=30):
    """Serialise a side line into replayable plies, stopping at the first illegal move."""
    out, cur, k = [], node, 0
    while cur is not None and k < limit:
        b, mv = cur.parent.board(), cur.move
        if mv is None or mv == chess.Move.null():
            break
        try:
            san = b.san(mv)
        except Exception:
            break                     # the source PGN has one malformed branch
        txt, cal, csl = split_cmt(cur.comment)
        d = {"u": mv.uci(), "s": san + nagstr(cur.nags), "f": cur.board().fen()}
        if txt: d["t"] = txt
        if cal: d["cal"] = cal
        if csl: d["csl"] = csl
        out.append(d)
        cur = cur.variations[0] if cur.variations else None
        k += 1
    return out


def main():
    if not os.path.exists(SRC):
        sys.exit("PGN not found: " + SRC)

    games = []
    with open(SRC, encoding="utf-8") as fh:
        while True:
            g = chess.pgn.read_game(fh)
            if g is None:
                break
            games.append(g)

    varid = {}
    for i, g in enumerate(games):
        m = re.search(r"/variation/(\d+)", g.headers.get("SourceTitle", ""))
        if m:
            varid[m.group(1)] = i

    items, problems = [], []
    for gi, g in enumerate(games):
        h = g.headers
        chap, title = h.get("White", "?"), h.get("Black", "?")
        fen = h.get("FEN")
        intro, ical, icsl = split_cmt(g.comment)
        main_line = list(g.mainline())
        real = [n for n in main_line if n.move and n.move != chess.Move.null()]

        # text-only lesson: no board, prose lives in the game or null-move comments
        if not fen or not real:
            parts = [intro] + [split_cmt(n.comment)[0] for n in main_line]
            items.append({"id": gi, "chap": chap, "title": title, "kind": "lesson",
                          "text": "\n\n".join(p for p in parts if p)})
            continue

        board = g.board()

        # Which side does the student play? The author annotates the student's
        # moves: alternatives hang off them, and "!" marks them. Score both
        # parities and take the winner; with no signal at all (the "N moves in
        # a row" drills) the student moves first.
        score = {0: 0, 1: 0}
        for i, n in enumerate(main_line):
            p = i % 2
            if len(n.parent.variations) > 1:
                score[p] += 3
            if n.nags & {1, 3}:
                score[p] += 2
        par = 0 if score[0] >= score[1] else 1
        fturn = "w" if board.turn else "b"
        player = fturn if par == 0 else ("b" if fturn == "w" else "w")

        plies, ok = [], True
        for i, n in enumerate(main_line):
            b, mv = n.parent.board(), n.move
            isnull = mv is None or mv == chess.Move.null()
            try:
                san = "--" if isnull else b.san(mv)
            except Exception as e:
                problems.append((title, "illegal main line", str(e)))
                ok = False
                break
            txt, cal, csl = split_cmt(n.comment)
            pre, pcal, pcsl = split_cmt(n.starting_comment)
            quiz = (i % 2 == par) and not isnull
            d = {"u": "0000" if isnull else mv.uci(), "s": san + nagstr(n.nags),
                 "f": b.fen(), "side": "w" if b.turn else "b"}
            if quiz:
                d["q"] = 1
                d["legal"] = " ".join(m.uci() for m in b.legal_moves)
            if pre:  d["pre"] = pre
            if txt:  d["t"] = txt
            if cal:  d["cal"] = cal
            if csl:  d["csl"] = csl
            if pcal: d["precal"] = pcal
            if pcsl: d["precsl"] = pcsl
            if i == len(main_line) - 1:
                d["fa"] = n.board().fen()
            alts = []
            for sib in n.parent.variations[1:]:
                ln = line_of(sib)
                if not ln:
                    problems.append((title, "dropped an unplayable side line", sib.san() if sib.move else "?"))
                    continue
                a = {"u": ln[0]["u"], "s": ln[0]["s"], "line": ln}
                if sib.nags & {2, 4, 6}:
                    a["bad"] = 1
                alts.append(a)
            if alts:
                d["alts"] = alts
            plies.append(d)

        if not ok:
            items.append({"id": gi, "chap": chap, "title": title,
                          "kind": "lesson", "text": intro})
            continue

        it = {"id": gi, "chap": chap, "title": title, "kind": "pos",
              "fen": fen, "player": player, "plies": plies}
        if intro: it["intro"] = intro
        if ical:  it["introcal"] = ical
        if icsl:  it["introcsl"] = icsl
        items.append(it)

    # cross-references between lessons become {{itemId}} for the client to link
    def fixlinks(s):
        return re.sub(r"\[/variation/(\d+)\]",
                      lambda m: "{{" + str(varid.get(m.group(1), -1)) + "}}", s)

    def walk(o):
        if isinstance(o, dict):
            return {k: (fixlinks(v) if isinstance(v, str) and k in ("t", "pre", "intro", "text")
                        else walk(v)) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(x) for x in o]
        return o

    items = [walk(i) for i in items]

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(items, fh, ensure_ascii=False, separators=(",", ":"))

    kinds = collections.Counter(i["kind"] for i in items)
    quiz = sum(1 for i in items if i["kind"] == "pos" for p in i["plies"] if p.get("q"))
    print("items      %d  %s" % (len(items), dict(kinds)))
    print("quiz moves %d" % quiz)
    print("written    %s (%.1f MB)" % (OUT, os.path.getsize(OUT) / 1048576))
    for p in problems:
        print("note: %s" % (" | ".join(p),))


if __name__ == "__main__":
    main()
