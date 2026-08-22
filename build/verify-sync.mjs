/**
 * Prove the cross-device merge does what it claims, without touching Supabase.
 *
 *   node build/verify-sync.mjs
 *
 * Serves the repo, stands up a mock PostgREST endpoint that speaks the same
 * dialect as Supabase (GET with an id=eq. filter, POST with
 * Prefer: resolution=merge-duplicates), and drives two independent browser
 * contexts as two devices. Asserts that:
 *
 *   - a first run creates the row
 *   - each device's work reaches the other
 *   - res takes the worst of the two, in both directions
 *   - read unions
 *   - cursor and settings follow the later writer
 *   - "reset progress" propagates instead of being merged away
 *   - a dead endpoint degrades to local-only and loses nothing
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pw from "playwright";

const { chromium } = pw;
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEY = "pbc.trainer.v1";

/* ---------- mock PostgREST ------------------------------------------------ */
let rows = new Map();
let reqs = 0;
let fail = false;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey,authorization,content-type,prefer",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "content-range",
};

const api = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
  reqs++;
  if (fail) return res.writeHead(500, CORS).end('{"message":"boom"}');
  if (!req.headers.apikey) return res.writeHead(401, CORS).end('{"message":"no key"}');

  const u = new URL(req.url, "http://x");
  if (req.method === "GET") {
    const m = /^eq\.(.*)$/.exec(u.searchParams.get("id") || "");
    const hit = m && rows.get(decodeURIComponent(m[1]));
    return res
      .writeHead(200, { ...CORS, "Content-Type": "application/json" })
      .end(JSON.stringify(hit ? [hit] : []));
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      for (const r of JSON.parse(body)) rows.set(r.id, r);   // upsert
      res.writeHead(201, CORS).end("[]");
    });
    return;
  }
  res.writeHead(405, CORS).end();
});

/* ---------- static server ------------------------------------------------- */
const TYPES = { ".html": "text/html", ".js": "text/javascript",
                ".css": "text/css", ".json": "application/json" };
const site = http.createServer((req, res) => {
  let f = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (f === "/") f = "/index.html";
  const abs = path.join(ROOT, f);
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(abs)] || "application/octet-stream" });
  fs.createReadStream(abs).pipe(res);
});

const listen = (s, p) => new Promise((r) => s.listen(p, "127.0.0.1", r));
await listen(api, 8901);
await listen(site, 8900);

/* ---------- harness ------------------------------------------------------- */
const browser = await chromium.launch();
const fails = [];
const ok = (name, cond, got) =>
  cond ? console.log("  ok   " + name)
       : (fails.push(name), console.log("  FAIL " + name + "  got: " + JSON.stringify(got)));

/** Boot one "device": its own browser context, its own clock, its own storage. */
async function device(seed, now) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript(
    ([seed, now, key]) => {
      Date.now = () => now;
      window.SYNC = { url: "http://127.0.0.1:8901", key: "test-key",
                      table: "clamp_progress", row: "clamp" };
      if (seed) localStorage.setItem(key, JSON.stringify(seed));
    },
    [seed, now, KEY]
  );
  await page.goto("http://127.0.0.1:8900/");
  await page.waitForFunction(() => !!window.__CT, null, { timeout: 30000 });
  return { page, ctx, errs };
}

async function settle(d) {
  await d.page.evaluate(() => window.__CT.sync());
  await d.page.waitForFunction(
    () => /idle|err|off/.test(document.getElementById("sync").className),
    null, { timeout: 15000 }
  );
  return d.page.evaluate(() => {
    const st = window.__CT.state(), res = {};
    for (const k in st.P.att) { const r = window.__CT.resOf(k); if (r) res[k] = r; }
    return { ...st, res };          // res is derived, for readable assertions
  });
}

const S = (res, read, cursor, C, G, T) => ({ P: { res, read, cursor }, C, G, T });

console.log("\n1. first run creates the row");
{
  const a = await device(null, 1000);
  await settle(a);
  ok("row exists on the server", rows.has("clamp"), [...rows.keys()]);
  ok("dot reports idle", (await a.page.getAttribute("#sync", "class")) === "sync idle",
     await a.page.getAttribute("#sync", "class"));
  ok("no page errors", a.errs.length === 0, a.errs);
  await a.ctx.close();
}

console.log("\n2. two devices, each ahead of the other");
rows = new Map();
{
  const a = await device(
    S({ "1:0": "clean", "5:2": "clean" }, { "2": 1 }, 5,
      { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1000), 1000);
  await settle(a);
  await a.ctx.close();

  const b = await device(
    S({ "1:0": "missed", "3:4": "hint" }, { "9": 1 }, 42,
      { secs: 45, auto: 2, coords: 0, mode: "todo" }, 0, 2000), 2000);
  const sb = await settle(b);

  ok("B keeps its own work", sb.res["3:4"] === "hint", sb.res);
  ok("B receives A's work", sb.res["5:2"] === "clean", sb.res);
  ok("worst wins: clean(A) vs missed(B) -> missed", sb.res["1:0"] === "missed", sb.res);
  ok("read unions", sb.P.read["2"] === 1 && sb.P.read["9"] === 1, sb.P.read);
  ok("later writer keeps the cursor", sb.P.cursor === 42, sb.P.cursor);
  ok("later writer keeps settings", sb.C.secs === 45 && sb.C.mode === "todo", sb.C);
  await b.ctx.close();

  // A comes back later and should pick up everything of B's
  const a2 = await device(
    S({ "1:0": "clean", "5:2": "clean" }, { "2": 1 }, 5,
      { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1000), 3000);
  const sa2 = await settle(a2);
  ok("A receives B's work", sa2.res["3:4"] === "hint", sa2.res);
  ok("worst wins in the other direction too", sa2.res["1:0"] === "missed", sa2.res);
  ok("A adopts B's newer cursor", sa2.P.cursor === 42, sa2.P.cursor);
  ok("A adopts B's newer settings", sa2.C.secs === 45, sa2.C);
  ok("A keeps its own untouched entries", sa2.res["5:2"] === "clean", sa2.res);
  await a2.ctx.close();
}

console.log("\n3. a clean answer never downgrades a recorded miss");
rows = new Map();
{
  const a = await device(S({ "7:1": "missed" }, {}, 0,
    { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1000), 1000);
  await settle(a); await a.ctx.close();
  const b = await device(S({ "7:1": "clean" }, {}, 0,
    { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 2000), 2000);
  const sb = await settle(b);
  ok("stays missed", sb.res["7:1"] === "missed", sb.res);
  ok("server agrees", JSON.stringify(rows.get("clamp").data.P.att["7:1"]).includes("2"),
     rows.get("clamp").data.P.att["7:1"]);
  ok("and the row carries no res mirror to be flattened by",
     rows.get("clamp").data.P.res === undefined, Object.keys(rows.get("clamp").data.P));
  await b.ctx.close();
}

console.log("\n4. reset propagates instead of being merged away");
rows = new Map();
{
  const a = await device(S({ "1:0": "missed", "2:1": "clean" }, { "4": 1 }, 8,
    { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1000), 1000);
  await settle(a);
  await a.page.evaluate(() => { window.confirm = () => true; });
  await a.page.click('[data-act="wipe"]');   // the start card carries its own
  await a.page.waitForFunction(
    () => /idle|err/.test(document.getElementById("sync").className), null, { timeout: 15000 });
  const sa = await a.page.evaluate(() => window.__CT.state());
  ok("A is empty locally", Object.keys(sa.P.att).length === 0, sa.P.att);
  ok("A bumped the generation", sa.G === 1, sa.G);
  ok("server row is empty at gen 1",
     rows.get("clamp").gen === 1 && Object.keys(rows.get("clamp").data.P.att).length === 0,
     rows.get("clamp"));
  await a.ctx.close();

  // B still holds the old progress at gen 0 and must adopt the wipe
  const b = await device(S({ "1:0": "missed", "2:1": "clean" }, { "4": 1 }, 8,
    { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1500), 4000);
  const sb = await settle(b);
  ok("B adopts the wipe", Object.keys(sb.res).length === 0, sb.res);
  ok("B clears read too", Object.keys(sb.P.read).length === 0, sb.P.read);
  ok("B is at gen 1", sb.G === 1, sb.G);
  ok("stale progress did not come back to the server",
     Object.keys(rows.get("clamp").data.P.att).length === 0, rows.get("clamp").data.P);
  await b.ctx.close();
}

console.log("\n5. a dead endpoint costs nothing");
rows = new Map();
{
  fail = true;
  const a = await device(S({ "1:0": "clean" }, {}, 3,
    { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1000), 1000);
  const sa = await settle(a);
  ok("dot reports the failure",
     (await a.page.getAttribute("#sync", "class")) === "sync err",
     await a.page.getAttribute("#sync", "class"));
  ok("local progress survives", sa.res["1:0"] === "clean", sa.res);
  ok("still written to localStorage",
     await a.page.evaluate((k) => !!JSON.parse(localStorage.getItem(k)).P.att["1:0"], KEY));
  ok("no page errors", a.errs.length === 0, a.errs);
  await a.ctx.close();

  // and once it comes back, the work goes up
  fail = false;
  const a2 = await device(S({ "1:0": "clean" }, {}, 3,
    { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 1000), 2000);
  await settle(a2);
  ok("recovers when the endpoint returns",
     !!rows.get("clamp").data.P.att["1:0"], rows.get("clamp"));
  await a2.ctx.close();
}

console.log("\n6. answering a move actually reaches the server");
rows = new Map();
{
  const a = await device(null, 5000);
  await settle(a);
  const before = JSON.stringify(rows.get("clamp").data.P.att);
  await a.page.evaluate(() => {
    document.querySelector('[data-seg="secs"] [data-v="0"]').click();  // clock off
  });
  await a.page.click('[data-act="go"]');
  await a.page.waitForTimeout(400);
  await a.page.evaluate(() => window.__CT.item());          // ensure an item is live
  await a.page.evaluate(() => { for (let i = 0; i < 3; i++) window.__CT.next(); });
  await a.page.waitForTimeout(400);
  await settle(a);
  const after = rows.get("clamp").data;
  ok("cursor advanced on the server", after.P.cursor !== 0 || before !== JSON.stringify(after.P.att),
     { before, after: after.P });
  ok("no page errors while playing", a.errs.length === 0, a.errs);
  await a.ctx.close();
}

console.log("\n7. the offline single-file build syncs from file:// too");
rows = new Map();
{
  const bundle = path.join(ROOT, "dist", "clamp-trainer.html");
  if (!fs.existsSync(bundle)) {
    ok("dist/clamp-trainer.html exists (run build/bundle.py)", false, bundle);
  } else {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.addInitScript(
      ([seed, key]) => {
        Date.now = () => 9000;
        window.SYNC = { url: "http://127.0.0.1:8901", key: "test-key",
                        table: "clamp_progress", row: "clamp" };
        localStorage.setItem(key, JSON.stringify(seed));
      },
      [S({ "6:3": "hint" }, { "1": 1 }, 11,
         { secs: 20, auto: 0, coords: 1, mode: "all" }, 0, 8000), KEY]
    );
    await page.goto("file://" + bundle);
    await page.waitForFunction(() => !!window.__CT, null, { timeout: 30000 });
    await page.evaluate(() => window.__CT.sync());
    await page.waitForFunction(
      () => /idle|err|off/.test(document.getElementById("sync").className),
      null, { timeout: 15000 }
    );
    const cls = await page.getAttribute("#sync", "class");
    ok("cross-origin request from file:// is not blocked", cls === "sync idle", cls);
    ok("offline build pushes its progress",
       rows.get("clamp") && !!rows.get("clamp").data.P.att["6:3"],
       rows.get("clamp"));
    ok("no page errors", errs.length === 0, errs);
    await ctx.close();
  }
}

console.log("\n8. a payload with no attempts cannot flatten the row");
rows = new Map();
{
  const a = await device(S({ "4:1": "clean" }, {}, 2,
    { secs: 0, auto: 0, coords: 1, mode: "all" }, 0, 5000), 5000);
  await settle(a);
  ok("the row has attempts to begin with", !!rows.get("clamp").data.P.att["4:1"],
     rows.get("clamp").data.P);

  // exactly what a device on the previous build used to write
  rows.set("clamp", { id: "clamp", gen: 0,
    data: { P: { res: { "4:1": "missed", "9:9": "missed" }, read: {}, cursor: 2 },
            C: {}, T: 4000 } });

  const st = await settle(a);
  ok("the device keeps its own attempt", st.res["4:1"] !== undefined, st.res);
  ok("and reads the legacy entries rather than ignoring them",
     st.res["9:9"] === "missed", st.res);
  ok("the row is restored to attempts", !!rows.get("clamp").data.P.att["4:1"],
     rows.get("clamp").data.P);
  ok("with the legacy ones carried in too", !!rows.get("clamp").data.P.att["9:9"],
     Object.keys(rows.get("clamp").data.P.att || {}));
  await a.ctx.close();
}

console.log("\n9. a failed push is retried without being prompted");
rows = new Map();
{
  const a = await device(S({ "2:0": "clean" }, {}, 0,
    { secs: 0, auto: 0, coords: 1, mode: "all" }, 0, 6000), 6000);
  await settle(a);
  ok("it starts out synced", !!rows.get("clamp"), [...rows.keys()]);

  fail = true;
  rows = new Map();
  await a.page.evaluate(() => {
    const T = window.__CT, P = T.state().P;
    P.att["3:0"] = [[0, Date.now() - 6e5]];        // new work while the endpoint is down
    T.sync();
  });
  await a.page.waitForFunction(
    () => document.getElementById("sync").className === "sync err", null, { timeout: 15000 });
  ok("the failure shows", true, null);
  ok("nothing reached the server", !rows.get("clamp"), [...rows.keys()]);

  fail = false;   // no further user action: the backoff must carry it up
  await a.page.waitForFunction(
    () => document.getElementById("sync").className === "sync idle", null, { timeout: 30000 });
  ok("it retries on its own and lands", !!rows.get("clamp"), [...rows.keys()]);
  ok("carrying the work made during the outage",
     !!(rows.get("clamp").data.P.att || {})["3:0"],
     Object.keys(rows.get("clamp").data.P.att || {}));
  await a.ctx.close();
}

console.log("\nrequests to the mock endpoint: " + reqs);
await browser.close();
api.close(); site.close();

if (fails.length) { console.error("\n" + fails.length + " FAILED:\n  " + fails.join("\n  ")); process.exit(1); }
console.log("\nall sync checks passed");
