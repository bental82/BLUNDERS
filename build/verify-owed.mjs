/* Why a position's dot stays red after you answer a move right: which moves
   still owe a clean answer, when they can be earned back, and whether the
   app says so instead of announcing "position complete" over a red dot. */
import pw from "playwright";
const URL = process.argv[2] || "http://localhost:8000/";
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.addInitScript(() => { window.SYNC = {}; });
await p.goto(URL);
await p.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });

const fails = [];
const ok = (n, c, got) => { if (!c) fails.push(n);
  console.log((c ? "  ok   " : "  FAIL ") + n + (c ? "" : "  got: " + JSON.stringify(got))); };
const panel = () => p.evaluate(() => document.getElementById("panel").innerText);

// Walk a position to its end, answering every quiz move correctly. next() in
// a transient phase jumps to the next item, so only advance when the app is
// actually waiting on us, and stop if we ever leave the position under test.
const walkSrc = (stopAtQuizIdx) => p.evaluate(async (stopAt) => {
  const T = window.__CT, seen = [], sleep = ms => new Promise(r => setTimeout(r, ms));
  const startId = T.item().id;
  for (let guard = 0; guard < 140; guard++) {
    const ph = T.S.phase;
    if (ph === "done") break;
    if (T.item().id !== startId) return { drifted: T.item().id, seen };
    if (ph === "quiz") {
      const idx = T.item().plies.slice(0, T.S.ply).filter(x => x.q).length + 1;
      T.pick(T.item().plies[T.S.ply].u);
      await sleep(140);
      seen.push({ idx, phase: T.S.phase, text: document.getElementById("panel").innerText });
      if (stopAt && idx === stopAt) return { stopped: idx, seen };
      continue;
    }
    if (ph === "ready") { T.begin(); await sleep(120); continue; }
    if (ph === "solved" || ph === "taught" || ph === "missed" || ph === "trap") {
      T.next(); await sleep(160); continue;
    }
    await sleep(120);        // intro / idle -- a timer is already carrying it
  }
  return { stopped: null, seen, done: T.S.phase === "done", id: T.item().id };
}, stopAtQuizIdx);

// item 122 is the user's "Level 1: Puzzle 2" -- four quiz moves at plies 1,3,5,7
const seed = (spec) => p.evaluate((spec) => {
  const T = window.__CT, P = T.state().P;
  const it = window.DATA.find(d => d.id === 122);
  const q = it.plies.map((pl, i) => pl.q ? i : -1).filter(i => i >= 0);
  for (const i of q) delete P.att["122:" + i];
  const DAY = 864e5, HR = 36e5, now = Date.now();
  for (const [ord, entries] of Object.entries(spec))
    P.att["122:" + q[ord - 1]] = entries.map(([c, dt]) => [c, now + dt * HR]);
  T.jumpTo(122);
  return q;
}, spec);

console.log("\n1. what a red position owes, and when it can be earned back");
// 1: missed 3d ago, answered right 1d ago  -> redeemed
// 2: right first time                      -> clean
// 3: missed 40 min ago                     -> red, needs a later day
// 4: missed 2d ago, never answered right   -> red, earnable today
await seed({ 1: [[2, -72], [0, -24]], 2: [[0, -72]], 3: [[2, -0.67]], 4: [[2, -48]] });
await p.waitForTimeout(400);
const owed = await p.evaluate(() => {
  const T = window.__CT, it = window.DATA.find(d => d.id === 122);
  return { status: T.statusOf(it), owed: T.outstanding(it),
           perPly: it.plies.map((pl, i) => pl.q ? T.resOf("122:" + i) : null).filter(Boolean) };
});
ok("the item is red", owed.status === "missed", owed.status);
ok("the properly redeemed move reads clean", owed.perPly[0] === "clean", owed.perPly);
ok("two moves are holding the dot red", owed.owed.length === 2,
   owed.owed.map(o => o.ord));
ok("they are the 3rd and 4th moves",
   owed.owed.map(o => o.ord).join() === "3,4", owed.owed);
ok("the two-day-old miss can be earned back today",
   owed.owed.find(o => o.ord === 4).ready === true, owed.owed);
ok("the one missed 40 minutes ago cannot yet",
   owed.owed.find(o => o.ord === 3).ready === false, owed.owed);
ok("and it says when it can -- after midnight, not six hours from now",
   owed.owed.find(o => o.ord === 3).at > Date.now() + 6 * 36e5, owed.owed);

console.log("\n2. the rail shows how many, not just that it is red");
const rail = await p.evaluate(() => {
  const row = document.querySelector('#railList .row[data-i="122"]');
  return { cls: row.className, owed: (row.querySelector(".owed") || {}).textContent || null,
           onGreen: !!document.querySelector("#railList .row.s-clean .owed"),
           onSingleMove: [...document.querySelectorAll("#railList .row")]
             .filter(r => r.querySelector(".owed"))
             .filter(r => window.DATA[+r.dataset.i].plies
                            .filter(x => x.q).length < 2).length };
});
ok("the row is red", /s-missed/.test(rail.cls), rail.cls);
ok("and carries the count of moves still owed", rail.owed === "2", rail.owed);
ok("green rows carry no badge", !rail.onGreen, rail);
ok("and one-move positions carry none either -- the dot already says it",
   rail.onSingleMove === 0, rail.onSingleMove);

console.log("\n3. answering right too soon says the red stays");
const walk = await walkSrc(3);
ok("we are still on the position under test", !walk.drifted, walk.drifted);
const at3 = walk.seen[walk.seen.length - 1];
ok("the 3rd move was answered correctly", /correct/i.test(at3.text), at3.text.slice(0, 140));
ok("and the panel warns the red stays", /stays red/i.test(at3.text), at3.text.slice(0, 400));
ok("naming when it can be cleared", /tomorrow|later today/i.test(at3.text), at3.text.slice(0, 400));

console.log("\n4. the end of the position does not claim green over a red dot");
const rest = await walkSrc(null);
ok("still on the same position", !rest.drifted, rest.drifted);
const end = await panel();
const after = await p.evaluate(() => {
  const T = window.__CT, it = window.DATA.find(d => d.id === 122);
  return { status: T.statusOf(it), owed: T.outstanding(it).map(o => o.ord),
           badge: (document.querySelector('#railList .row[data-i="122"] .owed') || {}).textContent };
});
ok("we reached the end of the position", rest.done === true, rest.done);
ok("answering the old miss right cleared that one", !after.owed.includes(4), after.owed);
ok("the too-soon one is still owed", after.owed.join() === "3", after.owed);
ok("the item is still red", after.status === "missed", after.status);
ok("it does not say 'position complete'", !/position complete/i.test(end), end.slice(0, 200));
ok("it says the position is still marked missed", /still marked missed/i.test(end), end.slice(0, 200));
ok("it names the move that is holding it", /move 3/i.test(end), end.slice(0, 300));
ok("and when that move comes back", /comes back into play (tomorrow|later today)/i.test(end),
   end.slice(0, 400));
ok("the rail badge dropped from two to one", after.badge === "1", after.badge);

console.log("\n5. a position with nothing owed still reads as complete");
await seed({});
await p.waitForTimeout(400);
const clean = await walkSrc(null);
ok("still on the same position", !clean.drifted, clean.drifted);
const cend = await panel();
const cstat = await p.evaluate(() => {
  const T = window.__CT, it = window.DATA.find(d => d.id === 122);
  return { status: T.statusOf(it), owed: T.outstanding(it).length,
           badge: !!document.querySelector('#railList .row[data-i="122"] .owed') };
});
ok("a clean run leaves it green", cstat.status === "clean", cstat);
ok("nothing is owed", cstat.owed === 0, cstat);
ok("it says the position is complete", /position complete/i.test(cend), cend.slice(0, 200));
ok("it counts the moves found", /all 4 moves found/i.test(cend), cend.slice(0, 200));
ok("and the rail badge is gone", !cstat.badge, cstat);

console.log("\njs errors:", errs.length, errs.slice(0, 3));
if (errs.length) fails.push("js errors");
await b.close();
if (fails.length) { console.error("\n" + fails.length + " FAILED"); process.exit(1); }
console.log("\nall owed-move checks passed");
