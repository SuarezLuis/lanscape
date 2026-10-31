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
export const UNKNOWN_BACK_ALERTS = "notify.unknownBack";
// Dozing phones and plugs drop out of a scan or two; an unknown device gone this long and back is worth a look
const UNKNOWN_AWAY_MS = 60 * 60 * 1000;

let oui: Record<string, string> | null = null;

// Phones and laptops use a random, "locally administered" MAC per network, which no maker owns
const isPrivateMac = (mac: string) => (Number.parseInt(mac.slice(0, 2), 16) & 0x02) !== 0;

export const vendorFor = (mac: string) => {
  if (isPrivateMac(mac)) return "Private address";
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

/**
 * Private MACs change (on rotation, or after the phone forgets the network). A new private MAC announcing the same
 * name as exactly one private-MAC device that isn't answering is taken to be that device on a new address.
 * Returns new MAC -> old MAC.
 * ponytail: matches on the announced name alone, so two phones that both call themselves "Android" can be mistaken
 * for one when only one is around; matching on more (vendor class, mDNS services) if that shows up.
 */
export const matchNewAddresses = (
  found: { mac: string; name: string | undefined }[],
  existing: Pick<Device, "mac" | "hostname">[],
) => {
  const foundMacs = new Set(found.map((device) => device.mac));
  const knownMacs = new Set(existing.map((device) => device.mac));
  const moves = new Map<string, string>();
  for (const { mac, name } of found) {
    if (knownMacs.has(mac) || !name || !isPrivateMac(mac)) continue;
    const taken = new Set(moves.values());
    const candidates = existing.filter(
      (device) => device.hostname === name && isPrivateMac(device.mac) && !foundMacs.has(device.mac) && !taken.has(device.mac),
    );
    if (candidates.length === 1) moves.set(mac, candidates[0]!.mac);
  }
  return moves;
};

const wasOnline = (device: Device, previousScan: Date | null) => previousScan !== null && device.lastSeen >= previousScan;

// A device the user watches for arrivals, back after at least the time they chose (so dozing doesn't count)
export const onlineAlertDue = (device: Device, previousScan: Date | null, now: Date) =>
  device.alertOnlineMinutes !== null &&
  !wasOnline(device, previousScan) &&
  now.getTime() - device.lastSeen.getTime() >= device.alertOnlineMinutes * 60_000;

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

type Listed = { ip: string; mac: string; label: string };

const listLine = (device: Listed) => `${device.label} at ${device.ip} (${device.mac})`;

export const newDeviceAlert = (added: Listed[]) =>
  added.length === 1
    ? { title: "New device", message: `${listLine(added[0]!)} joined your network.` }
    : { title: `${added.length} new devices`, message: `These joined your network:\n${added.map(listLine).join("\n")}` };

const MARK_KNOWN = "Mark it as known on the Network page to stop these alerts for it.";

export const unknownBackAlert = (returned: Listed[]) =>
  returned.length === 1
    ? { title: "Unknown device is back", message: `${listLine(returned[0]!)} is back on your network. ${MARK_KNOWN}` }
    : {
        title: `${returned.length} unknown devices are back`,
        message: `These unknown devices are back on your network:\n${returned.map(listLine).join("\n")}`,
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
  const [stored, firstScan, previousScan] = await Promise.all([
    prisma.device.findMany(),
    prisma.setting.upsert({
      where: { key: FIRST_SCAN },
      create: { key: FIRST_SCAN, value: scanAt.toISOString() },
      update: {},
    }),
    prisma.setting.findUnique({ where: { key: LAST_SCAN } }),
  ]);
  const previousAt = previousScan ? new Date(previousScan.value) : null;

  // A device on a new private address keeps its name, settings and history; its events follow the MAC (ON UPDATE CASCADE)
  const moves = matchNewAddresses(found.map(({ ip, mac }) => ({ mac, name: names.get(ip) })), stored);
  const movedTo = new Map([...moves].map(([next, previous]) => [previous, next]));
  for (const [next, previous] of moves) await prisma.device.update({ where: { mac: previous }, data: { mac: next } });
  const existing = stored.map((device) => ({ ...device, mac: movedTo.get(device.mac) ?? device.mac }));

  const byMac = new Map(existing.map((device) => [device.mac, device]));
  const foundMacs = new Set(found.map((device) => device.mac));
  const added: Listed[] = [];
  const returned: Listed[] = [];
  const arrived: Listed[] = [];
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
    if (before && onlineAlertDue(before, previousAt, scanAt)) {
      arrived.push({ ip, mac, label: deviceLabel({ ...before, hostname: hostname ?? before.hostname }) });
    }
    if (before && !before.known && scanAt.getTime() - before.lastSeen.getTime() >= UNKNOWN_AWAY_MS) {
      returned.push({ ip, mac, label: deviceLabel({ ...before, hostname: hostname ?? before.hostname }) });
    }
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
  const { newDevice, unknownBack } = await readDeviceAlerts();
  if (!firstEver && newDevice && added.length) {
    const { title, message } = newDeviceAlert(added);
    await alert("device", title, message);
  }
  // Asked for per device, so no switch: each one the user chose
  for (const device of arrived) await alert("device", `${device.label} is online`, `${listLine(device)} came online.`);
  if (unknownBack && returned.length) {
    const { title, message } = unknownBackAlert(returned);
    await alert("device", title, message);
  }
  return { found: found.length, added: added.length, online: found.map((device) => device.mac) };
};

// New-device alerts are on unless turned off; unknown-device-back alerts are off until turned on
export const readDeviceAlerts = async () => {
  const rows = await prisma.setting.findMany({ where: { key: { in: [NEW_DEVICE_ALERTS, UNKNOWN_BACK_ALERTS] } } });
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  return { newDevice: value(NEW_DEVICE_ALERTS) !== "off", unknownBack: value(UNKNOWN_BACK_ALERTS) === "on" };
};

let scanning: ReturnType<typeof scan> | null = null;

// A scan requested while one runs joins it
export const runDeviceScan = ({ thorough = false } = {}) => {
  scanning ??= scan(thorough).finally(() => {
    scanning = null;
  });
  return scanning;
};
