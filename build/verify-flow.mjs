/**
 * The rules the trainer has to keep:
 *
 *   1. the clock does not run while you are still reading the setup text
 *   2. a miss never shows the move -- only asking does
 *   3. the author's arrows and rings are on the board with the text they belong
 *      to -- the question's while you are asked, minus any that would give the
 *      answer away, and the explanation's once you have answered
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

console.log("\n10. a trap replay can be stepped, and offers another go");
// item 292 ply 0: Nxb5?? is tagged, with a 28-move refutation to walk
await go(292, 30);
await settle(["ready", "quiz"]);
if ((await st()).phase === "ready") await page.keyboard.press("Enter");
await settle(["quiz"]);
{
  const bl = await page.evaluate(() => {
    const p = window.__CT.item().plies[window.__CT.S.ply];
    const a = (p.alts || []).find((x) => x.bad && (x.line || []).length >= 3);
    return a ? { uci: a.u ? a.u : null, san: a.s, len: a.line.length } : null;
  });
  ok("the position really has a tagged blunder", bl && bl.len >= 3, bl);
  await page.evaluate((san) => {
    const p = window.__CT.item().plies[window.__CT.S.ply];
    window.__CT.pick((p.alts.find((x) => x.s === san)).u);
  }, bl.san);
  await settle(["trap"], 9000);
  ok("playing it starts the refutation", (await st()).phase === "trap", await st());

  const chips = await page.evaluate(() =>
    document.querySelectorAll('.linebar[data-ns="trap"] .lm').length);
  ok("the refutation is listed as chips", chips >= 3, chips);

  // step to the first move by hand; that must move the board and stop the replay
  await page.evaluate(() => {
    document.querySelectorAll('.linebar[data-ns="trap"] .lm')[0].click();
  });
  await page.waitForTimeout(400);
  const s1 = await page.evaluate(() => ({
    trapK: window.__CT.S.trapK, auto: window.__CT.S.trapAuto,
    board: window.__CT.board.at.join(","),
    on: [...document.querySelectorAll('.linebar[data-ns="trap"] .lm')]
          .findIndex((b) => b.classList.contains("on")) }));
  ok("clicking a chip takes control of the replay", s1.auto === false, s1);
  ok("and moves to that step", s1.trapK === 0 && s1.on === 0, s1);

  // step forward to a later move
  await page.evaluate(() => {
    const b = document.querySelectorAll('.linebar[data-ns="trap"] .lm');
    b[Math.min(2, b.length - 1)].click();
  });
  await page.waitForTimeout(500);
  const s2 = await page.evaluate(() => ({
    trapK: window.__CT.S.trapK, board: window.__CT.board.at.join(",") }));
  ok("stepping forward changes the position", s2.board !== s1.board, { s1: s1.board.slice(0,40), s2: s2.board.slice(0,40) });
  ok("and the step is recorded", s2.trapK > 0, s2);

  // the board must stay put now the replay is stopped
  await page.waitForTimeout(2600);
  const s3 = await page.evaluate(() => window.__CT.board.at.join(","));
  ok("the replay does not carry on underneath", s3 === s2.board, null);

  // and there is a way back without being shown the answer
  const btn = await page.evaluate(() => {
    const b = document.getElementById("bReveal");
    return { shown: b.offsetParent !== null, text: b.innerText.trim() };
  });
  ok("a second action is offered", btn.shown, btn);
  ok("and it is another go, not the answer", /try again/i.test(btn.text), btn);
  await page.click("#bReveal");
  await settle(["quiz"]);
  const back = await st();
  const ans = await answer();
  ok("it puts you back on the position", back.phase === "quiz", back.phase);
  ok("with the answer still hidden", !back.panel.includes(ans.san),
     { san: ans.san, panel: back.panel.slice(0, 90) });
}

console.log("\n11. the author's marks are drawn with the text they belong to");
const marks = () => page.evaluate(() => {
  const a = window.__CT.board.ann || { cal: [], csl: [] };
  return { cal: [...a.cal].sort(), csl: [...a.csl].sort(),
           // the author's own marks; squares named in the text are .tm (section 12)
           drawn: document.querySelectorAll("#board .ov > :not(.tm)").length,
           phase: window.__CT.S.phase, ply: window.__CT.S.ply,
           panel: document.getElementById("panel").innerText };
});
// open an item with the clock off and answer your way to quiz move `ply`
async function quizAt(idx, ply) {
  await go(idx, 0);
  for (let n = 0; n < 60; n++) {
    const s = await page.evaluate(() => ({ phase: window.__CT.S.phase, ply: window.__CT.S.ply }));
    if (s.phase === "quiz" && s.ply === ply) return;
    if (s.phase === "quiz")
      await page.evaluate(() => window.__CT.pick(window.__CT.item().plies[window.__CT.S.ply].u));
    else if (s.phase === "solved") await page.evaluate(() => window.__CT.next());
    await page.waitForTimeout(200);
  }
  throw new Error("never reached quiz move " + ply + " of item " + idx);
}
{
  // 176: "How should Black defend the a4-pawn?" -- the knight's arrow onto a4
  // and the ring on the pawn are the question; neither is the answer (Bb5)
  await quizAt(176, 1);
  const q = await marks();
  ok("the question's arrow is on the board while you are asked",
     q.cal.join() === "Gc5a4", q);
  ok("and so is its ring", q.csl.join() === "Ra4", q);
  ok("and they are actually drawn", q.drawn === 2, q.drawn);

  await page.evaluate(() => window.__CT.hint());
  const h = await marks();
  ok("a hint rings the piece on top of them, not instead",
     h.csl.includes("Yc4") && h.csl.includes("Ra4") && h.cal.includes("Gc5a4"), h);
  ok("and says which ring is the hint", /circled in yellow/i.test(h.panel), h.panel.slice(-80));

  // a wrong move puts the position back -- and the question with it
  await quizAt(176, 1);
  await page.evaluate(() => {
    const p = window.__CT.item().plies[window.__CT.S.ply];
    const bad = new Set([p.u].concat((p.alts || []).map((a) => a.u)));
    window.__CT.pick(p.legal.split(" ").find((m) => m && !bad.has(m)));
  });
  await settle(["missed"]);
  const m = await marks();
  ok("after a miss the question's marks are back", m.cal.join() === "Gc5a4" && m.csl.join() === "Ra4", m);

  await page.evaluate(() => window.__CT.reveal());
  await settle(["taught"]);
  const t = await marks();
  ok("shown, the explanation's arrows join the question's",
     t.cal.includes("Gc5a4") && t.cal.includes("Gb5a4"), t);
}
{
  // 62: Ba3?? comes with a green arrow d5-d2 and a ring on d2 -- that is Qd2#,
  // the answer itself. The bishop's own arrow and ring frame the question.
  await quizAt(62, 1);
  const q = await marks();
  ok("a mark that is the answer move is held back", !q.cal.includes("Gd5d2"), q);
  ok("as is a ring on the square it lands on", !q.csl.includes("Rd2"), q);
  ok("while the rest of the question's marks stay", q.cal.join() === "Gc1a3" && q.csl.join() === "Gc1", q);
  await page.evaluate(() => window.__CT.reveal());
  await settle(["taught"]);
  const t = await marks();
  ok("answered, the held-back marks come back", t.cal.includes("Gd5d2") && t.csl.includes("Rd2"), t);
}
{
  // 326: "Now the same idea won't work for White. Can you see why?" rings f2,
  // where the answer (Qf2+) lands
  await quizAt(326, 3);
  const q = await marks();
  ok("a lone ring on the answer square is held back", q.csl.length === 0 && q.drawn === 0, q);
}
{
  // 156 ends on the opponent's Bc2=, "This is a fortress", with an arrow and a
  // ring that were never drawn: the position ended without them
  await quizAt(156, 11);
  await page.evaluate(() => window.__CT.pick(window.__CT.item().plies[window.__CT.S.ply].u));
  await settle(["done"]);
  await page.waitForTimeout(200);
  const e = await marks();
  ok("a closing comment's marks are on the final position",
     e.cal.includes("Gc2f5") && e.csl.includes("Gf5"), e);
  ok("alongside its text", /fortress/i.test(e.panel), e.panel.slice(0, 120));
}

console.log("\n12. the squares the text names are marked on the board");
const named = () => page.evaluate(() => {
  const tm = window.__CT.board.tm || { sq: [], ln: [] };
  return {
    sq: [...new Set(tm.sq)].sort(), ln: tm.ln.map((l) => l.join("-")).sort(),
    drawn: document.querySelectorAll("#board .ov .tm").length,
    chips: [...document.querySelectorAll("#panel code.onboard")]
             .map((c) => c.textContent.replace(/^[KQRBN]/, "")),
    html: document.getElementById("panel").innerHTML,
  };
});
// every cyan chip is marked on the board, and every mark on the board has one
const agree = (n) => {
  const on = new Set([...n.sq, ...n.ln]);
  return n.chips.every((c) => on.has(c)) && [...on].every((s) => n.chips.includes(s));
};
{
  // "Can White capture the pawn on f5?" -- the author drew nothing here
  await quizAt(187, 0);
  const q = await named();
  ok("“the pawn on f5” marks f5 while you are asked", q.sq.join() === "f5" && q.drawn > 0, q);
  ok("its chip is f5, with the question mark left outside",
     q.html.includes('<code class="onboard">f5</code>?'), q.html);
  ok("chips and board agree", agree(q), q);
  await page.evaluate(() => window.__CT.reveal());
  await settle(["taught"]);
  const t = await named();
  ok("answered, the question's square is still marked", t.sq.includes("f5"), t);
  ok("chips and board still agree", agree(t), t);
}
{
  // a side line names squares of its own; on the board, they are what is marked
  await quizAt(34, 1);
  await page.evaluate(() => window.__CT.pick(window.__CT.item().plies[window.__CT.S.ply].u));
  await settle(["solved"]);
  const m = await named();
  ok("the explanation's square is marked", m.sq.includes("b5"), m);
  await page.evaluate(() => document.querySelector('.alt[data-alt="0"]').click());
  await page.waitForTimeout(250);
  const a = await named();
  ok("exploring a side line marks the squares its text names",
     a.sq.includes("f4") && a.sq.includes("g5"), a);
  ok("and no longer the main line's", !a.sq.includes("b5"), a);
  ok("chips and board agree there too", agree(a), a);
}
{
  const r = await page.evaluate(() => {
    const n = (t) => { const m = window.__CT.named([t]);
      return m.sq.join() + "|" + m.ln.map((l) => l.join("-")).join(); };
    return {
      move: n("The move 34. f5⁇ was a major"), check: n("43.Bd1⁇ d5+ Black can"),
      dots: n("between ...g5 and ...Kc6"), hyph: n("the e5-knight and the b7- and g6-pawns"),
      line: n("the b1-h7 diagonal, and Nd3-c5"), list: n("checking squares: c2, g2, f5 and d5."),
      stop: n("a3 and h3. h3 served"),
    };
  });
  ok("a numbered pawn move is not a square", r.move === "|", r.move);
  ok("nor one with a check after it", r.check === "|", r.check);
  ok("nor a ...move", r.dots === "|", r.dots);
  ok("“the e5-knight” and “the b7- and g6-pawns” are squares", r.hyph === "e5,b7,g6|", r.hyph);
  ok("a diagonal and a manoeuvre are lines", r.line === "|b1-h7,d3-c5", r.line);
  ok("a list names every square in it", r.list === "c2,g2,f5,d5|", r.list);
  ok("a square ending a sentence is not a move number", r.stop === "a3,h3,h3|", r.stop);
}
{
  // 118: "Why is he just giving me the h6-pawn?" -- the author circles h6, where
  // the answer lands; the question names it, so the circle gives nothing away
  await quizAt(118, 1);
  const q = await marks();
  ok("a circle on a square the question names stays", q.csl.includes("Rh6"), q);
  ok("while the arrow of the answer move is still held back", !q.cal.includes("Bg6h6"), q);
}

console.log("\njs errors   " + errs.length);
errs.slice(0, 8).forEach((e) => console.log("   " + e));
await browser.close();
if (fails.length || errs.length) {
  console.error("\n" + (fails.length + errs.length) + " FAILED");
  process.exit(1);
}
console.log("\nall flow checks passed");
