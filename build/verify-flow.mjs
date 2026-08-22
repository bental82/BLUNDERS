/**
 * The two rules the trainer has to keep:
 *
 *   1. the clock does not run while you are still reading the setup text
 *   2. a miss never shows the move -- only asking does
 *
 *   python3 -m http.server 8000 &
 *   node build/verify-flow.mjs http://localhost:8000/
 *
 * Sync stays off throughout; this is about the quiz flow only.
 */
import pw from "playwright";
const { chromium } = pw;

const url = process.argv[2] || "http://localhost:8000/";
const WITH_TEXT = 10;   // "Not Hanging Pieces 2 Moves in a Row - Exercise 1", intro + quiz at ply 0
const NO_TEXT = 72;     // quiz at ply 0 with nothing to read first

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/fonts\.googleapis|ERR_CONNECTION/.test(m.text()))
    errs.push("console: " + m.text());
});

// sync off, and a clock we can fast-forward instead of waiting on
await page.addInitScript(() => {
  window.SYNC = {};
  const real = Date.now;
  let skew = 0;
  Date.now = () => real() + skew;
  window.__skew = (ms) => { skew += ms; };
});

await page.goto(url);
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.click('[data-act="go"]');
await page.waitForTimeout(300);

const fails = [];
const ok = (n, c, got) =>
  c ? console.log("  ok   " + n) : (fails.push(n), console.log("  FAIL " + n + "  got: " + JSON.stringify(got)));

const st = () => page.evaluate(() => ({
  phase: window.__CT.S.phase,
  ticking: !!window.__CT.S.timer,
  locked: window.__CT.board.locked,
  panel: document.getElementById("panel").innerText,
  next: document.getElementById("bNext").innerText.trim(),
  reveal: document.getElementById("bReveal").offsetParent !== null
          ? document.getElementById("bReveal").innerText.trim() : null,
  fen: window.__CT.S.ply < window.__CT.item().plies.length
       ? window.__CT.item().plies[window.__CT.S.ply].f : null,
}));
const answer = () => page.evaluate(() => {
  const p = window.__CT.item().plies[window.__CT.S.ply];
  return { san: p.s, uci: p.u };
});
const settle = (phases, ms = 9000) =>
  page.waitForFunction((ph) => ph.includes(window.__CT.S.phase), phases, { timeout: ms });

async function go(idx, secs) {
  await page.evaluate((s) => {
    document.querySelector('[data-seg="secs"] [data-v="' + s + '"]');
  }, secs);
  await page.click("#btnCfg");
  await page.click('[data-seg="secs"] [data-v="' + secs + '"]');
  await page.click('[data-act="close"]');
  await page.evaluate((i) => window.__CT.jumpTo(i), idx);
  await page.waitForTimeout(400);
}

console.log("\n1. the clock waits for the setup text");
await go(WITH_TEXT, 30);
await settle(["ready", "quiz"]);
{
  const s = await st();
  ok("holds at 'ready' instead of asking", s.phase === "ready", s.phase);
  ok("clock is not running", !s.ticking, s);
  ok("board is locked", s.locked === true, s.locked);
  ok("the setup text is on screen", s.panel.length > 60, s.panel.slice(0, 80));
  ok("the button offers to start", /Start/.test(s.next), s.next);
  ok("no give-up button before you have even seen it", s.reveal === null, s.reveal);
}

console.log("\n2. it starts when you say so");
await page.keyboard.press("Enter");
await settle(["quiz"]);
{
  const s = await st();
  ok("now asking", s.phase === "quiz", s.phase);
  ok("clock is running", s.ticking === true, s);
  ok("board is unlocked", s.locked === false, s.locked);
}

console.log("\n3. a wrong move does not show the move");
const a1 = await answer();
await page.evaluate((uci) => {                      // any legal move that is not the answer
  const wrong = window.__CT.board.legal.find((m) => m !== uci);
  window.__CT.pick(wrong);
}, a1.uci);
await settle(["missed", "trap"]);
{
  const s = await st();
  if (s.phase === "trap") {
    ok("a tagged blunder still plays its refutation", true, s.phase);
    await page.evaluate(() => window.__CT.next());   // "Show the right move" is an explicit ask
    await settle(["taught"]);
  } else {
    ok("lands on 'missed', not 'taught'", s.phase === "missed", s.phase);
    ok("the answer is not in the panel", !s.panel.includes(a1.san), { san: a1.san, panel: s.panel });
    ok("clock stopped", !s.ticking, s);
    ok("it offers another go", /Try again/.test(s.next), s.next);
    ok("and offers to show you", s.reveal === "Show me", s.reveal);

    console.log("\n4. asking is what shows it");
    await page.evaluate(() => window.__CT.reveal());
    await settle(["taught"]);
    const t = await st();
    ok("now taught", t.phase === "taught", t.phase);
    ok("and now the move is on screen", t.panel.includes(a1.san), { san: a1.san, panel: t.panel.slice(0, 120) });
    ok("the reason for the miss is kept", /not it|time/i.test(t.panel), t.panel.slice(0, 60));
  }
}

console.log("\n5. running out of time does not show it either");
await go(WITH_TEXT + 1, 30);
await settle(["ready", "quiz"]);
if ((await st()).phase === "ready") await page.keyboard.press("Enter");
await settle(["quiz"]);
const a2 = await answer();
await page.evaluate(() => window.__skew(31000));    // jump the clock past the budget
await settle(["missed"], 5000);
{
  const s = await st();
  ok("timeout lands on 'missed'", s.phase === "missed", s.phase);
  ok("says it timed out", /time/i.test(s.panel), s.panel.slice(0, 60));
  ok("the answer is still hidden", !s.panel.includes(a2.san), { san: a2.san, panel: s.panel });
  ok("clock stopped", !s.ticking, s);
  // the course asks for 10-15 minutes a puzzle, so a timeout is not an attempt
  const rec = await page.evaluate(() => {
    const T = window.__CT, key = T.item().id + ":" + T.S.ply;
    return { attempts: (T.state().P.att[key] || []).length, status: T.resOf(key) };
  });
  ok("running out records no attempt", rec.attempts === 0, rec);
  ok("and leaves the move untouched", rec.status === undefined, rec);
}

console.log("\n5b. but asking to be shown after a timeout does count");
{
  const before = await page.evaluate(() => {
    const T = window.__CT; return T.item().id + ":" + T.S.ply;
  });
  await page.evaluate(() => window.__CT.reveal());
  await settle(["taught"]);
  const rec = await page.evaluate((key) => ({
    attempts: (window.__CT.state().P.att[key] || []).length,
    status: window.__CT.resOf(key) }), before);
  ok("asking is recorded", rec.attempts === 1, rec);
  ok("and counts as missed", rec.status === "missed", rec);
  await page.evaluate(() => window.__CT.retry());
  await settle(["quiz"]);
}

console.log("\n6. a retry does not make you read it again");
await page.evaluate(() => window.__CT.retry());
await settle(["quiz"]);
{
  const s = await st();
  ok("straight back to asking", s.phase === "quiz", s.phase);
  ok("clock running again", s.ticking === true, s);
}

console.log("\n7. the right move still just works");
const a3 = await answer();
await page.evaluate((uci) => window.__CT.pick(uci), a3.uci);
await settle(["solved", "idle", "done"]);
{
  const s = await st();
  ok("solved", /solved|idle|done/.test(s.phase), s.phase);
}

console.log("\n8. nothing to read means no gate");
await go(NO_TEXT, 30);
await settle(["quiz"], 9000);
{
  const s = await st();
  ok("goes straight to asking", s.phase === "quiz", s.phase);
  ok("clock running immediately", s.ticking === true, s);
}

console.log("\n9. clock off means no gate either");
await go(WITH_TEXT, 0);
await settle(["quiz"], 9000);
{
  const s = await st();
  ok("no gate when there is no clock", s.phase === "quiz", s.phase);
  ok("no clock running", !s.ticking, s);
}

console.log("\njs errors   " + errs.length);
errs.slice(0, 8).forEach((e) => console.log("   " + e));
await browser.close();
if (fails.length || errs.length) {
  console.error("\n" + (fails.length + errs.length) + " FAILED");
  process.exit(1);
}
console.log("\nall flow checks passed");
