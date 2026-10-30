// Screenshots of a demo instance (see seed.mjs) for the README and the Umbrel App Store.
//   npm install --no-save --no-package-lock puppeteer-core   (from the repo root; it is not a project dependency)
//   DEMO_URL=http://umbrel.local:4549 DEMO_PASSWORD=... node capture.mjs
// Writes docs/assets/screenshots/<page>-<light|dark>.png at 2160x1350.
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const BASE = process.env.DEMO_URL ?? "http://umbrel.local:4549";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-1";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../../docs/assets/screenshots/", import.meta.url);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickText = async (page, selector, text) => {
  const handles = await page.$$(selector);
  for (const handle of handles) {
    // startsWith: accordion headers also hold a status badge ("TelegramOn")
    if ((await handle.evaluate((node) => node.textContent?.trim() ?? "")).startsWith(text)) return handle.click();
  }
  throw new Error(`No ${selector} with text "${text}"`);
};

const SHOTS = [
  {
    name: "speedtests",
    path: "/speedtests",
    prepare: async (page) => {
      await clickText(page, "label", "Month");
      await pause(1500);
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
        if ((await cell.evaluate((node) => node.textContent?.trim())) === "192.168.1.31") {
          await cell.click();
          break;
        }
      }
      await pause(800);
    },
  },
  {
    name: "alerts",
    path: "/notifications",
  },
  {
    name: "channels",
    path: "/notifications",
    prepare: async (page) => {
      await clickText(page, "button", "Telegram");
      await pause(600);
      await page.evaluate(() => {
        [...document.querySelectorAll("h3")].find((heading) => heading.textContent === "Where alerts go")?.scrollIntoView();
        window.scrollBy(0, -24);
      });
      await pause(400);
    },
  },
  { name: "automations", path: "/automations" },
];

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await page.emulateTimezone("America/New_York");

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("input[type=password]");
await page.type("input[type=password]", PASSWORD);
await page.keyboard.press("Enter");
await page.waitForSelector("nav a", { timeout: 15_000 });

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
