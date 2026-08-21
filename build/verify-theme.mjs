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
ok("pieces default to classic", base.pieceTheme === "classic", base.pieceTheme);
ok("pieces are on the board", base.pieces > 0, base.pieces);
ok("piece ink is still pure black and white",
   base.inks.includes("#ffffff") && base.inks.includes("#000000"), base.inks);
if (shots) await (await page.$("#board")).screenshot({ path: shots + "/board-slate-classic.png" });

console.log("\n2. each board theme repaints squares and coordinates");
for (const t of ["walnut", "forest", "ocean", "dusk"]) {
  await pick("board", t);
  const l = await look();
  ok(t + ": squares changed", l.lightBg !== base.lightBg && l.darkBg !== base.darkBg, l);
  ok(t + ": coordinates changed with them", l.coordLight !== base.coordLight, l.coordLight);
  ok(t + ": setting stored", l.board === t, l.board);
  if (shots) await (await page.$("#board")).screenshot({ path: shots + "/board-" + t + "-classic.png" });
}

console.log("\n3. piece ink repaints pieces already on the board");
await pick("board", "slate");
for (const t of ["warm", "cool"]) {
  await pick("pieces", t);
  const l = await look();
  ok(t + ": the old black/white ink is gone",
     !l.inks.includes("#000000") && !l.inks.includes("#ffffff"), l.inks);
  ok(t + ": pieces still all present", l.pieces === base.pieces, l.pieces);
  ok(t + ": setting stored", l.pieceTheme === t, l.pieceTheme);
  if (shots) await (await page.$("#board")).screenshot({ path: shots + "/board-slate-" + t + ".png" });
}
if (shots) {
  await pick("board", "walnut"); await pick("pieces", "warm");
  await (await page.$("#board")).screenshot({ path: shots + "/board-walnut-warm.png" });
  await pick("board", "forest"); await pick("pieces", "cool");
  await (await page.$("#board")).screenshot({ path: shots + "/board-forest-cool.png" });
}

console.log("\n4. the choice survives a reload");
await pick("board", "ocean");
await pick("pieces", "warm");
await page.reload();
await page.waitForFunction(() => !!window.__CT, null, { timeout: 20000 });
await page.click('[data-act="go"]');
await page.waitForTimeout(300);
await settleOnBoard(page);
{
  const l = await look();
  ok("board theme restored", l.board === "ocean" && l.lsq === "#dbe6ee", l);
  ok("piece theme restored", l.pieceTheme === "warm", l.pieceTheme);
  ok("and it actually painted, not just stored",
     !l.inks.includes("#000000") && l.lightBg !== base.lightBg, l);
}

console.log("\n5. going back to the defaults really goes back");
await pick("board", "slate");
await pick("pieces", "classic");
{
  const l = await look();
  ok("squares identical to the original", l.lightBg === base.lightBg && l.darkBg === base.darkBg, l);
  ok("coordinates identical", l.coordLight === base.coordLight, l.coordLight);
  ok("ink identical", JSON.stringify(l.inks) === JSON.stringify(base.inks), { now: l.inks, was: base.inks });
}

console.log("\njs errors   " + errs.length);
errs.slice(0, 8).forEach((e) => console.log("   " + e));
await browser.close();
if (fails.length || errs.length) { console.error("\n" + (fails.length + errs.length) + " FAILED"); process.exit(1); }
console.log("\nall theme checks passed");
