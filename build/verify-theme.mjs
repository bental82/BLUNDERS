/**
 * Board and piece colour settings.
 *
 *   python3 -m http.server 8000 &
 *   node build/verify-theme.mjs http://localhost:8000/ [shotdir]
 *
 * Checks that the default is exactly what it was before the setting existed,
 * that picking a theme repaints squares, coordinates and the pieces already on
 * the board, and that the choice survives a reload. With a directory argument
 * it also writes one PNG of the board per theme.
 *
 * And the layout around the board: from a landscape phone to a desktop, the
 * board, its timer and its buttons sit inside the stage, only the text
 * scrolls, and reading to the end of the wordiest comment leaves the board
 * wholly on screen.
 */
import fs from "node:fs";
import pw from "playwright";
const { chromium } = pw;

const url = process.argv[2] || "http://localhost:8000/";
const shots = process.argv[3] || null;
if (shots) fs.mkdirSync(shots, { recursive: true });

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
await page.waitForTimeout(300);
// land on an actual position with pieces, clock off so nothing times out mid-shot
await settleOnBoard(page);

// Injected into the page: scroll the commentary to its end and report what is
// on screen. The stage is asked to scroll too, and must not -- only the text does.
function addReadToEnd() {
  window.readToEnd = () => {
    const stage = document.getElementById("stage"), pn = document.getElementById("panel");
    const col = document.getElementById("boardcol");
    const over = pn.scrollHeight > pn.clientHeight + 2;
    pn.scrollTop = 1e6;
    stage.scrollTop = 1e6;
    const sr = stage.getBoundingClientRect(), pr = pn.getBoundingClientRect();
    const br = document.getElementById("board").getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    const last = pn.lastElementChild ? pn.lastElementChild.getBoundingClientRect() : null;
    return {
      over, stageScrolls: stage.scrollTop > 0,
      stacked: stage.classList.contains("stacked"),
      board: Math.round(br.width),
      boardOn: br.top >= 0 && br.left >= 0 && br.bottom <= innerHeight && br.right <= innerWidth,
      colIn: cr.top >= sr.top - 1 && cr.bottom <= sr.bottom + 1,
      reachable: last ? last.bottom <= pr.bottom + 2 && last.bottom <= innerHeight + 2 : null,
      docWide: document.documentElement.scrollWidth > innerWidth + 1,
    };
  };
}

const fails = [];
const ok = (n, c, got) =>
  c ? console.log("  ok   " + n) : (fails.push(n), console.log("  FAIL " + n + "  got: " + JSON.stringify(got)));

async function settleOnBoard(pg) {
  await pg.evaluate(() => {
    const D = window.DATA, T = window.__CT;
    T.state().C.secs = 0;
    T.jumpTo(D.findIndex((x) => x.kind === "pos" && x.plies.some((p) => p.q)));
  });
  await pg.waitForFunction(
    () => ["quiz", "ready", "idle", "intro"].includes(window.__CT.S.phase)
          && document.querySelectorAll(".pc").length > 0,
    null, { timeout: 20000 });
  await pg.waitForTimeout(250);
}

const look = () => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const light = document.querySelector(".sq.l"), dark = document.querySelector(".sq.d");
  const pcs = [...document.querySelectorAll(".pc svg")];
  const inks = new Set();
  pcs.forEach((s) => [...s.querySelectorAll("*")].forEach((el) => {
    const f = el.getAttribute("fill"), st = el.getAttribute("stroke");
    [f, st].forEach((v) => { if (v && v[0] === "#") inks.add(v.toLowerCase()); });
    const sty = el.getAttribute("style") || "";
    (sty.match(/#[0-9a-f]{3,6}/gi) || []).forEach((v) => inks.add(v.toLowerCase()));
  }));
  return {
    lsq: cs.getPropertyValue("--lsq").trim(),
    dsq: cs.getPropertyValue("--dsq").trim(),
    lightBg: getComputedStyle(light).backgroundColor,
    darkBg: getComputedStyle(dark).backgroundColor,
    coordLight: getComputedStyle(light.querySelector(".co")).color,
    pieces: pcs.length,
    inks: [...inks].sort(),
    board: window.__CT.state().C.board,
    pieceTheme: window.__CT.state().C.pieces,
    set: window.__CT.state().C.set,
    shape: (document.querySelector('.pc svg') || {}).innerHTML || "",
  };
});
const pick = async (which, v) => {
  await page.click("#btnCfg");
  await page.click('[data-seg="' + which + '"] [data-v="' + v + '"]');
  await page.click('[data-act="close"]');
  await page.waitForTimeout(180);
};

console.log("\n1. the default is untouched");
const base = await look();
ok("light squares are still #d6dae0", base.lsq === "#d6dae0", base.lsq);
ok("dark squares are still #78838f", base.dsq === "#78838f", base.dsq);
ok("board setting defaults to slate", base.board === "slate", base.board);
ok("piece colour defaults to classic", base.pieceTheme === "classic", base.pieceTheme);
ok("piece set defaults to classic", base.set === "classic", base.set);
ok("pieces are on the board", base.pieces > 0, base.pieces);
ok("piece ink is still pure black and white",
   base.inks.includes("#ffffff") && base.inks.includes("#000000"), base.inks);
if (shots) await (await page.$("#board")).screenshot({ path: shots + "/board-slate-classic.png" });

console.log("\n2. each board theme repaints squares and coordinates");
for (const t of ["walnut", "forest", "ocean", "lavender"]) {
  await pick("board", t);
  const l = await look();
  ok(t + ": squares changed", l.lightBg !== base.lightBg && l.darkBg !== base.darkBg, l);
  ok(t + ": coordinates changed with them", l.coordLight !== base.coordLight, l.coordLight);
  ok(t + ": setting stored", l.board === t, l.board);
  if (shots) await (await page.$("#board")).screenshot({ path: shots + "/board-" + t + "-classic.png" });
}

console.log("\n3. piece ink repaints pieces already on the board");
await pick("board", "slate");
for (const t of ["warm", "indigo"]) {
  await pick("pieces", t);
  const l = await look();
  ok(t + ": the old black/white ink is gone",
     !l.inks.includes("#000000") && !l.inks.includes("#ffffff"), l.inks);
  ok(t + ": pieces still all present", l.pieces === base.pieces, l.pieces);
  ok(t + ": setting stored", l.pieceTheme === t, l.pieceTheme);
  if (shots) await (await page.$("#board")).screenshot({ path: shots + "/board-slate-" + t + ".png" });
}
console.log("\n3b. every piece set swaps the artwork, and every one takes ink");
await pick("board", "slate"); await pick("pieces", "classic");
const staunton = await look();
const seen = new Map([["classic", staunton.shape]]);
for (const t of ["staunty", "tatiana", "chessnut", "totoy", "riohacha", "round"]) {
  await pick("set", t);
  const l = await look();
  ok(t + ": the drawing changed", l.shape !== staunton.shape && l.shape.length > 40, l.shape.slice(0, 50));
  ok(t + ": distinct from every other set", ![...seen.values()].includes(l.shape), t);
  ok(t + ": all pieces present", l.pieces === base.pieces, l.pieces);
  ok(t + ": set stored", l.set === t, l.set);
  seen.set(t, l.shape);
  await pick("pieces", "indigo");
  const j = await look();
  ok(t + ": recolours with the ink setting",
     !j.inks.includes("#000000") && !j.inks.includes("#ffffff"), j.inks);
  await pick("pieces", "classic");
}
await pick("set", "classic");
{
  const l = await look();
  ok("switching back restores the original artwork", l.shape === staunton.shape, null);
}

if (shots) {
  await pick("board", "walnut"); await pick("pieces", "warm");
  await (await page.$("#board")).screenshot({ path: shots + "/board-walnut-warm.png" });
  await pick("board", "lavender"); await pick("set", "round"); await pick("pieces", "indigo");
  await (await page.$("#board")).screenshot({ path: shots + "/board-lavender-round-indigo.png" });
  await pick("board", "forest"); await pick("pieces", "classic");
  await (await page.$("#board")).screenshot({ path: shots + "/board-forest-round.png" });
  await pick("board", "slate"); await pick("pieces", "warm");
  await (await page.$("#board")).screenshot({ path: shots + "/board-slate-round-warm.png" });
  await pick("set", "classic"); await pick("pieces", "classic");
}

console.log("\n4. the choice survives a reload");
await pick("board", "ocean");
await pick("pieces", "warm");
await pick("set", "round");
await page.reload();
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.click('[data-act="go"]');
await page.waitForTimeout(300);
await settleOnBoard(page);
{
  const l = await look();
  ok("board theme restored", l.board === "ocean" && l.lsq === "#dbe6ee", l);
  ok("piece set restored", l.set === "round", l.set);
  ok("piece theme restored", l.pieceTheme === "warm", l.pieceTheme);
  ok("and it actually painted, not just stored",
     !l.inks.includes("#000000") && l.lightBg !== base.lightBg, l);
}

console.log("\n5. going back to the defaults really goes back");
await pick("board", "slate");
await pick("pieces", "classic");
await pick("set", "classic");
{
  const l = await look();
  ok("squares identical to the original", l.lightBg === base.lightBg && l.darkBg === base.darkBg, l);
  ok("coordinates identical", l.coordLight === base.coordLight, l.coordLight);
  ok("ink identical", JSON.stringify(l.inks) === JSON.stringify(base.inks), { now: l.inks, was: base.inks });
  ok("artwork identical", l.shape === base.shape, null);
}

console.log("\n6. nothing bleeds over the edges of the board");
{
  // the closed rail is only translated off-screen; its shadow used to keep
  // painting a dark band across the a-file
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  pp.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await pp.addInitScript(() => { window.SYNC = {}; });
  await pp.addInitScript(addReadToEnd);
  await pp.goto(url);
  await pp.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
  await pp.evaluate(() => localStorage.clear());
  await pp.reload();
  await pp.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
  await pp.click('[data-act="go"]');
  await pp.waitForTimeout(250);
  await settleOnBoard(pp);
  ok("the rail is closed to begin with",
     await pp.evaluate(() => document.getElementById("app").classList.contains("railoff")));

  await pp.addStyleTag({ content: ".pc{display:none}" });   // squares only
  await pp.waitForTimeout(120);
  const shot = await pp.screenshot();
  const px = await pp.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = dataUrl; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const bd = document.getElementById("board").getBoundingClientRect();
    const dpr = img.width / innerWidth, sq = bd.width / 8;
    const read = (f, r) => {
      const d = ctx.getImageData(Math.round((bd.left + (f + 0.5) * sq) * dpr),
                                 Math.round((bd.top + (r + 0.5) * sq) * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const light = [], dark = [];
    for (const f of [0, 2, 4, 6]) { light.push(read(f, 1)); dark.push(read(f, 2)); }
    return { light, dark };
  }, "data:image/png;base64," + shot.toString("base64"));
  const same = (x, y) => x.every((v, i) => Math.abs(v - y[i]) <= 1);
  const uniform = (row) => row.every((c) => same(c, row[0]));
  ok("every light square down the rank is the same colour", uniform(px.light), px.light);
  ok("and every dark one", uniform(px.dark), px.dark);
  ok("the two square colours are actually different", !same(px.light[0], px.dark[0]), px);
  // and the settings rows must not crush their labels to one word a line
  await pp.click("#btnCfg");
  await pp.waitForTimeout(250);
  const rows = await pp.evaluate(() =>
    [...document.querySelectorAll("#veilCard .opt")].map((o) => {
      const lab = o.querySelector(".lab"), b = lab.querySelector("b");
      const line = parseFloat(getComputedStyle(b).fontSize) * 1.6;
      return { label: b.textContent,
               w: Math.round(lab.getBoundingClientRect().width),
               lines: Math.round(lab.getBoundingClientRect().height / line) };
    }));
  ok("every settings row has a label", rows.length >= 6, rows.length);
  const squeezed = rows.filter((r) => r.w < 150 || r.lines > 4);
  ok("no settings label is squeezed", squeezed.length === 0, squeezed);
  ok("the piece-set row lists what the data has",
     (await pp.evaluate(() => document.querySelectorAll('[data-seg="set"] button').length))
       === (await pp.evaluate(() => Object.keys(window.PIECES).length)),
     await pp.evaluate(() => [...document.querySelectorAll('[data-seg="set"] button')]
       .map((b) => b.dataset.v)));
  // the commentary under the board must be reachable, not clipped
  await pp.click('[data-act="close"]').catch(() => {});
  await pp.waitForTimeout(150);
  await pp.evaluate(() => { window.__CT.state().C.secs = 0; window.__CT.jumpTo(45); });
  await pp.waitForFunction(() => ["quiz", "ready"].includes(window.__CT.S.phase), null, { timeout: 20000 });
  await pp.evaluate(() => { if (window.__CT.S.phase === "ready") window.__CT.begin(); });
  await pp.evaluate(() => window.__CT.reveal());
  await pp.waitForFunction(() => window.__CT.S.phase === "taught", null, { timeout: 20000 });
  await pp.waitForTimeout(350);
  // the text scrolls on its own; the board it explains stays where it is
  const scroll = await pp.evaluate(() => readToEnd());
  ok("the wordiest position really does overflow", scroll.over, scroll);
  ok("the text scrolls, not the page around the board", !scroll.stageScrolls, scroll);
  ok("and the last block can be scrolled to", scroll.reachable === true, scroll);
  ok("with the board still wholly on screen", scroll.boardOn === true, scroll);
  ok("the stacked layout is the one in use", scroll.stacked === true, scroll);
  // the top bar must carry the score and the current exercise's status, and fit
  await pp.evaluate(() => { window.__CT.jumpTo(45); });
  await pp.waitForTimeout(250);
  const bar = await pp.evaluate(() => {
    const top = document.querySelector(".top");
    return { overflow: top.scrollWidth > top.clientWidth + 1,
             doc: document.documentElement.scrollWidth > innerWidth + 1,
             tallyShown: getComputedStyle(document.getElementById("tally")).display !== "none" };
  });
  ok("the score is on screen on a phone", bar.tallyShown, bar);
  ok("and the bar still fits", !bar.overflow && !bar.doc, bar);

  await phone.close();
}

console.log("\n7. at every size the board stays on screen while the text scrolls");
// a landscape phone used to stack and scroll its board clean off the top, and
// 1024 wide lost half of it under a long comment
for (const [w, h, want] of [[844, 390, "side"], [667, 375, "side"], [320, 568, "stacked"],
                            [375, 667, "stacked"], [820, 1180, "stacked"], [1024, 768, "side"],
                            [1500, 940, "side"]]) {
  const cx = await browser.newContext({ viewport: { width: w, height: h } });
  const pg = await cx.newPage();
  pg.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await pg.addInitScript(() => { window.SYNC = {}; });
  await pg.addInitScript(addReadToEnd);
  await pg.goto(url);
  await pg.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
  await pg.click('[data-act="go"]');
  await pg.evaluate(() => { window.__CT.state().C.secs = 0; window.__CT.jumpTo(45); });
  await pg.waitForFunction(() => window.__CT.S.phase === "quiz", null, { timeout: 20000 });
  await pg.evaluate(() => window.__CT.reveal());
  await pg.waitForFunction(() => window.__CT.S.phase === "taught", null, { timeout: 20000 });
  await pg.waitForTimeout(300);
  const r = await pg.evaluate(() => readToEnd());
  const tag = w + "x" + h + ": ";
  ok(tag + (want === "side" ? "text beside the board" : "text under the board"),
     r.stacked === (want === "stacked"), r);
  ok(tag + "board, timer and buttons inside the stage", r.colIn, r);
  ok(tag + "the end of the text can be reached", r.reachable === true, r);
  ok(tag + "and the board is still wholly on screen there", r.boardOn === true, r);
  ok(tag + "no sideways page scroll", !r.docWide, r);
  // the buttons change with the phase; a longer row must not push past the stage
  await pg.evaluate(() => { window.__CT.retry(); });
  await pg.waitForFunction(() => window.__CT.S.phase === "quiz", null, { timeout: 20000 });
  await pg.evaluate(() => {
    const p = window.__CT.item().plies[window.__CT.S.ply];
    window.__CT.pick(p.alts.find((a) => a.bad).u);
  });
  await pg.waitForFunction(() => window.__CT.S.phase === "trap", null, { timeout: 20000 });
  await pg.waitForTimeout(250);
  const t = await pg.evaluate(() => readToEnd());
  ok(tag + "the trap's buttons fit too", t.colIn, t);
  ok(tag + "and the board did not change size for them", t.board === r.board, { was: r.board, now: t.board });
  await cx.close();
}

console.log("\njs errors   " + errs.length);
errs.slice(0, 8).forEach((e) => console.log("   " + e));
await browser.close();
if (fails.length || errs.length) { console.error("\n" + (fails.length + errs.length) + " FAILED"); process.exit(1); }
console.log("\nall theme checks passed");
