// Composes App Store gallery images (2160x1350, Umbrel's current size) from the screenshots capture.mjs takes.
//   node scripts/demo/gallery.mjs   ->  docs/assets/gallery/1.jpg ... 5.jpg
// Only the LANscape logo and the app itself; alert channels are named in text, never shown with their branding.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ASSETS = new URL("../../docs/assets/", import.meta.url);
const logo = await readFile(new URL("../../web/public/favicon.svg", import.meta.url), "utf8");
const logoData = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 2160px; height: 1350px; overflow: hidden; font-family: -apple-system, "SF Pro Display", system-ui, sans-serif;
    background: radial-gradient(1400px 900px at 50% 0%, #1b4560 0%, #123247 45%, #0a1a26 100%); color: #f1f5f9; position: relative; }
  .brand { position: absolute; top: 56px; left: 72px; display: flex; align-items: center; gap: 18px; font-size: 40px; font-weight: 700; }
  .brand img { width: 64px; height: 64px; border-radius: 14px; }
  h1 { position: absolute; top: 150px; width: 100%; text-align: center; font-size: 96px; font-weight: 800; letter-spacing: -2px; line-height: 1.05; }
  h1 em { font-style: normal; color: #fbbf24; }
  .frame { position: absolute; left: 50%; transform: translateX(-50%); top: 400px; width: 1840px; border-radius: 22px 22px 0 0;
    overflow: hidden; box-shadow: 0 40px 120px rgba(0,0,0,.55); background: #1f2937; }
  .bar { height: 76px; display: flex; align-items: center; padding: 0 28px; gap: 14px; background: #e5e7eb; }
  .frame.dark .bar { background: #2a2f37; }
  .dot { width: 20px; height: 20px; border-radius: 50%; }
  .url { margin: 0 auto; width: 640px; height: 44px; border-radius: 12px; background: #fff; color: #374151; font-size: 24px;
    display: flex; align-items: center; justify-content: center; transform: translateX(-60px); }
  .frame.dark .url { background: #3b414b; color: #d1d5db; }
  .frame img.shot { display: block; width: 100%; }
</style></head><body>${body}</body></html>`;

const brand = `<div class="brand"><img src="${logoData}">LANscape</div>`;

const framed = (title, shot, scheme) =>
  page(`${brand}<h1>${title}</h1>
  <div class="frame ${scheme}"><div class="bar">
    <span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
    <div class="url">umbrel.local:4545</div></div>
    <img class="shot" src="${new URL(`screenshots/${shot}-${scheme}.png`, ASSETS).href}"></div>`);

// Phone-style notifications showing the alert text each channel receives; channels named, not drawn
const notification = ({ via, title, message, ago }) => `
  <div class="note"><img src="${logoData}"><div class="text">
    <div class="meta"><span>LANSCAPE · via ${via}</span><span>${ago}</span></div>
    <div class="title">${title}</div><div class="message">${message}</div></div></div>`;

const alerts = page(`${brand}<style>
  .stack { position: absolute; top: 420px; left: 50%; transform: translateX(-50%); width: 1180px; display: flex; flex-direction: column; gap: 28px; }
  .note { display: flex; gap: 28px; align-items: flex-start; padding: 32px 36px; border-radius: 36px; background: rgba(255,255,255,.92);
    color: #111827; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .note img { width: 76px; height: 76px; border-radius: 18px; flex: none; }
  .text { flex: 1; }
  .meta { display: flex; justify-content: space-between; font-size: 24px; color: #6b7280; letter-spacing: .5px; margin-bottom: 6px; }
  .title { font-size: 34px; font-weight: 700; margin-bottom: 4px; }
  .message { font-size: 30px; color: #374151; line-height: 1.3; }
</style>
<h1>Alerts on <em>your</em> phone</h1>
<div class="stack">
  ${notification({ via: "Telegram", ago: "now", title: "Download is low", message: "Download is 212 Mbps, more than 50% below normal (648 Mbps)." })}
  ${notification({ via: "ntfy", ago: "4m ago", title: "New device", message: "iPad joined your network at 192.168.1.64." })}
  ${notification({ via: "Discord", ago: "1h ago", title: "Front door camera is offline", message: "Front door camera (192.168.1.31) hasn't answered for 10 minutes." })}
  ${notification({ via: "Slack", ago: "2h ago", title: "Internet packet loss is back to normal", message: "Internet packet loss is back to 0%." })}
</div>`);

const SLIDES = [
  framed("Know your internet, <em>hour by hour</em>", "speedtests", "light"),
  framed("See <em>every device</em> on your network", "network", "dark"),
  framed("Hear about it when <em>something changes</em>", "alerts", "light"),
  alerts,
  framed("Set it and <em>forget it</em>", "automations", "dark"),
];

const out = new URL("gallery/", ASSETS);
await mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--allow-file-access-from-files"] });
const tab = await browser.newPage();
await tab.setViewport({ width: 2160, height: 1350, deviceScaleFactor: 1 });
for (const [i, html] of SLIDES.entries()) {
  const file = new URL(`slide-${i + 1}.html`, out);
  await writeFile(file, html);
  await tab.goto(file.href, { waitUntil: "load" });
  await tab.screenshot({ path: new URL(`${i + 1}.jpg`, out).pathname, type: "jpeg", quality: 90 });
  console.log(`${i + 1}.jpg`);
}
await browser.close();
// The HTML is only scaffolding for the JPGs
await Promise.all(SLIDES.map((_, i) => import("node:fs/promises").then(({ rm }) => rm(new URL(`slide-${i + 1}.html`, out)))));
