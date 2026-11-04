// Screenshots of a demo instance (see seed.mjs) for the README and the Umbrel App Store.
//   npm install --no-save --no-package-lock puppeteer-core   (from the repo root; it is not a project dependency)
//   DEMO_URL=http://umbrel.local:4549 DEMO_PASSWORD=... node capture.mjs
// with scripts/demo/model.mjs running where the app can reach it (DEMO_MODEL_URL, as the app sees it).
// Writes docs/assets/screenshots/<page>-<light|dark>.png at 2160x1350.
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = process.env.DEMO_URL ?? "http://umbrel.local:4549";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-1";
const MODEL_URL = process.env.DEMO_MODEL_URL ?? "http://127.0.0.1:4602/v1";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../../docs/assets/screenshots/", import.meta.url);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickText = async (page, selector, text) => {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    // startsWith: a label can hold a badge after its text
    if ((await handle.evaluate((node) => node.textContent?.trim() ?? "")).startsWith(text)) return handle.click();
  }
  throw new Error(`No ${selector} with text "${text}"`);
};

// The card holding a heading, scrolled to the top of the page (with room below, for the last card)
const scrollToCard = (page, heading) =>
  page.evaluate((text) => {
    document.querySelector("main").style.paddingBottom = "100vh";
    [...document.querySelectorAll("h3")].find((node) => node.textContent === text)?.closest(".mantine-Card-root")?.scrollIntoView();
    // Clear of the sticky header
    window.scrollBy(0, -84);
  }, heading);

const QUESTION = "When was my internet slow this month, and was it my ISP or my home network?";
const CHANGE = "The new iPad is Maya's. Name it, mark it as known, and tell me when it comes back online after being away an hour.";

// A fresh conversation each time, so each picture holds only its own question
const ask = async (page, question, done) => {
  const fresh = await page.$("::-p-text(New chat)");
  if (fresh && !(await fresh.evaluate((node) => node.closest("button")?.disabled))) await fresh.click();
  await page.type("textarea[aria-label='Your question']", question);
  await page.keyboard.press("Enter");
  await page.waitForSelector(done, { timeout: 15_000 });
  await pause(800);
};

const SHOTS = [
  { name: "overview", path: "/overview" },
  {
    name: "speedtests",
    path: "/speedtests",
    prepare: async (page) => {
      await clickText(page, "label", "Month");
      await pause(1500);
    },
  },
  {
    name: "outages",
    path: "/speedtests",
    prepare: async (page) => {
      await scrollToCard(page, "Outages");
      // The outage card's own range, not the history chart's
      const year = await page.$$("label");
      for (const label of year.reverse()) {
        if ((await label.evaluate((node) => node.textContent?.trim())) === "Year") {
          await label.click();
          break;
        }
      }
      await pause(1200);
      await scrollToCard(page, "Outages");
    },
  },
  { name: "network", path: "/network" },
  {
    name: "device",
    path: "/network",
    prepare: async (page) => {
      // The IP cell, since clicking the name renames the device
      const cells = await page.$$("td");
      for (const cell of cells) {
        if ((await cell.evaluate((node) => node.textContent?.trim())) === "192.168.1.10") {
          await cell.click();
          break;
        }
      }
      await pause(1200);
      // The Umbrel's open ports, at the top of the panel
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll(".mantine-Drawer-body h5")].find((node) => node.textContent === "Open ports");
        heading?.scrollIntoView();
      });
      await pause(400);
    },
  },
  { name: "services", path: "/services" },
  {
    name: "assistant",
    path: "/assistant",
    prepare: async (page) => {
      await ask(page, QUESTION, "::-p-text(Looked at)");
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    name: "assistant-change",
    path: "/assistant",
    prepare: async (page) => {
      await ask(page, CHANGE, "::-p-text(Approve)");
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
  { name: "alerts", path: "/notifications" },
  { name: "automations", path: "/automations" },
];

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await page.emulateTimezone("America/New_York");
// The Overview lists what's new since the last visit, saved as it's left; a day ago shows the demo's new devices
await page.evaluateOnNewDocument(() => localStorage.setItem("lanscape.lastVisit", new Date(Date.now() - 86_400_000).toISOString()));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("input[type=password]");
await page.type("input[type=password]", PASSWORD);
await page.keyboard.press("Enter");
await page.waitForSelector("nav a", { timeout: 15_000 });

// The Assistant answers from scripts/demo/model.mjs, which must be running where the app can reach it
const saved = await page.evaluate(async (url) => {
  const response = await fetch("/trpc/ai.save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { provider: "openai", url, model: "demo-model", apiKey: "" } }),
  });
  return response.ok || (await response.text());
}, MODEL_URL);
if (saved !== true) throw new Error(`Couldn't connect the demo model: ${saved}`);

for (const scheme of ["light", "dark"]) {
  await page.evaluate((value) => localStorage.setItem("mantine-color-scheme-value", value), scheme);
  for (const shot of SHOTS) {
    // Not networkidle: the live speed test stream keeps a connection open
    await page.goto(`${BASE}${shot.path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main .mantine-Card-root", { timeout: 15_000 });
    await pause(2000); // data loads, charts animate in
    await shot.prepare?.(page);
    await page.mouse.move(0, 0); // no hover states in the picture
    await page.screenshot({ path: new URL(`${shot.name}-${scheme}.png`, OUT).pathname });
    console.log(`${shot.name}-${scheme}.png`);
  }
}
await browser.close();
