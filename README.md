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
- **Puts you on a clock.** 20s per position, 15s for later moves in a line, configurable.
  Running out counts as a miss.
- **Plays out the traps.** Play a move the author tagged `??` and the refutation plays
  on the board move by move with his commentary. Every side line stays explorable
  afterwards as clickable move chips.
- **Quiz cold, teach on failure, then re-ask** the same position before moving on.

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
| quiz results | worst of the two wins (`clean` < `hint` < `missed`) |
| lessons read | union |
| cursor, settings | whichever device wrote last |

Worst-of is not a compromise — it is the rule `mark()` already applies when you
re-answer a move, which makes the result map grow-only and the merge independent of the
order the devices happen to sync in.

The one thing that rule cannot express is a deliberate wipe, which a merge would simply
undo. So *Reset progress* bumps a generation counter, and a higher generation beats the
merge outright; the wipe reaches the other devices instead of being merged away. That
is also why the button now says "on every device".

Roughly 17 KB at 100% completion — one row, well inside the free tier.

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
Piece graphics by Cburnett, CC BY-SA 3.0, via python-chess.
