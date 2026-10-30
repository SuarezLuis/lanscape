// Fills a LANscape database with invented data for screenshots: devices, a year of history, rules and alerts.
// Nothing here comes from a real network. Run inside the image against a throwaway database:
//   docker exec -w /app <container> node /tmp/seed.mjs /tmp/demo.db
// Automations are timed so nothing scans or tests while screenshots are taken.
import Database from "better-sqlite3";

const db = new Database(process.argv[2] ?? "/tmp/demo.db");
const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");

// Seeded, so every run gives the same pictures
let seed = 20261030;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (low, high) => low + random() * (high - low);
const hex = () => Math.floor(random() * 256).toString(16).padStart(2, "0");
const mac = (prefix) => `${prefix}:${hex()}:${hex()}:${hex()}`;

const TIME_ZONE = "America/New_York";
const localMinutes = (ms) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(ms));
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return value("hour") * 60 + value("minute");
};
const localHour = (ms) => Math.floor(localMinutes(ms) / 60);
// Evenings are busier, like a real household
const load = (ms) => {
  const hour = localHour(ms);
  return hour >= 19 && hour <= 23 ? between(0.7, 0.88) : between(0.94, 1.02);
};

db.exec(`
  DELETE FROM SpeedTest; DELETE FROM PingSample; DELETE FROM DeviceEvent; DELETE FROM Device;
  DELETE FROM Notification; DELETE FROM Automation;
  DELETE FROM Setting WHERE key NOT LIKE 'auth.%';
`);

const SERVERS = [
  ["41870", "Riverside", "Lakeview Fiber", 18.4],
  ["52113", "Brookfield", "Metro Broadband", 26.9],
  ["38802", "Millbrook", "Northside Networks", 34.2],
];

// A year of speed tests, every 6 hours, with one bad evening yesterday
const tests = db.prepare(`INSERT INTO SpeedTest (createdAt, downloadMbps, uploadMbps, pingMs, jitterMs, serverId, serverName,
  serverSponsor, serverDistanceKm, trigger, routerPingMs, internetPingMs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const slowAt = now - 22 * HOUR;
db.transaction(() => {
  for (let at = now - 365 * DAY; at < now - 2 * HOUR; at += 6 * HOUR) {
    const factor = Math.abs(at - slowAt) < 3 * HOUR ? 0.33 : load(at) * (random() < 0.015 ? 0.4 : 1);
    const [id, name, sponsor, km] = SERVERS[Math.floor(random() * SERVERS.length)];
    tests.run(iso(at), between(610, 690) * factor, between(820, 900) * factor, between(9, 14) / Math.sqrt(factor),
      between(0.6, 2.2), id, name, sponsor, km, random() < 0.08 ? "manual" : "automation", between(0.4, 0.9), between(9, 13));
  }
  // The most recent test, run by hand
  tests.run(iso(now - 2 * HOUR), 648.2, 871.5, 10.8, 1.1, "41870", "Riverside", "Lakeview Fiber", 18.4, "manual", 0.52, 10.4);
})();

// Ping checks: raw every 5 minutes for two weeks, hourly rollups before that
const pings = db.prepare(`INSERT INTO PingSample (createdAt, target, host, sent, received, avgMs, jitterMs, trigger) VALUES (?,?,?,?,?,?,?,?)`);
db.transaction(() => {
  for (let at = now - 365 * DAY; at < now - 14 * DAY; at += HOUR) {
    pings.run(iso(at), "router", "192.168.1.1", 60, 60, between(0.4, 0.8), between(0.05, 0.2), "rollup");
    pings.run(iso(at), "internet", "1.1.1.1", 60, random() < 0.03 ? 57 : 60, between(9, 12) / load(at), between(0.3, 1.2), "rollup");
  }
  for (let at = now - 14 * DAY; at < now; at += 5 * MIN) {
    const lost = random() < 0.01 ? 1 : 0;
    pings.run(iso(at), "router", "192.168.1.1", 5, 5, between(0.4, 0.8), between(0.02, 0.15), "automation");
    pings.run(iso(at), "internet", "1.1.1.1", 5, 5 - lost, between(9, 12) / load(at), between(0.2, 1.4), "automation");
  }
})();

// Invented devices; MAC prefixes match each maker, the rest is random
const DEVICES = [
  // [ip, prefix, vendor, hostname, name, known, online, watched]
  ["192.168.1.1", "e4:fa:c4", "TP-Link Systems Inc", null, "Router", true, true, null],
  ["192.168.1.10", "dc:a6:32", "Raspberry Pi Trading Ltd", "umbrel", null, true, true, null],
  ["192.168.1.21", "f4:f5:d8", "Google, Inc.", "Living Room TV", null, true, true, null],
  ["192.168.1.22", "54:60:09", "Google, Inc.", "Kitchen speaker", null, true, true, null],
  ["192.168.1.23", "18:b4:30", "Nest Labs Inc.", null, "Hallway thermostat", true, true, null],
  ["192.168.1.31", "24:dc:c3", "Espressif Inc.", null, "Front door camera", true, true, 10],
  ["192.168.1.32", "68:fe:71", "Espressif Inc.", null, "Robot vacuum", true, true, null],
  ["192.168.1.41", "30:48:7d", "Tuya Smart Inc.", null, "Desk lamp", true, true, null],
  ["192.168.1.42", "b8:06:0d", "Tuya Smart Inc.", null, "Bedroom fan", true, false, null],
  ["192.168.1.43", "30:48:7d", "Tuya Smart Inc.", null, null, true, true, null],
  ["192.168.1.51", "3c:52:82", "HP Inc.", "Office printer", null, true, true, null],
  ["192.168.1.52", "a4:83:e7", "Apple, Inc.", "Studio Mac mini", null, true, true, null],
  ["192.168.1.53", "5c:aa:fd", "Sonos, Inc.", "Living Room Sonos", null, true, true, null],
  ["192.168.1.54", "98:5f:d3", "Microsoft Corporation", "Xbox", null, true, true, null],
  ["192.168.1.55", "f4:14:bf", "LG Innotek", null, "Washer", true, true, null],
  ["192.168.1.61", "da", "Private address", "Alex's iPhone", null, true, true, null],
  ["192.168.1.62", "7a", "Private address", "Sam's Pixel", null, true, false, null],
  ["192.168.1.63", "b6", "Private address", null, "Work laptop", true, true, null],
  ["192.168.1.64", "ee", "Private address", "iPad", null, false, true, null],
  ["192.168.1.57", "24:dc:c3", "Espressif Inc.", null, null, false, true, null],
];
const devices = db.prepare(`INSERT INTO Device (mac, ip, vendor, hostname, name, firstSeen, lastSeen, known, alertOfflineMinutes, offlineAlerted)
  VALUES (?,?,?,?,?,?,?,?,?,0)`);
const events = db.prepare(`INSERT INTO DeviceEvent (mac, at, online) VALUES (?,?,?)`);
const scanAt = now - 2 * MIN;
const macs = {};
db.transaction(() => {
  for (const [ip, prefix, vendor, hostname, name, known, online, watched] of DEVICES) {
    const address = prefix.length === 2 ? `${prefix}:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}` : mac(prefix);
    macs[name ?? hostname ?? ip] = address;
    const firstSeen = known ? now - between(20, 300) * DAY : now - between(1, 3) * HOUR;
    const lastSeen = online ? scanAt : now - between(2, 6) * HOUR;
    devices.run(address, ip, vendor, hostname, name, iso(firstSeen), iso(lastSeen), known ? 1 : 0, watched);
    // A few comings and goings in the last two days
    let at = Math.max(firstSeen, now - 2 * DAY);
    events.run(address, iso(at), 1);
    const flaps = vendor === "Private address" || name === "Front door camera" ? 4 : 1;
    for (let i = 0; i < flaps; i++) {
      at += between(3, 9) * HOUR;
      if (at > now - 3 * HOUR) break;
      events.run(address, iso(at), 0);
      at += between(0.2, 2) * HOUR;
      events.run(address, iso(at), 1);
    }
    if (!online) events.run(address, iso(lastSeen + 5 * MIN), 0);
  }
})();

// Rules: the starter ones plus one more, mostly on
db.exec(`UPDATE NotificationRule SET enabled = 1 WHERE metric IN ('download', 'internetLoss');`);
db.prepare(`INSERT INTO NotificationRule (metric, direction, mode, value, sustainMinutes, enabled) VALUES (?,?,?,?,?,1)`).run("internetPing", "above", "percent", 50, 10);
const ruleId = (metric) => db.prepare(`SELECT id FROM NotificationRule WHERE metric = ?`).get(metric)?.id ?? null;

const alerts = db.prepare(`INSERT INTO Notification (createdAt, ruleId, kind, value, baseline, message, read) VALUES (?,?,?,?,?,?,?)`);
const camera = "Front door camera";
[
  [now - 75 * MIN, null, "device", 0, null, `Espressif Inc. joined your network at 192.168.1.57 (${macs["192.168.1.57"]}).`, 0],
  [now - 3 * HOUR, null, "device", 0, null, `iPad joined your network at 192.168.1.64 (${macs.iPad}).`, 0],
  [slowAt + 6 * HOUR, ruleId("download"), "resolved", 641, null, "Download is back to 641 Mbps.", 1],
  [slowAt, ruleId("download"), "problem", 212, 648, "Download is 212 Mbps, more than 50% below normal (648 Mbps).", 1],
  [now - 2 * DAY - 4 * HOUR, null, "resolved", 0, null, `${camera} (192.168.1.31) is back online.`, 1],
  [now - 2 * DAY - 5 * HOUR, null, "problem", 0, null, `${camera} (192.168.1.31) hasn't answered for 10 minutes.`, 1],
  [now - 4 * DAY + 20 * MIN, ruleId("internetLoss"), "resolved", 0, null, "Internet packet loss is back to 0%.", 1],
  [now - 4 * DAY, ruleId("internetLoss"), "problem", 20, null, "Internet packet loss is 20%, above 5% for 5 minutes.", 1],
].forEach(([at, rule, kind, value, baseline, message, read]) => alerts.run(iso(at), rule, kind, value, baseline, message, read));

// Schedules shown as on, timed so none of them runs while screenshots are taken
const minuteNow = localMinutes(now);
const automations = db.prepare(`INSERT INTO Automation (job, everyMinutes, offsetMinutes, timeZone, target) VALUES (?,?,?,?,?)`);
// On the hour, since the page picks a starting hour; at least two hours out
automations.run("speedtest", 360, ((Math.floor(minuteNow / 60) + 3) % 24) * 60, TIME_ZONE, null);
automations.run("devices", 60, (minuteNow + 40) % 60, TIME_ZONE, null);
automations.run("ping", 5, (minuteNow + 3) % 5, TIME_ZONE, "1.1.1.1");

const settings = db.prepare(`INSERT INTO Setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const status = (summary, ago) => JSON.stringify({ at: new Date(now - ago).toISOString(), ok: true, summary });
[
  ["devices.lastScan", new Date(scanAt).toISOString()],
  ["devices.firstScan", new Date(now - 300 * DAY).toISOString()],
  ["ntfy.url", "https://ntfy.sh/lanscape-alerts"],
  ["telegram.token", "123456:demo-token"],
  ["telegram.chatId", "100200300"],
  ["status.job.speedtest", status("648 down / 872 up Mbps", 2 * HOUR)],
  ["status.job.ping", status("Router 0.5 ms, Internet 10.4 ms", 3 * MIN)],
  ["status.job.devices", status("18 devices answered", 2 * MIN)],
  ["status.channel.ntfy", JSON.stringify({ at: new Date(now - 75 * MIN).toISOString(), ok: true })],
  ["status.channel.telegram", JSON.stringify({ at: new Date(now - 75 * MIN).toISOString(), ok: true })],
].forEach(([key, value]) => settings.run(key, value));

console.log("Demo data ready:", {
  speedTests: db.prepare("SELECT COUNT(*) n FROM SpeedTest").get().n,
  pings: db.prepare("SELECT COUNT(*) n FROM PingSample").get().n,
  devices: db.prepare("SELECT COUNT(*) n FROM Device").get().n,
  alerts: db.prepare("SELECT COUNT(*) n FROM Notification").get().n,
});
