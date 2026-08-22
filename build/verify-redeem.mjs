/**
 * How a red exercise goes green again.
 *
 *   python3 -m http.server 8000 &
 *   node build/verify-redeem.mjs http://localhost:8000/
 *
 * The rule: a move stays red until you answer it clean on a LATER LOCAL DAY
 * and at least six hours after the miss. Checks the rule itself, the midnight
 * loophole it is built to close, that a hint clears the same way, that the
 * rail and the review queue follow, that old single-verdict saves migrate,
 * and that two devices merging attempts agree on the colour.
 */
import pw from "playwright";
const { chromium } = pw;

const url = process.argv[2] || "http://localhost:8000/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));

await page.addInitScript(() => { window.SYNC = {}; });
await page.goto(url);
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.click('[data-act="go"]');
await page.waitForTimeout(250);

const fails = [];
const ok = (n, c, got) =>
  c ? console.log("  ok   " + n) : (fails.push(n), console.log("  FAIL " + n + "  got: " + JSON.stringify(got)));

/* ---- the rule itself, on injected attempt histories --------------------- */
console.log("\n1. the redemption rule");
const cases = await page.evaluate(() => {
  const T = window.__CT, P = T.state().P;
  const t = (iso) => new Date(iso).getTime();          // local time, like dayOf
  const D1 = "2026-03-10", D2 = "2026-03-11", D3 = "2026-03-12";
  const rows = [
    ["never wrong",                    [[0, t(D1+"T20:00")]],                                     "clean"],
    ["missed",                         [[2, t(D1+"T20:00")]],                                     "missed"],
    ["clean 5 min later",              [[2, t(D1+"T20:00")], [0, t(D1+"T20:05")]],                "missed"],
    ["clean 3 h later, same day",      [[2, t(D1+"T20:00")], [0, t(D1+"T23:00")]],                "missed"],
    ["clean 5 min later across midnight", [[2, t(D1+"T23:58")], [0, t(D2+"T00:03")]],             "missed"],
    ["clean next morning, 7 h later",  [[2, t(D1+"T23:58")], [0, t(D2+"T07:00")]],                "clean"],
    ["clean next day, 13 h later",     [[2, t(D1+"T20:00")], [0, t(D2+"T09:00")]],                "clean"],
    ["redeemed, then missed again",    [[2, t(D1+"T20:00")], [0, t(D2+"T09:00")], [2, t(D3+"T09:00")]], "missed"],
    ["hint",                           [[1, t(D1+"T20:00")]],                                     "hint"],
    ["hint, clean 30 min later",       [[1, t(D1+"T20:00")], [0, t(D1+"T20:30")]],                "hint"],
    ["hint, clean next day",           [[1, t(D1+"T20:00")], [0, t(D2+"T09:00")]],                "clean"],
    ["missed, redeemed, then hinted",  [[2, t(D1+"T20:00")], [0, t(D2+"T09:00")], [1, t(D2+"T10:00")]], "hint"],
    ["six hours exactly, next day",    [[2, t(D1+"T23:00")], [0, t(D2+"T05:00")]],                "clean"],
    ["five hours, next day",           [[2, t(D1+"T23:00")], [0, t(D2+"T04:00")]],                "missed"],
  ];
  const out = [];
  rows.forEach((r, i) => {
    const k = "__t" + i;
    P.att[k] = r[1];
    out.push([r[0], T.resOf(k), r[2]]);
    delete P.att[k];
  });
  out.push(["untouched move", T.resOf("__nope"), undefined]);
  return out;
});
cases.forEach(([n, got, want]) => ok(n + " -> " + want, got === want, got));

/* ---- pending() drives the on-screen advice ------------------------------ */
console.log("\n2. it tells you when you can clear it");
const pend = await page.evaluate(() => {
  const T = window.__CT, P = T.state().P, now = Date.now();
  const out = {};
  P.att.__p1 = [[2, now - 60 * 1000]];                       // missed a minute ago
  out.fresh = T.pending("__p1");
  P.att.__p2 = [[2, now - 40 * 3600 * 1000]];                // missed nearly two days ago
  out.old = T.pending("__p2");
  P.att.__p3 = [[0, now - 60 * 1000]];                       // never missed
  out.cleanOne = T.pending("__p3");
  delete P.att.__p1; delete P.att.__p2; delete P.att.__p3;
  return out;
});
ok("a fresh miss is not yet clearable", pend.fresh && pend.ready !== true && pend.fresh.ready === false, pend.fresh);
ok("an old miss is clearable now", pend.old && pend.old.ready === true, pend.old);
ok("a clean move has nothing pending", pend.cleanOne === null, pend.cleanOne);

/* ---- rail, tally and the review queue follow ---------------------------- */
console.log("\n3. the rail and the review queue follow the colour");
const rail = await page.evaluate(() => {
  const T = window.__CT, P = T.state().P, D = window.DATA;
  const t = (iso) => new Date(iso).getTime();
  const i = D.findIndex((x) => x.kind === "pos");
  const it = D[i];
  const plies = it.plies.map((p, n) => [p, n]).filter(([p]) => p.q).map(([, n]) => n);
  const set = (arr) => plies.forEach((n) => { P.att[it.id + ":" + n] = arr; });
  const dotOf = () => {
    T.S.k = T.S.order.indexOf(i);
    const row = document.querySelector('#railList .row[data-i="' + i + '"]');
    return row ? row.className : null;
  };
  const out = {};
  set([[2, t("2026-03-10T20:00")]]);
  window.__CT.statusOf(it); document.getElementById("railList") && window.dispatchEvent(new Event("resize"));
  out.redStatus = T.statusOf(it);
  out.redInQueue = (() => { const m = []; D.forEach((x, j) => { if (T.statusOf(x) === "missed") m.push(j); }); return m.includes(i); })();
  set([[2, t("2026-03-10T20:00")], [0, t("2026-03-11T09:00")]]);
  out.greenStatus = T.statusOf(it);
  out.greenInQueue = (() => { const m = []; D.forEach((x, j) => { if (T.statusOf(x) === "missed") m.push(j); }); return m.includes(i); })();
  plies.forEach((n) => delete P.att[it.id + ":" + n]);
  return out;
});
ok("an unredeemed item reads missed", rail.redStatus === "missed", rail.redStatus);
ok("and sits in the missed queue", rail.redInQueue === true, rail.redInQueue);
ok("a redeemed item reads clean", rail.greenStatus === "clean", rail.greenStatus);
ok("and leaves the missed queue", rail.greenInQueue === false, rail.greenInQueue);

/* ---- one ask records exactly one attempt -------------------------------- */
console.log("\n4. one ask records one attempt");
const rec = await page.evaluate(async () => {
  const T = window.__CT, P = T.state().P, D = window.DATA;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__SPEED = 0.03;
  const i = D.findIndex((x) => x.kind === "pos" && x.plies.some((p) => p.q));
  T.jumpTo(i);
  for (let g = 0; g < 200 && !["quiz", "ready"].includes(T.S.phase); g++) await sleep(30);
  if (T.S.phase === "ready") T.begin();
  const it = T.item(), key = it.id + ":" + T.S.ply;
  delete P.att[key];
  const p = it.plies[T.S.ply];
  T.pick(T.board.legal.find((m) => m !== p.u));            // wrong
  for (let g = 0; g < 200 && T.S.phase !== "missed" && T.S.phase !== "trap"; g++) await sleep(25);
  const afterMiss = (P.att[key] || []).length;
  if (T.S.phase === "missed") T.reveal();                  // asking must not count again
  for (let g = 0; g < 200 && T.S.phase !== "taught"; g++) await sleep(25);
  const afterReveal = (P.att[key] || []).length;
  T.retry();                                               // a retry is a new attempt
  for (let g = 0; g < 200 && T.S.phase !== "quiz"; g++) await sleep(25);
  T.hint(); T.pick(T.item().plies[T.S.ply].u);
  for (let g = 0; g < 200 && !["solved", "idle", "done"].includes(T.S.phase); g++) await sleep(25);
  const att = (P.att[key] || []).slice();
  return { afterMiss, afterReveal, att };
});
ok("the miss is one entry", rec.afterMiss === 1, rec);
ok("asking to be shown does not add another", rec.afterReveal === 1, rec);
ok("the retry adds exactly one more", rec.att.length === 2, rec.att);
ok("hint-then-correct records a hint, not a clean", rec.att[1] && rec.att[1][0] === 1, rec.att);

/* ---- merging attempts across devices ------------------------------------ */
console.log("\n5. two devices agree after merging attempts");
const merged = await page.evaluate(() => {
  const T = window.__CT, P = T.state().P;
  const t = (iso) => new Date(iso).getTime();
  const k = "__m0";
  P.att[k] = [[2, t("2026-03-10T20:00")]];                  // this device: missed
  T.absorb({ gen: 0, data: { P: { att: { [k]: [[0, t("2026-03-11T09:00")]] } }, T: 0 } });
  const after = T.resOf(k);                                  // the other device redeemed it
  const entries = P.att[k].slice();
  T.absorb({ gen: 0, data: { P: { att: { [k]: [[0, t("2026-03-11T09:00")]] } }, T: 0 } });
  const twice = JSON.stringify(P.att[k]);                    // applying it again changes nothing
  P.att.__m1 = [[0, t("2026-03-10T20:00")]];                 // same attempt, worse on their side
  T.absorb({ gen: 0, data: { P: { att: { __m1: [[2, t("2026-03-10T20:00")]] } }, T: 0 } });
  const clash = T.resOf("__m1");
  const out = { after, entries, twice, idem: twice === JSON.stringify(entries), clash };
  delete P.att[k]; delete P.att.__m1;
  return out;
});
ok("the other device's redemption arrives", merged.after === "clean", merged);
ok("both attempts are kept", merged.entries.length === 2, merged.entries);
ok("merging twice changes nothing", merged.idem === true, merged);
ok("same attempt, worse outcome wins", merged.clash === "missed", merged.clash);

/* ---- old saves migrate --------------------------------------------------- */
console.log("\n6. an old single-verdict save migrates");
// a fresh page, seeded before the app runs -- the live one has timers that
// would save over the seed between setItem and reload
const page2 = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page2.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await page2.addInitScript(() => {
  window.SYNC = {};
  localStorage.setItem("pbc.trainer.v1", JSON.stringify({
    P: { res: { "3:0": "missed", "3:2": "clean", "4:0": "hint" }, read: { "9": 1 }, cursor: 3 },
    C: { secs: 20, auto: 0, coords: 1, mode: "all" }, G: 0, T: 1000,
  }));
});
await page2.goto(url);
await page2.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
const mig = await page2.evaluate(() => {
  const T = window.__CT, P = T.state().P;
  return {
    shape: P.att["3:0"],
    missed: T.resOf("3:0"), clean: T.resOf("3:2"), hint: T.resOf("4:0"),
    readKept: P.read["9"], cursorKept: P.cursor,
    clearable: T.pending("3:0"),
  };
});
ok("the verdict becomes one attempt", Array.isArray(mig.shape) && mig.shape.length === 1 && mig.shape[0][0] === 2, mig.shape);
ok("colours survive the migration", mig.missed === "missed" && mig.clean === "clean" && mig.hint === "hint", mig);
ok("read and cursor survive", mig.readKept === 1 && mig.cursorKept === 3, mig);
ok("old reds are clearable right away", mig.clearable && mig.clearable.ready === true, mig.clearable);
await page2.close();

console.log("\n7. the headline numbers add up");
{
  // a fresh page, seeded before boot, so the start card is deterministic
  const page3 = await browser.newPage({ viewport: { width: 1500, height: 940 } });
  page3.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page3.addInitScript(() => {
    window.SYNC = {};
    const t = Date.now() - 6e5, att = {};
    for (let id = 10; id < 70; id++) att[id + ":0"] = [[0, t]];   // clean
    for (let id = 70; id < 90; id++) att[id + ":0"] = [[2, t]];   // missed
    localStorage.setItem("pbc.trainer.v1", JSON.stringify({
      P: { att, read: {}, cursor: 0 },
      C: { secs: 0, auto: 0, coords: 1, mode: "all" }, G: 0, T: 1000 }));
  });
  await page3.goto(url);
  await page3.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
  await page3.waitForTimeout(300);
  const st = await page3.evaluate(() => {
    const cells = [...document.querySelectorAll("#veilCard .stat > div")].map((d) => ({
      n: d.querySelector(".n").textContent.trim(),
      k: d.querySelector(".k").textContent.trim() }));
    const T = window.__CT, D = window.DATA;
    let ok = 0, no = 0, tot = 0;
    D.forEach((it) => { if (it.kind !== "pos") return;
      it.plies.forEach((p, i) => { if (!p.q) return; tot++;
        const r = T.resOf(it.id + ":" + i);
        if (r === "clean") ok++; else if (r === "missed" || r === "hint") no++; }); });
    return { cells, ok, no, tot };
  });
  const by = Object.fromEntries(st.cells.map((c) => [c.k, c.n]));
  ok("the card lists clean, missed, accuracy and covered",
     ["clean", "missed", "accuracy", "covered"].every((k) => k in by), st.cells);
  ok("clean matches the derived statuses", by.clean === String(st.ok), { by, st });
  ok("missed matches too", by.missed === String(st.no), { by, st });
  const done = st.ok + st.no;
  ok("accuracy is clean over attempted",
     by.accuracy === Math.round(st.ok / done * 100) + "%", { by, expect: Math.round(st.ok / done * 100) });
  ok("covered is attempted over the whole course",
     by.covered === Math.round(done / st.tot * 100) + "%", { by, expect: Math.round(done / st.tot * 100) });
  ok("accuracy and covered are different questions", by.accuracy !== by.covered, by);
  await page3.close();
}

console.log("\njs errors   " + errs.length);
errs.slice(0, 8).forEach((e) => console.log("   " + e));
await browser.close();
if (fails.length || errs.length) { console.error("\n" + (fails.length + errs.length) + " FAILED"); process.exit(1); }
console.log("\nall redemption checks passed");
