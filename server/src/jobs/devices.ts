import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { hostname, networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { prisma } from "../db";
import type { Device } from "../generated/prisma/client";
import { sendAll } from "./channels";
import { discoverNames } from "./mdns";
import { findDefaultRoute } from "./ping";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export const LAST_SCAN = "devices.lastScan";
const FIRST_SCAN = "devices.firstScan";
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

const deviceLabel = (device: Pick<Device, "name" | "hostname" | "vendor" | "ip">) =>
  device.name ?? device.hostname ?? device.vendor ?? device.ip;

const wasOnline = (device: Device, previousScan: Date | null) => previousScan !== null && device.lastSeen >= previousScan;

// null when nothing to say; "offline" once it has been gone alertOfflineMinutes, "back" when it returns after that
export const offlineStep = (
  device: Pick<Device, "alertOfflineMinutes" | "offlineAlerted" | "lastSeen">,
  online: boolean,
  now: Date,
) => {
  if (!device.alertOfflineMinutes) return null;
  if (online) return device.offlineAlerted ? ("back" as const) : null;
  const goneMs = now.getTime() - device.lastSeen.getTime();
  return !device.offlineAlerted && goneMs >= device.alertOfflineMinutes * 60_000 ? ("offline" as const) : null;
};

export const newDeviceAlert = (added: { ip: string; mac: string; label: string }[]) => {
  const line = (device: (typeof added)[number]) => `${device.label} at ${device.ip} (${device.mac})`;
  return added.length === 1
    ? { title: "New device", message: `${line(added[0]!)} joined your network.` }
    : { title: `${added.length} new devices`, message: `These joined your network:\n${added.map(line).join("\n")}` };
};

const alert = async (kind: "problem" | "resolved" | "device", title: string, message: string) => {
  await prisma.notification.create({ data: { kind, value: 0, message } });
  await sendAll({ kind, title, message });
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
  const [existing, firstScan, previousScan] = await Promise.all([
    prisma.device.findMany(),
    prisma.setting.upsert({
      where: { key: FIRST_SCAN },
      create: { key: FIRST_SCAN, value: scanAt.toISOString() },
      update: {},
    }),
    prisma.setting.findUnique({ where: { key: LAST_SCAN } }),
  ]);
  const previousAt = previousScan ? new Date(previousScan.value) : null;
  const byMac = new Map(existing.map((device) => [device.mac, device]));
  const foundMacs = new Set(found.map((device) => device.mac));
  const added = [];
  const events: { mac: string; online: boolean; at: Date }[] = [];

  for (const { ip, mac } of found) {
    const hostname = names.get(ip);
    // Re-checked every scan, so devices still unknown pick up a maker after an image update
    const vendor = vendorFor(mac);
    await prisma.device.upsert({
      where: { mac },
      create: { mac, ip, vendor, hostname, firstSeen: scanAt, lastSeen: scanAt },
      update: { ip, lastSeen: scanAt, ...(vendor ? { vendor } : {}), ...(hostname ? { hostname } : {}) },
    });
    const before = byMac.get(mac);
    if (!before) added.push({ ip, mac, label: hostname ?? vendor ?? "Unknown device" });
    if (!before || !wasOnline(before, previousAt)) events.push({ mac, online: true, at: scanAt });
  }
  for (const device of existing) {
    if (!foundMacs.has(device.mac) && wasOnline(device, previousAt)) events.push({ mac: device.mac, online: false, at: scanAt });
  }
  if (events.length) await prisma.deviceEvent.createMany({ data: events });
  await prisma.setting.upsert({
    where: { key: LAST_SCAN },
    create: { key: LAST_SCAN, value: scanAt.toISOString() },
    update: { value: scanAt.toISOString() },
  });

  // Offline alerts for devices the user chose to watch: one when it's been gone long enough, one when it's back
  for (const device of existing) {
    const step = offlineStep(device, foundMacs.has(device.mac), scanAt);
    if (!step) continue;
    await prisma.device.update({ where: { mac: device.mac }, data: { offlineAlerted: step === "offline" } });
    const label = deviceLabel(device);
    await alert(
      step === "offline" ? "problem" : "resolved",
      step === "offline" ? `${label} is offline` : `${label} is back online`,
      step === "offline"
        ? `${label} (${device.ip}) hasn't answered for ${device.alertOfflineMinutes} minutes.`
        : `${label} (${device.ip}) is back online.`,
    );
  }

  // The first scan is what was already there. Sleeping devices that turn up later do alert, one alert per scan
  const firstEver = firstScan.value === scanAt.toISOString();
  const alertsOn = (await prisma.setting.findUnique({ where: { key: NEW_DEVICE_ALERTS } }))?.value !== "off";
  if (!firstEver && alertsOn && added.length) {
    const { title, message } = newDeviceAlert(added);
    await alert("device", title, message);
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
