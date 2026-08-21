/**
 * Walk the whole course through the real app and check it against the data.
 *
 *   npm i playwright
 *   python3 -m http.server 8000 &
 *   node build/verify.mjs http://localhost:8000/
 *   node build/verify.mjs file://$PWD/dist/clamp-trainer.html
 *
 * For every quiz ply it asserts the rendered board matches its FEN, the side to
 * move is right, the orientation follows the student's colour, and the answer is
 * offered as legal — then plays the answer and carries on to the end of the item.
 * It also opens every lesson, exercises every tagged side line, and fails on any
 * unresolved text placeholder or JS error.
 */
import pw from "playwright";
const { chromium } = pw;

const url = process.argv[2] || "http://localhost:8000/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });

const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/fonts\.googleapis|ERR_CONNECTION/.test(m.text()))
    errs.push("console: " + m.text());
});

// This walk answers all 835 quiz moves. Sync stays off so it can never push a
// synthetic run into the real Supabase row; build/verify-sync.mjs covers sync.
await page.addInitScript(() => { window.SYNC = {}; });

await page.goto(url);
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.evaluate(() => {
  document.querySelector('[data-seg="secs"] [data-v="0"]').click();  // clock off
});
await page.click('[data-act="go"]');
await page.waitForTimeout(300);

const report = await page.evaluate(async () => {
  const T = window.__CT, D = window.DATA;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__SPEED = 0.03;                       // collapse the animation waits

  function placement() {                       // read the DOM board back as a FEN field
    const b = T.board;
    let out = "", empty = 0;
    for (let i = 0; i < 64; i++) {
      const id = b.at[i];
      if (id) { if (empty) { out += empty; empty = 0; } out += b.pieces[id].code; }
      else empty++;
      if (i % 8 === 7) { if (empty) { out += empty; empty = 0; } if (i < 63) out += "/"; }
    }
    return out;
  }
  async function wait(phases, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (phases.includes(T.S.phase)) return true; await sleep(30); }
    return false;
  }

  const bad = [];
  let items = 0, quizzes = 0, lessons = 0, cards = 0, chips = 0;

  for (let i = 0; i < D.length; i++) {
    const it = D[i];

    if (it.kind !== "pos") {                   // lessons: must render real prose
      T.jumpTo(i); await sleep(40);
      const el = document.getElementById("lesB");
      lessons++;
      if (el.innerText.trim().length < 100) bad.push([it.title, "lesson body too short"]);
      if (/@@L|\{\{|\[%|undefined/.test(el.innerHTML)) bad.push([it.title, "unresolved text"]);
      continue;
    }

    items++;
    T.jumpTo(i);
    if (!(await wait(["quiz"], 9000))) { bad.push([it.title, "never reached a quiz", T.S.phase]); continue; }
    if (T.board.flip !== (it.player === "b")) bad.push([it.title, "wrong orientation"]);

    let guard = 0;
    while (guard++ < 40) {
      const s = T.S;
      if (s.phase === "done") break;
      if (s.phase === "quiz") {
        const ply = it.plies[s.ply];
        if (placement() !== ply.f.split(" ")[0]) { bad.push([it.title, "board != FEN at ply " + s.ply]); break; }
        if (T.board.turn !== ply.side) { bad.push([it.title, "wrong side to move at ply " + s.ply]); break; }
        if (!T.board.legal || T.board.legal.indexOf(ply.u) < 0) { bad.push([it.title, "answer not legal at ply " + s.ply]); break; }
        quizzes++;
        T.pick(ply.u);
        await sleep(60);
        // every side line on this ply should open and step without throwing
        let g2 = 0;
        while (T.S.phase !== "solved" && T.S.phase !== "done" && g2++ < 40) await sleep(25);
        for (const el of document.querySelectorAll("#panel .alt")) {
          cards++;
          el.click(); await sleep(15);
          for (const c of el.parentNode.querySelectorAll(".linebar .lm")) { c.click(); await sleep(10); chips++; }
        }
        if (/@@L|\{\{|\[%|undefined</.test(document.getElementById("panel").innerHTML))
          bad.push([it.title, "unresolved text in panel"]);
        continue;
      }
      if (s.phase === "solved") { T.next(); await sleep(50); continue; }
      if (s.phase === "idle" || s.phase === "intro") { await sleep(100); continue; }
      bad.push([it.title, "unexpected phase " + s.phase]);
      break;
    }
    if (guard >= 40) bad.push([it.title, "guard tripped"]);
  }
  return { items, quizzes, lessons, cards, chips, bad };
});

console.log(`url         ${url}`);
console.log(`positions   ${report.items}`);
console.log(`quiz moves  ${report.quizzes}`);
console.log(`lessons     ${report.lessons}`);
console.log(`side lines  ${report.cards} cards, ${report.chips} steps`);
console.log(`js errors   ${errs.length}`);
errs.slice(0, 10).forEach((e) => console.log("   " + e));
console.log(`failures    ${report.bad.length}`);
report.bad.slice(0, 25).forEach((b) => console.log("   " + b.join(" | ")));

await browser.close();
process.exit(report.bad.length || errs.length ? 1 : 0);
