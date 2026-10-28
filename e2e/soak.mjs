// Multi-client soak / chaos harness for The Circle.
//
// Spins up N real Chromium clients with fake camera+mic, joins them as
// participants or audience, then walks through churn + fault scenarios and
// checks that every client is actually receiving moving video and audio from
// everyone it should. Writes a JSON report + screenshots to --out.
//
//   node soak.mjs                              # 3 participants + 2 audience, all scenarios
//   node soak.mjs --participants 5 --audience 3 --soak 300
//   node soak.mjs --url http://10.0.0.231:5173 --no-backend   # against a server you run
//
// Fault scenarios: websocket blips, backend restart, seat churn, leave/rejoin.
// Network impairment (loss/latency/blackout) lives in netem.sh, which runs this
// same script inside Linux containers with `tc netem` applied.

import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const URL_ = args.url ?? "http://127.0.0.1:5173";
const P = Number(args.participants ?? 3);
const A = Number(args.audience ?? 2);
const SOAK_S = Number(args.soak ?? 30);
const OUT = path.resolve(here, args.out ?? `artifacts/run-${Date.now()}`);
const SCENARIOS = (args.scenarios ?? "join,chat,react,camoff,take,leave,blip,blip-audience,offline,restart,rejoin,soak").split(",");
const SPAWN_BACKEND = !args["no-backend"];
const HEADED = !!args.headed;
const PREFIX = args.prefix ?? "";
const QUERY = args.query ? `?${args.query}` : "";
const HEALTH_TIMEOUT = Number(args["health-timeout"] ?? 25000);

fs.mkdirSync(OUT, { recursive: true });
const report = { url: URL_, participants: P, audience: A, steps: [], startedAt: new Date().toISOString() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Backend process control ────────────────────────────────────────────────

let backend = null;
const backendDir = path.resolve(here, "../backend");
const daphne = process.platform === "win32"
  ? path.join(backendDir, "venv/Scripts/daphne.exe")
  : path.join(backendDir, "venv/bin/daphne");
const backendLog = fs.createWriteStream(path.join(OUT, "backend.log"), { flags: "a" });

async function startBackend() {
  backend = spawn(daphne, ["-b", "0.0.0.0", "-p", "8000", "config.asgi:application"], {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  backend.stdout.pipe(backendLog);
  backend.stderr.pipe(backendLog);
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://localhost:8000/api/ice-servers/");
      if (r.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("backend did not come up");
}

function stopBackend() {
  if (!backend) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${backend.pid} /T /F`, { stdio: "ignore" });
    else backend.kill("SIGKILL");
  } catch {}
  backend = null;
}

// ─── Clients ────────────────────────────────────────────────────────────────

const instrument = fs.readFileSync(path.join(here, "instrument.js"), "utf8");
const origin = new URL(URL_).origin;
const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});

const clients = [];

async function newClient(name, role) {
  // Audience clients can be phones (--mobile-audience) to exercise the small layout
  const phone = role === "audience" && args["mobile-audience"];
  const ctx = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await ctx.addInitScript(instrument);
  const page = await ctx.newPage();
  const c = { name, role, ctx, page, errors: [] };
  page.on("console", (m) => { if (m.type() === "error") c.errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => c.errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("dialog", (d) => { c.errors.push(`dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
  clients.push(c);
  await joinRoom(c);
  return c;
}

const sel = {
  name: '[data-testid="name-input"], input[placeholder="what do they call you?"]',
  joinP: '[data-testid="join-participant"], button:has-text("take a seat")',
  joinA: '[data-testid="join-audience"], button:has-text("join the audience")',
  takeSeat: '[data-testid="take-seat"], button:has-text("join seat")',
  leaveSeat: '[data-testid="leave-seat"], button[title="Leave seat"]',
  leaveRoom: '[data-testid="leave-room"], button[title="Leave room"], button:has-text("leave room")',
};

async function joinRoom(c) {
  await c.page.goto(URL_ + QUERY);
  if (!(await c.page.locator(sel.name).first().isVisible({ timeout: 8000 }).catch(() => false))) {
    throw new Error(`no name input at ${URL_} — is The Circle's dev server running there? (pass --url)`);
  }
  await c.page.locator(sel.name).first().fill(c.name);
  await sleep(600);
  if (!report.landingShot || (args["mobile-audience"] && c.role === "audience" && report.landingShot === 1)) {
    report.landingShot = (report.landingShot ?? 0) + 1;
    await sleep(900);
    await c.page.screenshot({ path: path.join(OUT, `landing-${c.name}.png`) }).catch(() => {});
  }
  await c.page.locator(c.role === "participant" ? sel.joinP : sel.joinA).first().click();
}

async function click(c, s) {
  await c.page.locator(s).first().click({ timeout: 5000 });
}

// ─── Health measurement ─────────────────────────────────────────────────────

const stats = (c) => c.page.evaluate(() => window.__harness.stats()).catch(() => null);

async function measure(windowMs = 2500) {
  const a = await Promise.all(clients.map(stats));
  await sleep(windowMs);
  const b = await Promise.all(clients.map(stats));
  // --extra-participants: seated clients driven by another harness process (e.g. in a container)
  const participants = clients.filter((c) => c.role === "participant").length + Number(args["extra-participants"] ?? 0);
  return clients.map((c, i) => {
    const s0 = a[i], s1 = b[i];
    if (!s0 || !s1) return { name: c.name, role: c.role, ok: false, why: "page dead" };
    const dt = (s1.t - s0.t) / 1000;
    const flows = [];
    for (const p1 of s1.pcs) {
      const p0 = s0.pcs.find((p) => p.id === p1.id);
      if (!p1.inV || !p0?.inV) continue;
      const dLost = p1.inV.lost - p0.inV.lost;
      const dRecv = p1.inV.recv - p0.inV.recv;
      const aConc = p1.inA && p0.inA ? p1.inA.concealed - p0.inA.concealed : 0;
      const aTot = p1.inA && p0.inA ? p1.inA.total - p0.inA.total : 0;
      flows.push({
        fps: (p1.inV.frames - p0.inV.frames) / dt,
        vkbps: ((p1.inV.bytes - p0.inV.bytes) * 8) / 1000 / dt,
        akbps: p1.inA && p0.inA ? ((p1.inA.bytes - p0.inA.bytes) * 8) / 1000 / dt : 0,
        loss: dLost + dRecv > 0 ? dLost / (dLost + dRecv) : 0,
        concealPct: aTot > 0 ? aConc / aTot : 0,
        res: `${p1.inV.w ?? 0}x${p1.inV.h ?? 0}`,
        freezes: p1.inV.freezes,
        rtt: p1.pair?.rtt,
        path: p1.pair ? `${p1.pair.lt}/${p1.pair.rt}` : "-",
      });
    }
    const vOk = flows.filter((f) => f.fps >= 5).length;
    const aOk = flows.filter((f) => f.akbps >= 4).length;
    const moving = s1.vids.filter((v, j) => v.visible && v.w > 0 && s0.vids[j] && v.t > s0.vids[j].t).length;
    const camOnAll = participants - [...camOff].filter((x) => x.role === "participant").length;
    const meCamOn = c.role === "participant" && !camOff.has(c) ? 1 : 0;
    const wantIn = c.role === "participant" ? participants - 1 : participants;
    const wantVideo = camOnAll - meCamOn;
    // UI truth: one tile per seated person, and camera-off people shown as presence, not black video
    const tiles = (s1.tiles ?? []).filter((t) => t.leaving !== "true");
    const tilesOk = !s1.tiles || tiles.length === participants;
    const camOffOk = [...camOff].every((x) => !x.sid || tiles.find((t) => t.sid === x.sid)?.cam === "off");
    const ok = vOk >= wantVideo && aOk >= wantIn && moving >= camOnAll && s1.ws.includes(1) && tilesOk && camOffOk;
    return {
      name: c.name, role: c.role, ok, vOk, aOk, moving, wantIn, wantVideo, wantMoving: camOnAll,
      tiles: tiles.length, tilesOk, camOffOk, ws: s1.ws, flows, errors: c.errors.length,
    };
  });
}

async function waitHealthy(label, timeout = HEALTH_TIMEOUT) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await measure();
    if (last.every((r) => r.ok)) break;
  }
  const ms = Date.now() - t0;
  const ok = last.every((r) => r.ok);
  const step = { label, ok, ms, clients: last };
  report.steps.push(step);
  printStep(step);
  await shoot(label);
  return step;
}

function printStep(step) {
  const flag = step.ok ? "PASS" : "FAIL";
  console.log(`\n[${flag}] ${step.label}  (${(step.ms / 1000).toFixed(1)}s)`);
  for (const r of step.clients) {
    const fps = r.flows?.length ? avg(r.flows.map((f) => f.fps)).toFixed(1) : "-";
    const loss = r.flows?.length ? (Math.max(...r.flows.map((f) => f.loss)) * 100).toFixed(1) : "-";
    const conceal = r.flows?.length ? (Math.max(...r.flows.map((f) => f.concealPct)) * 100).toFixed(1) : "-";
    const rtt = r.flows?.length ? Math.max(...r.flows.map((f) => (f.rtt ?? 0) * 1000)).toFixed(0) : "-";
    console.log(
      `  ${r.ok ? "ok " : "BAD"} ${r.name.padEnd(10)} ${r.role.padEnd(11)} ` +
      `video ${r.vOk}/${r.wantVideo ?? r.wantIn}  audio ${r.aOk}/${r.wantIn}  onscreen ${r.moving}/${r.wantMoving}  ` +
      `tiles ${r.tiles ?? "-"}${r.tilesOk === false ? "!" : ""}${r.camOffOk === false ? " camoff-not-shown!" : ""}  ` +
      `fps~${fps}  maxloss ${loss}%  conceal ${conceal}%  rtt ${rtt}ms  ws[${r.ws}]  errs ${r.errors}`
    );
  }
}

async function shoot(label) {
  const safe = label.replace(/[^a-z0-9]+/gi, "-");
  const pick = [clients.find((c) => c.role === "participant"), clients.find((c) => c.role === "audience")].filter(Boolean);
  await Promise.all(pick.map((c) =>
    c.page.screenshot({ path: path.join(OUT, `${safe}-${c.name}.png`) }).catch(() => {})
  ));
}

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

// ─── Scenarios ──────────────────────────────────────────────────────────────

const byRole = (r) => clients.filter((c) => c.role === r);
const camOff = new Set();
const sidOf = (c) => c.page.evaluate(() => window.__circle?.me().sid).catch(() => undefined);

async function offline(c, ms) {
  const cdp = await c.ctx.newCDPSession(c.page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(ms);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.detach();
}

const scenarios = {
  async join() {
    for (let i = 0; i < P; i++) { await newClient(`${PREFIX}p${i + 1}`, "participant"); await sleep(300); }
    for (let i = 0; i < A; i++) { await newClient(`${PREFIX}a${i + 1}`, "audience"); await sleep(300); }
    await waitHealthy(`join ${P}p+${A}a`);
  },
  async take() {
    const a = byRole("audience")[0];
    if (!a) return;
    await click(a, sel.takeSeat);
    a.role = "participant";
    await waitHealthy(`${a.name} takes a seat`);
  },
  async leave() {
    const p = byRole("participant")[0];
    if (!p) return;
    await click(p, sel.leaveSeat);
    p.role = "audience";
    await waitHealthy(`${p.name} leaves seat (stays as audience)`);
  },
  async blip() {
    const p = byRole("participant")[1] ?? byRole("participant")[0];
    if (!p) return;
    await p.page.evaluate(() => window.__harness.killSockets());
    await sleep(1500);
    await waitHealthy(`websocket blip on participant ${p.name}`);
  },
  async "blip-audience"() {
    const a = byRole("audience")[0];
    if (!a) return;
    await a.page.evaluate(() => window.__harness.killSockets());
    await sleep(1500);
    await waitHealthy(`websocket blip on audience ${a.name}`);
  },
  async camoff() {
    const p = byRole("participant")[0];
    if (!p) return;
    p.sid = await sidOf(p);
    await click(p, '[data-testid="toggle-cam"]');
    camOff.add(p);
    await waitHealthy(`${p.name} turns camera off (others see presence, not black)`);
    await click(p, '[data-testid="toggle-cam"]');
    camOff.delete(p);
    await waitHealthy(`${p.name} turns camera back on`);
  },
  async offline() {
    const p = byRole("participant").at(-1);
    if (!p) return;
    await offline(p, 8000);
    await waitHealthy(`${p.name} browser offline 8s (devtools emulation)`, 40000);
  },
  // Total network blackout (wifi drops) — needs --blackout-on/--blackout-off
  // shell commands, e.g. tc netem loss 100% inside the netem container
  async blackout() {
    if (!args["blackout-on"]) return;
    const secs = Number(args["blackout-secs"] ?? 10);
    execSync(args["blackout-on"]);
    await sleep(secs * 1000);
    execSync(args["blackout-off"]);
    await waitHealthy(`network blackout ${secs}s, then recovery`, 45000);
  },
  async react() {
    const c = clients[0];
    await click(c, '[data-testid="react"]');
    for (let i = 0; i < 6; i++) await click(c, `[data-testid="react-${i}"]`);
    await sleep(600);
    await shoot("reactions");
  },
  async chat() {
    for (const c of clients.slice(0, 3)) {
      const input = c.page.locator('[data-testid="chat-input"]');
      if (!(await input.isVisible().catch(() => false))) await click(c, '[data-testid="toggle-chat"]');
      await input.fill(`hi from ${c.name}`);
      await input.press("Enter");
      await sleep(250);
    }
    await sleep(800);
    const got = await Promise.all(clients.map((c) => c.page.locator(".msg").count().catch(() => 0)));
    const ok = got.every((n) => n >= 3);
    report.steps.push({ label: "chat reaches everyone", ok, ms: 0, clients: [] });
    console.log(`\n[${ok ? "PASS" : "FAIL"}] chat reaches everyone  (messages seen per client: ${got.join(", ")})`);
    await shoot("chat");
  },
  async restart() {
    if (!SPAWN_BACKEND) return;
    stopBackend();
    await sleep(3000);
    await startBackend();
    await waitHealthy("backend restart (3s outage)", 40000);
  },
  async rejoin() {
    const p = byRole("participant").at(-1);
    if (!p) return;
    await click(p, sel.leaveRoom);
    await sleep(1000);
    await joinRoom(p);
    await waitHealthy(`${p.name} leaves room and rejoins`);
  },
  async soak() {
    const t0 = Date.now();
    const samples = [];
    while (Date.now() - t0 < SOAK_S * 1000) {
      const m = await measure(5000);
      samples.push({ t: Date.now() - t0, ok: m.every((r) => r.ok), clients: m });
    }
    const bad = samples.filter((s) => !s.ok).length;
    const allFlows = samples.flatMap((s) => s.clients.flatMap((c) => c.flows ?? []));
    const summary = {
      label: `soak ${SOAK_S}s`, ok: bad === 0, ms: Date.now() - t0,
      unhealthySamples: `${bad}/${samples.length}`,
      avgFps: avg(allFlows.map((f) => f.fps)),
      p95Loss: pct(allFlows.map((f) => f.loss), 0.95),
      p95Conceal: pct(allFlows.map((f) => f.concealPct), 0.95),
      avgVideoKbps: avg(allFlows.map((f) => f.vkbps)),
      clients: samples.at(-1).clients,
    };
    report.steps.push(summary);
    console.log(`\n[${summary.ok ? "PASS" : "FAIL"}] ${summary.label}: unhealthy ${summary.unhealthySamples}, ` +
      `fps ${summary.avgFps.toFixed(1)}, video ${summary.avgVideoKbps.toFixed(0)}kbps, ` +
      `p95 loss ${(summary.p95Loss * 100).toFixed(1)}%, p95 audio concealment ${(summary.p95Conceal * 100).toFixed(1)}%`);
    await shoot("soak-end");
  },
};

function pct(xs, q) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ─── Run ────────────────────────────────────────────────────────────────────

try {
  if (SPAWN_BACKEND) {
    // Start from an empty room (chat history + any seats left by a killed run)
    const py = process.platform === "win32" ? path.join(backendDir, "venv/Scripts/python.exe") : path.join(backendDir, "venv/bin/python");
    execSync(`"${py}" -c "import redis; r=redis.from_url('redis://localhost:6379'); [r.delete(k) for p in ('room:*','sess:*','alive:*') for k in r.scan_iter(p)]"`);
    await startBackend();
  }
  for (const name of SCENARIOS) {
    if (!scenarios[name]) { console.log(`unknown scenario ${name}`); continue; }
    try {
      await scenarios[name]();
    } catch (e) {
      console.log(`\n[FAIL] scenario ${name} threw: ${e.message}`);
      report.steps.push({ label: name, ok: false, error: e.message });
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  report.clientErrors = Object.fromEntries(clients.map((c) => [c.name, c.errors.slice(0, 30)]));
  report.clientEvents = Object.fromEntries(
    await Promise.all(clients.map(async (c) => [c.name, await c.page.evaluate(() => window.__harness.events).catch(() => [])]))
  );
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  // Close pages first so they say goodbye and don't leave held seats behind
  await Promise.all(clients.map((c) => c.page.close({ runBeforeUnload: true }).catch(() => {})));
  await sleep(800);
  const passed = report.steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${report.steps.length} steps passed — report: ${path.join(OUT, "report.json")}`);
  await browser.close();
  stopBackend();
  process.exit(passed === report.steps.length ? 0 : 1);
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) o[k] = true;
    else { o[k] = v; i++; }
  }
  return o;
}
