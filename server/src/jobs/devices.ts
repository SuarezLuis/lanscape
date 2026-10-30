import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { hostname, networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { prisma } from "../db";
import { sendAll } from "./channels";
import { discoverNames } from "./mdns";
import { findDefaultRoute } from "./ping";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const LAST_SCAN = "devices.lastScan";
const FIRST_SCAN = "devices.firstScan";
// Sleeping phones and plugs miss early scans; joining in the first day isn't news
const LEARNING_MS = 24 * 60 * 60 * 1000;
export const NEW_DEVICE_ALERTS = "notify.newDevice";

let oui: Record<string, string> | null = null;

// Phones and laptops use a random, "locally administered" MAC per network, which no maker owns
export const vendorFor = (mac: string) => {
  if (Number.parseInt(mac.slice(0, 2), 16) & 0x02) return "Private address";
  // ~6 MB of JSON, so it loads on the first scan rather than at startup
  oui ??= require("oui-data") as Record<string, string>;
  return oui[mac.replaceAll(":", "").slice(0, 6).toUpperCase()]?.split("\n")[0] ?? null;
};

// arp-scan --plain prints "ip<TAB>mac<TAB>vendor"; a device can answer twice, so keep one row per MAC
export const parseArpScan = (stdout: string) => {
  const devices = new Map<string, { ip: string; mac: string }>();
  for (const line of stdout.split("\n")) {
    const [ip, mac] = line.split("\t");
    if (ip && mac && /^([\da-f]{2}:){5}[\da-f]{2}$/i.test(mac) && !devices.has(mac.toLowerCase())) {
      devices.set(mac.toLowerCase(), { ip, mac: mac.toLowerCase() });
    }
  }
  return [...devices.values()];
};

// The scanning machine never answers its own ARP sweep, so it's added from its interface (the host's, in Docker host networking)
export const selfOn = (iface: string, interfaces = networkInterfaces()) => {
  const address = interfaces[iface]?.find((entry) => entry.family === "IPv4" && !entry.internal);
  return address ? { ip: address.address, mac: address.mac.toLowerCase() } : null;
};

const sweep = async (iface: string, retries: number) => {
  const { stdout } = await execFileAsync("arp-scan", ["--interface", iface, "--localnet", "--plain", "--retry", String(retries)], {
    timeout: 60_000,
  });
  return parseArpScan(stdout);
};

// Thorough scans sweep twice with more retries: dozing phones and plugs skip replies, and the identify tool
// would read a skipped reply as "turned off"
const scan = async (thorough: boolean) => {
  const route = await findDefaultRoute();
  if (!route) throw new Error("No default route, so there's no network to scan");
  const sweeps = thorough ? [await sweep(route.iface, 4), await sweep(route.iface, 4)] : [await sweep(route.iface, 2)];
  const found = [...new Map(sweeps.flat().map((device) => [device.mac, device])).values()];
  const self = selfOn(route.iface);
  if (self && !found.some((device) => device.mac === self.mac)) found.push(self);
  const names = await discoverNames(found.map((device) => device.ip));
  if (self) names.set(self.ip, hostname());

  const scanAt = new Date();
  const [known, firstScan] = await Promise.all([
    prisma.device.findMany({ select: { mac: true } }),
    prisma.setting.upsert({
      where: { key: FIRST_SCAN },
      create: { key: FIRST_SCAN, value: scanAt.toISOString() },
      update: {},
    }),
  ]);
  const knownMacs = new Set(known.map((device) => device.mac));
  const added = [];

  for (const { ip, mac } of found) {
    const hostname = names.get(ip);
    // Re-checked every scan, so devices still unknown pick up a maker after an image update
    const vendor = vendorFor(mac);
    await prisma.device.upsert({
      where: { mac },
      create: { mac, ip, vendor, hostname, firstSeen: scanAt, lastSeen: scanAt },
      update: { ip, lastSeen: scanAt, ...(vendor ? { vendor } : {}), ...(hostname ? { hostname } : {}) },
    });
    if (!knownMacs.has(mac)) added.push({ ip, mac, label: hostname ?? vendor ?? "Unknown device" });
  }
  await prisma.setting.upsert({
    where: { key: LAST_SCAN },
    create: { key: LAST_SCAN, value: scanAt.toISOString() },
    update: { value: scanAt.toISOString() },
  });

  const learning = scanAt.getTime() - new Date(firstScan.value).getTime() < LEARNING_MS;
  const alertsOn = (await prisma.setting.findUnique({ where: { key: NEW_DEVICE_ALERTS } }))?.value !== "off";
  if (!learning && alertsOn) {
    for (const device of added) {
      const message = `${device.label} joined your network at ${device.ip} (${device.mac}).`;
      await prisma.notification.create({ data: { kind: "device", value: 0, message } });
      await sendAll({ kind: "device", title: "New device", message });
    }
  }
  return { found: found.length, added: added.length, online: found.map((device) => device.mac) };
};

let scanning: ReturnType<typeof scan> | null = null;

// A scan requested while one runs joins it
export const runDeviceScan = ({ thorough = false } = {}) => {
  scanning ??= scan(thorough).finally(() => {
    scanning = null;
  });
  return scanning;
};
