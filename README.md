# CLAMP Trainer

A move trainer for CM Can Kabadayı's Chessable course *Preventing Blunders in Chess*,
built from the course's PGN export. Chessable's Move Trainer is built around spaced
repetition for opening repertoires; this course isn't a repertoire — it's a board-vision
course, where the arrows the author drew and the clock you're under *are* the lesson.

348 items, 835 quiz moves, in the author's order, lessons in place.

**What it does that a PGN viewer doesn't**

- Draws the author's 426 `[%cal]` arrows and 394 `[%csl]` circles — hidden while you're
  being asked, shown the moment you answer, so they explain rather than give away.
- Plays the opponent's last move to you, animated, before the clock starts. For a
  blunder-check course, *what just changed* is the question.
- Can put you on a clock — **off by default**, because the course asks for 10–15 minutes a
  puzzle and names Puzzle Rush as what it isn't. When on, it's held while there's setup text
  to read, and running out is never counted against you.
- Never hands you the move: a wrong answer or a timeout says so and stops. You have to
  ask to be shown.
- Plays out the traps. Answer with a move the author tagged `??` and the refutation
  plays on the board with his commentary. Click any move chip to take over and step it
  yourself, and **Try again** puts you back on the position without showing the answer —
  seeing why your move loses isn't the same as being told the right one.
- Syncs across your devices, with no login.

## Running it

**Served** — `index.html` fetches the JSON at runtime, so it needs a server. This is what
deploys.

```sh
python3 -m http.server 8000
```

**Offline** — `dist/clamp-trainer.html` has everything inlined; open it from disk. Only
Google Fonts stays remote.

## Deploying

A static site with `index.html` at the root, so Vercel needs no build step: framework
preset **Other**, no build command, no output directory. `vercel.json` sets cache headers
and `X-Robots-Tag: noindex`.

**Keep it private.** The JSON holds the full text of a paid course, and the Supabase
publishable key is embedded in the client (and in `dist/clamp-trainer.html`, so that file
is yours alone now). Turn on Vercel Deployment Protection and keep the repo private.

## The quiz loop

| you | it |
|---|---|
| still reading the setup | clock held (if on), board locked, **Start** on <kbd>↵</kbd> |
| answer correctly | the author's arrows and commentary land as the explanation |
| answer wrong | *That is not it.* — position back, move withheld, recorded as missed |
| run out of time | *Out of time.* — same, but **not recorded**; the clock is this app's, not the course's |
| play a move tagged `??` | the refutation plays out — step it with the move chips, then **Show the right move** or **Try again** |
| press **Show me** / <kbd>R</kbd> | the move, arrows, commentary, side lines |

The clock is only held where there's something to read, and only once per move — a retry
puts you straight back on it. Options run from 30s to 15m; the author's own guidance is
*"give yourself a maximum of 10–15 minutes per puzzle"*, so anything shorter is a drill you
chose, not the course speaking.

## Progress

Kept per quiz move as `clean` / `hint` / `missed`, plus which lessons you've read, your
cursor and your settings. Counted per **quiz move**, not per exercise — 835 is the
denominator, and a hint counts as missed.

The start card shows four numbers, of which two are easily confused:

| | |
|---|---|
| **accuracy** | clean ÷ attempted — how often you were right |
| **covered** | attempted ÷ 835 — how much of the course you've seen |

**Turning a red exercise green.** A move stays red until you answer it clean on a **later
local day**, at least **six hours** after the miss; miss it again and it's red again.
Getting it right ninety seconds after being shown proves recall of the last ninety
seconds, and the six hours rule out a miss at 23:58 cleared at 00:03. Hints clear the
same way.

That's why progress is stored as *attempts* rather than verdicts:

```
att["12:4"] = [[2, 1773…], [0, 1773…]]     // [outcome, ms]; 0 clean, 1 hint, 2 missed
```

One entry per ask, last eight kept, colour derived from the list. An append-only log is
also what keeps the sync merge sound — a verdict that can improve can't be merged with
worst-of.

## Cross-device sync

Progress syncs through Supabase. No login: one row, one user, and the publishable key in
the client is the credential.

Run [`db/schema.sql`](db/schema.sql) in the Supabase SQL editor once. The project URL and
key are already in `app.js` under `var SYNC`; set `window.SYNC` before `startTrainer()` to
point elsewhere.

A dot in the top bar shows the state — dim off, pulsing syncing, green current, red
failed; hover it for when it last succeeded. Failure isn't lossy and isn't final: it
retries on its own with a backoff, so a device that fails its last push doesn't sit on
unsynced work until you next answer something. A device left open re-syncs every 45s, and
on `pagehide` / `pageshow` / `visibilitychange` — iOS fires `pagehide` reliably and
`beforeunload` barely at all.

**Progress merges, it doesn't overwrite.** Both devices can be ahead and neither loses
work:

| | rule |
|---|---|
| quiz attempts | union by timestamp; same attempt on both sides keeps the worse outcome |
| lessons read | union |
| cursor, settings | whichever device wrote last |

A wipe can't be expressed as a merge, so *Reset progress* bumps a generation counter that
beats the merge and carries the wipe to every device.

About 45 KB fully worked through — one row, well inside the free tier.

**Only attempts are written.** An earlier version also pushed a derived `res` map of plain
colours so a device on the previous build wouldn't see a blank slate. That was a mistake:
such a device reads it and pushes back a payload carrying `res` and *no* `att`, and since
the write is a whole-row upsert, that erased the attempt log for every device — the next
current device then rebuilt `att` from `res` with every timestamp at 0. The mirror is
gone, so a row can no longer be flattened.

## Appearance

Three independent rows in Settings, in any combination:

| | |
|---|---|
| **Board** | Slate, Walnut, Forest, Ocean, Lavender |
| **Piece set** | classic, staunty, tatiana, chessnut, totoy, riohacha, round |
| **Piece colour** | Black and white, Warm, Indigo |

Slate + classic + black-and-white is the original look and stays the default.

Squares and coordinates are CSS variables and repaint for free. Pieces can't be: the
artwork carries colours as presentation attributes *and* inline styles, and inline styles
beat any stylesheet rule. So every set is normalised at build time onto four tokens —
`#fff` / `#ececec` light, `#000` / `#3c3c3c` dark — and `svgFor()` substitutes those as a
piece is drawn. One substitution recolours all seven sets.

All 32 pieces share one document, so `pieces.py` namespaces element ids per piece and
drops unreferenced ones; a set whose `url(#…)` doesn't resolve within its own piece is
rejected. Without that, one gradient id would paint the whole board.

## Rebuilding

Only needed if you replace `source/Preventing Blunders in Chess.pgn`:

```sh
pip install chess
python3 build/pieces.py      # data/pieces.json — piece SVGs, rarely changes
python3 build/extract.py     # data/course.json — the course itself
python3 build/bundle.py      # dist/clamp-trainer.html
```

Piece sources only need regenerating if you change a set:

```sh
python3 build/pieces-round.py build/pieces-round.json   # redraw the local set
python3 build/pieces-fetch.py                           # re-pull the lichess sets
```

`build/extract.py` is where the real work happens: for each game it works out which side
the student plays (the author annotates the student's moves, so scoring both parities
picks it out), splits plies into quiz moves and moves played for you, pulls the arrows and
circles out of the comments, keeps every tagged alternative with its refutation, and
precomputes the legal moves so the browser needs no chess engine.

## Layout

```
index.html            served entry point
app.js                the whole app; defines startTrainer()
style.css
data/course.json      348 items, generated
data/pieces.json      seven piece sets, generated
db/schema.sql         the Supabase table
build/extract.py      PGN  -> data/course.json
build/pieces.py       merges every piece set -> data/pieces.json
build/pieces-round.py the local piece set, drawn in code
build/pieces-fetch.py fetches and normalises the lichess sets
build/bundle.py       all  -> dist/clamp-trainer.html
build/body.html       markup shared by both builds (edit index.html, not this)
build/verify*.mjs     see below
source/*.pgn          the Chessable export
dist/                 the offline single-file build
```

`app.js` wraps everything in `startTrainer()`, called once `window.DATA` and
`window.PIECES` exist — the only difference between the two builds. `window.__CT` exposes
the state machine and board for debugging.

## Verification

Four suites, all needing `npm i playwright` and a server on :8000.

| | covers |
|---|---|
| `verify.mjs` | walks all 328 positions and plays all 835 answers, checking board vs FEN, side to move, orientation, legality, every lesson and side line |
| `verify-flow.mjs` | the clock gate, and that a miss withholds the move until asked |
| `verify-redeem.mjs` | the day-and-six-hours rule, the midnight loophole, one-ask-one-attempt, merge convergence, migration |
| `verify-theme.mjs` | the default is unchanged, every set draws differently and takes ink, and nothing bleeds over the board's edges |
| `verify-sync.mjs` | two browsers against a mock Supabase: both merge directions, reset, dead endpoint, `file://` build. Needs no network |

```sh
node build/verify.mjs http://localhost:8000/
node build/verify.mjs file://$PWD/dist/clamp-trainer.html
node build/verify-flow.mjs http://localhost:8000/
node build/verify-redeem.mjs http://localhost:8000/
node build/verify-theme.mjs http://localhost:8000/ /tmp/shots   # dir optional: writes PNGs
node build/verify-sync.mjs
```

## Known issue in the source PGN

`Level 3: Puzzle 75` has a broken side line — a duplicate `2.Nxe4` branch that continues
as if `2.Rd1` had been played, making `Nxc3` illegal. It's wrong in Chessable's own
export. `extract.py` drops that branch (and prints a note) and keeps the rest.

## Credits

Course content © CM Can Kabadayı, *Preventing Blunders in Chess* (Chessable).

| piece set | by | licence |
|---|---|---|
| classic | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), via python-chess | CC BY-SA 3.0 |
| chessnut | [Alexis Luengas](https://github.com/LexLuengas/chessnut-pieces) | Apache 2.0 |
| totoy | Kosal Sen | CC BY 4.0 |
| riohacha | *unrecorded* | *unrecorded* |
| staunty | sadsnake1 | CC BY-NC-SA 4.0 |
| tatiana | sadsnake1 | CC BY-NC-SA 4.0 |
| round | drawn for this repo (`build/pieces-round.py`) | — |

The fetched sets come from [lichess](https://github.com/lichess-org/lila/tree/master/public/piece),
whose `COPYING.md` is the source for the attributions above. `staunty` and `tatiana` are
non-commercial-only, which this private trainer is; `chessnut` and `totoy` carry no such
restriction. **`riohacha` is listed by lichess with the author and licence columns both
empty**, so unlike the rest it carries no stated terms at all — it is here by request, and
a private trainer is the only use it should get. Board colours were chosen for this repo.
