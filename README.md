# CLAMP Trainer

A move trainer for CM Can Kabadayı's Chessable course *Preventing Blunders in Chess*,
built from the course's PGN export. It exists because Chessable's Move Trainer is built
around spaced repetition for opening repertoires, and this course is not a repertoire —
it's a board-vision course, where the arrows the author drew and the clock you're under
*are* the lesson.

**What it does that a generic PGN viewer doesn't:**

- **Draws the author's arrows and circles.** The PGN carries 426 `[%cal]` arrows and
  394 `[%csl]` circles. They stay hidden while you're being asked and appear the moment
  you answer or fail, so the sniper arrow lands as an explanation rather than a giveaway.
- **Plays the opponent's last move to you**, animated and highlighted, before the clock
  starts. For a blunder-check course, *what just changed* is the question.
- **Puts you on a clock, but not while you're reading.** 20s per position, 15s for later
  moves in a line, configurable. Where the author set the position up in prose, the clock
  is loaded and held until you say go, so you're never timed on reading. Running out
  counts as a miss.
- **Never hands you the move.** Answer wrong or run out of time and it says so and puts
  the position back — the move stays hidden until you ask for it. Guessing is not a way
  to be told.
- **Plays out the traps.** Play a move the author tagged `??` and the refutation plays
  on the board move by move with his commentary. Every side line stays explorable
  afterwards as clickable move chips.
- **Quiz cold, teach when you ask, then re-ask** the same position before moving on.
- **Looks the way you want.** Five board colours, six piece sets and three piece inks in
  Settings, in any combination. The default is the original slate and the standard
  black-and-white Cburnett set.

348 items, 835 quiz moves, in the author's order, lessons in place.

---

## Running it

Two builds come out of the same source.

**Served** — `index.html` links `style.css` and `app.js` and fetches the JSON at runtime.
This is what deploys. It needs a server; opening `index.html` off disk will fail the
fetch (the page says so).

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

**Offline** — `dist/clamp-trainer.html` has everything inlined. Open it from disk, mail
it to yourself, keep it on a phone. Only Google Fonts stays remote; without a connection
it falls back to system faces and still works.

## Deploying

It's a static site with `index.html` at the root, so Vercel needs no build step:

- Framework preset: **Other**
- Build command: *(none)*
- Output directory: *(none / repo root)*

`vercel.json` only sets cache headers and `X-Robots-Tag: noindex`.

**Keep the deployment private.** The JSON contains the full text of a paid course.
Personal use is one thing; a public URL is redistribution. Turn on Vercel's
Deployment Protection (Settings → Deployment Protection → Vercel Authentication, or
Password Protection) and keep this repo private.

The Supabase publishable key is embedded in the client, and the progress table is open
to it, so anyone holding the key can read or clear your progress. That is bounded by
keeping the deployment protected — but note the key is inlined in
`dist/clamp-trainer.html` too, so that file is now yours alone rather than something to
pass around.

## Rebuilding from the PGN

Only needed if you replace `source/Preventing Blunders in Chess.pgn`.

```sh
pip install chess
python3 build/pieces.py      # data/pieces.json — piece SVGs, rarely changes
python3 build/extract.py     # data/course.json — the course itself
python3 build/bundle.py      # dist/clamp-trainer.html
```

The piece sources only need regenerating if you change a set:

```sh
python3 build/pieces-round.py build/pieces-round.json   # redraw the local set
python3 build/pieces-fetch.py                           # re-pull the lichess sets
```

`build/extract.py` is where the real work happens. For each game it decides which side
the student plays (the author annotates the student's moves — side lines hang off them
and `!` marks them — so scoring both parities picks it out), splits plies into quiz moves
and moves played for you, pulls the arrows and circles out of the comments, keeps every
tagged alternative with its refutation, and precomputes the legal moves for each quiz
position so the browser needs no chess engine.

## Layout

```
index.html            served entry point
app.js                the whole app; defines startTrainer()
style.css
data/course.json      348 items, generated
data/pieces.json      piece SVGs, generated
build/extract.py      PGN  -> data/course.json
build/pieces.py            -> data/pieces.json
build/bundle.py       all  -> dist/clamp-trainer.html
build/body.html       markup shared by both builds (edit index.html, not this)
build/verify.mjs      walks the whole course through the real app
build/verify-flow.mjs checks the clock gate and that a miss withholds the move
build/verify-redeem.mjs checks how a red exercise goes green again
build/verify-theme.mjs  checks the appearance settings, and can write board PNGs
build/pieces-round.py the local piece set, drawn in code
build/pieces-fetch.py fetches and normalises the lichess sets
build/verify-sync.mjs drives two browsers against a mock endpoint
db/schema.sql         the Supabase table, to paste into the SQL editor
source/*.pgn          the Chessable export
dist/                 the offline single-file build
```

`app.js` wraps everything in `startTrainer()`, called once `window.DATA` and
`window.PIECES` exist — that's the only difference between the two builds.
`window.__CT` exposes the state machine and board for debugging from the console.

## Progress

Saved to `localStorage` after every answered move, every item you move to, every lesson
you open, and every settings change. It keeps the result of each individual quiz move
(clean / hint / missed), which lessons you've read, your cursor, and your settings.

## The quiz loop

A position is set up, the opponent's move is played to you, and then:

| you | it |
|---|---|
| still reading the setup | clock held, board locked, **Start** waiting on <kbd>↵</kbd> |
| answer correctly | the author's arrows and commentary land as the explanation |
| answer wrong | *That is not it.* — position back, move withheld, **Try again** / **Show me** |
| run out of time | *Out of time.* — same, withheld |
| play a move the author tagged `??` | the refutation plays out, then **Show the right move** |
| press **Show me** or <kbd>R</kbd> | the move, the arrows, the commentary, the side lines |

The clock is only held where there is something to read, and only once per move — a retry
puts you straight back on the clock. With the clock off there is no gate at all.

Either kind of failure marks the move missed whether or not you ask to see it, so the
`missed` review queue is unaffected by how long you hold out.

## Turning a red exercise green

A missed move does not stay missed forever, but you have to earn it back:

> A move is red until you answer it clean on a **later local day**, at least **six hours**
> after the miss. Miss it again and it is red again.

Both halves matter. Answering right ninety seconds after being shown the move proves
recall of the last ninety seconds, not of the pattern, so a same-session retry never
clears anything. The six hours are there because a miss at 23:58 and a clean answer at
00:03 is a different calendar day and obviously not a different sitting. A move you
needed the hint for clears the same way — needing the circled piece means you did not
have it.

The panel tells you where you stand after a miss, and the `missed` review queue empties
itself as you redeem, so *Run the missed ones* stays an honest list of what you still owe.

This is why progress is stored as **attempts rather than verdicts**:

```
att["12:4"] = [[2, 1773...], [0, 1773...]]     // [outcome, ms]; 0 clean, 1 hint, 2 missed
```

One entry per ask, capped at the last eight. The colour is derived from the list rather
than written into it — which is also what keeps the cross-device merge sound. A verdict
that can improve cannot be merged with worst-of any more, and two devices syncing in
different orders would disagree; an append-only list of attempts is still grow-only, so
the union stays order-independent. Saves from the previous build are read as a single
attempt of unknown age, so every already-red move is redeemable on the next session.

## Board and piece appearance

Three independent rows in Settings:

| | |
|---|---|
| **Board** | Slate, Walnut, Forest, Ocean, Lavender — shown as the colours themselves |
| **Piece set** | classic, round, chessnut, staunty, tatiana, totoy |
| **Piece colour** | Black and white, Warm, Indigo |

Slate + classic + black-and-white is the original look and stays the default; picking
them again returns the board pixel-for-pixel to where it started, which the tests assert
rather than assume.

Squares and coordinate labels are CSS variables, so they repaint for free. The pieces
cannot be: the artwork carries its colours as presentation attributes *and* inline
styles, in several spellings, and an inline style beats any rule a stylesheet could
apply. So every set is normalised at build time onto four tokens — `#fff` and `#ececec`
for the light piece, `#000` and `#3c3c3c` for the dark one — and `svgFor()` substitutes
those when a piece is drawn. One substitution therefore recolours all six sets, and a
change of set or ink redraws what is on the board.

All three settings live in `C` alongside the clock and the review mode, so they sync
across devices with everything else.

### Where the sets come from

`build/pieces.py` merges three sources into `data/pieces.json`, keyed by set name:

- **classic** — Cburnett's Staunton rendering, as shipped inside python-chess.
- **round** — drawn for this repo by `build/pieces-round.py`: flat parts with a heavy
  outline. Black pieces would be featureless silhouettes at that weight, so they get
  light seam lines at the joints instead.
- **chessnut, staunty, tatiana, totoy** — pulled from lichess by
  `build/pieces-fetch.py`, whose header records each licence.

Only sets that are safe to inline are taken. All 32 pieces live in one document, so
`pieces.py` strips element ids and refuses any set that resolves a colour through
`url(#…)` — a gradient id would otherwise collide across pieces and paint the whole
board from whichever definition happened to come first.

## Cross-device sync

The same progress also syncs through Supabase, so the phone and the laptop stay in step
— and so does `dist/clamp-trainer.html`, which used to keep its own separate progress.
There is no login: it is one row, one user, and the publishable key that ships in the
client is the credential.

Set it up once:

1. Run [`db/schema.sql`](db/schema.sql) in the Supabase SQL editor. It creates
   `public.clamp_progress` and touches nothing else.
2. That's it — the project URL and publishable key are already in `app.js`, under
   `var SYNC`. Point them somewhere else by setting `window.SYNC` before
   `startTrainer()` runs.

A dot in the top bar shows the state: dim = off, pulsing = syncing, green = up to date,
red = the last sync failed. Failure is not lossy — everything still lands in
`localStorage` and goes up on the next successful sync.

**Progress merges, it does not overwrite.** Both devices can be ahead of each other and
neither loses work:

| | rule |
|---|---|
| quiz attempts | union by timestamp; the same attempt on both sides keeps the worse outcome |
| lessons read | union |
| cursor, settings | whichever device wrote last |

Union is not a compromise — an attempt log only ever grows, which makes the merge
independent of the order the devices happen to sync in, and lets the colour be derived
consistently on every device from the same set of attempts.

The one thing that rule cannot express is a deliberate wipe, which a merge would simply
undo. So *Reset progress* bumps a generation counter, and a higher generation beats the
merge outright; the wipe reaches the other devices instead of being merged away. That
is also why the button now says "on every device".

Roughly 85 KB fully worked through — one row, well inside the free tier. The blob also
carries a derived `res` map of plain colours, which nothing reads back; it is there so a
device still running the previous build sees sane colours rather than an empty slate.

## Known issue in the source PGN

`Level 3: Puzzle 75` has a broken side line — a duplicate `2.Nxe4` branch that then
continues as if `2.Rd1` had been played, making `Nxc3` illegal. It's wrong in Chessable's
own export. `extract.py` drops that branch (and prints a note) and keeps the rest of
the puzzle.

## Verification

`build/verify.mjs` loads the app, walks all 328 positions, and plays all 835 answers,
checking at every quiz ply that the rendered board matches its FEN, the side to move is
right, the board orientation follows the student's colour, and the answer is offered as
legal — then that every item runs to completion with no JS errors.

```sh
npm i playwright
python3 -m http.server 8000 &
node build/verify.mjs http://localhost:8000/
node build/verify.mjs file://$PWD/dist/clamp-trainer.html
```

`build/verify-flow.mjs` covers the quiz loop: that the clock is held while there is setup
text and starts only when you do, that a wrong answer and a timeout both land on a state
that does *not* contain the move, that asking is what reveals it, and that a retry does
not make you read the text again.

```sh
node build/verify-flow.mjs http://localhost:8000/
```

`build/verify-redeem.mjs` covers redemption: the day-and-six-hours rule and the midnight
loophole it closes, hints clearing the same way, a re-miss turning it red again, one ask
recording exactly one attempt, the rail and review queue following the derived colour,
two devices agreeing after merging attempts, and old saves migrating.

```sh
node build/verify-redeem.mjs http://localhost:8000/
```

`build/verify-theme.mjs` covers the appearance settings: that the default is identical to
the look before the settings existed, that each board theme repaints squares, coordinates
and the pieces already on the board, that all six sets draw differently from one another
and every one of them still answers to the ink setting, that the choices survive a
reload, and that returning to the defaults really returns. Pass a directory as a second argument and it writes one PNG
of the board per theme.

```sh
node build/verify-theme.mjs http://localhost:8000/ /tmp/shots
```

`build/verify-sync.mjs` covers the sync layer instead. It stands up a mock endpoint
speaking the same dialect as Supabase and drives two browser contexts as two devices,
asserting that each one's work reaches the other, that the merge takes the worst result
in both directions, that a reset propagates, and that a dead endpoint degrades to
local-only without losing anything. It needs no network and no Supabase project.

```sh
node build/verify-sync.mjs
```

## Credits

Course content © CM Can Kabadayı, *Preventing Blunders in Chess* (Chessable).

Piece sets:

| set | by | licence |
|---|---|---|
| classic | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett), via python-chess | CC BY-SA 3.0 |
| round | drawn for this repo (`build/pieces-round.py`) | — |
| chessnut | [Alexis Luengas](https://github.com/LexLuengas/chessnut-pieces) | Apache 2.0 |
| totoy | Kosal Sen | CC BY 4.0 |
| staunty | sadsnake1 | CC BY-NC-SA 4.0 |
| tatiana | sadsnake1 | CC BY-NC-SA 4.0 |

The four fetched sets come from [lichess](https://github.com/lichess-org/lila/tree/master/public/piece),
whose `COPYING.md` is the source for the attributions above. `staunty` and `tatiana` are
non-commercial-only, which this private trainer is; the rest carry no such restriction.
Board colours were chosen for this repo.
