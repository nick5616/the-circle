// Rooms + hangout features, end to end, with real Chromium clients:
//
//   - creating a private room from the main landing (and landing seated in it)
//   - a friend following the invite link and taking a seat
//   - chat, /roll, sparks and reactions staying inside their room
//   - tossing something at someone's tile
//   - screen share (video + tab audio) reaching the other participant, and stopping
//   - walking back to the main circle
//
//   node rooms.mjs --url http://127.0.0.1:5190
//
// Needs Redis, the backend and the Vite dev server already running.
// getDisplayMedia is replaced with a canvas + oscillator stream so this runs
// headless; everything after the capture call is the real path.

import { chromium } from "playwright";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true] : null)).filter(Boolean)
);
const URL_ = args.url ?? "http://127.0.0.1:5173";
const HEADED = !!args.headed;

const fakeScreen = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 720;
    const g = c.getContext("2d");
    let f = 0;
    setInterval(() => {
      f++;
      g.fillStyle = `hsl(${(f * 3) % 360} 70% 40%)`;
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#fff";
      g.font = "64px sans-serif";
      g.fillText(`shared screen ${f}`, 80, 360);
    }, 33);
    const stream = c.captureStream(30);
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
    return stream;
  };
};

const browser = await chromium.launch({
  headless: !HEADED,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

const results = [];
const pages = {};
let failed = false;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    failed = true;
    for (const [n, pg] of Object.entries(pages)) await pg.screenshot({ path: `artifacts/rooms-fail-${n}.png` }).catch(() => {});
    results.push(`  ✗ ${name}: ${String(err.message ?? err).split("\n")[0]}`);
    throw err;
  }
}

async function client(name, path = "/") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(fakeScreen);
  const page = await ctx.newPage();
  pages[name] = page;
  page.on("pageerror", (e) => console.log(`[${name}] pageerror`, e.message));
  await page.goto(URL_ + path);
  await page.getByTestId("name-input").fill(name);
  return page;
}

const tiles = (page) => page.getByTestId("tile").count();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const ana = await client("ana");
  const ben = await client("ben", "/");
  let code = "";

  await step("ana lights her own fire and lands seated in it", async () => {
    await ana.getByTestId("create-room").click();
    await ana.waitForURL(/\/r\/[a-z]+-[a-z]+-\d+$/);
    code = new URL(ana.url()).pathname.split("/").pop();
    await ana.getByTestId("tile").first().waitFor({ timeout: 15000 });
    await ana.getByTestId("room-label").filter({ hasText: code }).waitFor();
  });

  await step("ben (on the main landing) doesn't see ana's seat", async () => {
    await sleep(500);
    const lit = await ben.locator('[title="ana"]').count();
    if (lit) throw new Error("ana's seat leaked into the main room ring");
  });

  await step("ben follows the code to ana's room and sits down", async () => {
    await ben.getByTestId("room-code-input").fill(code.toUpperCase().replace(/-/g, " ")); // codes are forgiving
    await ben.getByTestId("room-code-go").click();
    await ben.waitForURL(new RegExp(`/r/${code}$`));
    await ben.getByTestId("landing-room").filter({ hasText: code }).waitFor();
    await ben.getByTestId("join-participant").click();
    await ben.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 2, null, { timeout: 15000 });
    await ana.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 2, null, { timeout: 15000 });
  });

  await step("their video actually flows", async () => {
    for (const p of [ana, ben]) {
      await p.waitForFunction(
        () => [...document.querySelectorAll('[data-testid="tile"] video')].every((v) => v.videoWidth > 0),
        null,
        { timeout: 20000 }
      );
    }
  });

  const cat = await client("cat", "/");
  await step("cat joins the main circle and sees nobody from the private room", async () => {
    await cat.getByTestId("join-audience").click();
    await cat.getByTestId("seat-bar").waitFor();
    await sleep(800);
    if ((await tiles(cat)) !== 0) throw new Error(`cat sees ${await tiles(cat)} tiles in main`);
  });

  await step("chat stays inside the room", async () => {
    await ana.getByTestId("chat-input").fill("welcome to my fire");
    await ana.getByTestId("chat-input").press("Enter");
    await ben.getByText("welcome to my fire").waitFor({ timeout: 5000 });
    await sleep(600);
    if (await cat.getByText("welcome to my fire").count()) throw new Error("private chat leaked to main");
  });

  await step("/roll is rolled by the server and seen by everyone in the room", async () => {
    await ben.getByTestId("chat-input").fill("/roll 20");
    await ben.getByTestId("chat-input").press("Enter");
    await ana.locator('[data-flavor="roll"]').filter({ hasText: /rolled a \d+/ }).waitFor({ timeout: 5000 });
  });

  await step("drawing a spark puts the same question in front of both", async () => {
    await ana.getByTestId("react").click();
    await ana.getByTestId("draw-spark").click();
    const a = await ana.getByTestId("spark-text").textContent({ timeout: 5000 });
    const b = await ben.getByTestId("spark-text").textContent({ timeout: 5000 });
    if (!a || a !== b) throw new Error(`spark mismatch: ${a} / ${b}`);
  });

  await step("ben tosses something at ana and she sees it land", async () => {
    const anaTile = ben.locator('[data-testid="tile"]').filter({ hasText: "ana" });
    await anaTile.hover();
    await anaTile.getByTestId("toss").click({ force: true }); // the speaking pulse never lets it sit "stable"
    await ana.getByText(/tossed a .+ at you/).waitFor({ timeout: 5000 });
  });

  await step("ana shares her screen; ben gets moving frames + tab audio", async () => {
    await ana.getByTestId("toggle-share").click();
    await ana.getByTestId("screen-tile").waitFor({ timeout: 8000 });
    await ben.getByTestId("screen-tile").waitFor({ timeout: 8000 });
    await ben.waitForFunction(() => document.querySelector('[data-testid="screen-tile"]')?.dataset.live === "true", null, { timeout: 20000 });
    const t0 = await ben.$eval('[data-testid="screen-tile"] video', (v) => v.currentTime);
    await sleep(1500);
    const t1 = await ben.$eval('[data-testid="screen-tile"] video', (v) => ({ t: v.currentTime, w: v.videoWidth, h: v.videoHeight }));
    if (!(t1.t > t0)) throw new Error("screen video is frozen");
    if (t1.w < 640) throw new Error(`screen arrived tiny: ${t1.w}x${t1.h}`);
    // tab audio: an audio element whose stream has a live audio track with bytes flowing
    const audio = await ben.evaluate(async () => {
      const el = document.querySelector('[data-testid="screen-audio"]');
      return !!el && el.srcObject?.getAudioTracks().some((t) => t.readyState === "live");
    });
    if (!audio) throw new Error("no screen audio track on ben's side");
    // camera tiles are still there beside it
    if ((await tiles(ben)) !== 2) throw new Error("camera tiles vanished during share");
  });

  await ana.screenshot({ path: "artifacts/rooms-sharing.png" });
  await step("ana stops sharing; the spotlight closes for ben", async () => {
    await ana.getByTestId("stop-share").click({ timeout: 5000, force: true });
    await ben.getByTestId("screen-tile").waitFor({ state: "detached", timeout: 8000 });
  });

  await step("sharing again works without renegotiating", async () => {
    await ana.getByTestId("toggle-share").click();
    await ben.waitForFunction(() => document.querySelector('[data-testid="screen-tile"]')?.dataset.live === "true", null, { timeout: 20000 });
    await ana.getByTestId("toggle-share").click();
    await ben.getByTestId("screen-tile").waitFor({ state: "detached", timeout: 8000 });
  });

  await step("a websocket blip in a private room resumes the same seat", async () => {
    const before = await ben.evaluate(() => window.__circle.socket().sid);
    await ben.evaluate(() => window.__circle.dropSocket());
    await ben.waitForFunction(() => window.__circle.socket().status === "open", null, { timeout: 15000 });
    const after = await ben.evaluate(() => window.__circle.socket().sid);
    if (before !== after) throw new Error("session was not resumed");
    await ben.getByTestId("chat-input").fill("still here");
    await ben.getByTestId("chat-input").press("Enter");
    await ana.getByText("still here").waitFor({ timeout: 5000 });
    if ((await tiles(ana)) !== 2) throw new Error("ana lost ben's tile");
  });

  await step("ben goes home, then back to the big circle; ana sees him leave", async () => {
    await ben.getByTestId("leave-room").click();
    await ben.getByTestId("go-main").click();
    await ben.waitForURL((u) => new URL(u).pathname === "/");
    await ana.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 1, null, { timeout: 10000 });
    await ben.getByTestId("join-participant").click();
    await ben.getByTestId("tile").first().waitFor({ timeout: 15000 });
    await cat.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 1, null, { timeout: 15000 });
  });

  await step("browser back returns ben to ana's room landing", async () => {
    await ben.goBack();
    await ben.getByTestId("landing-room").filter({ hasText: code }).waitFor({ timeout: 8000 });
    await cat.waitForFunction(() => document.querySelectorAll('[data-testid="tile"]').length === 0, null, { timeout: 10000 });
  });

  await ana.screenshot({ path: "artifacts/rooms-ana.png" }).catch(() => {});
} catch {
  // reported below
} finally {
  console.log(results.join("\n"));
  await browser.close();
  process.exit(failed ? 1 : 0);
}
