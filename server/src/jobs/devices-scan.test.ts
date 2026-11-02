import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { prisma } from "../db";
import { runDeviceScan } from "./devices";

// The scan with its outside world stubbed: arp-scan prints a fixture, the route and mDNS names are fixed
let names = new Map<string, string>();
vi.mock("./ping", async (original) => ({ ...(await original()), findDefaultRoute: async () => ({ iface: "lanscape-test0", gateway: "192.168.0.1" }) }));
vi.mock("./mdns", () => ({ discoverNames: async () => names }));

const dir = mkdtempSync(join(tmpdir(), "lanscape-arp-"));
const fixture = join(dir, "answers.txt");
beforeAll(() => {
  const bin = join(dir, "arp-scan");
  writeFileSync(bin, `#!/bin/sh\ncat "${fixture}"\n`);
  chmodSync(bin, 0o755);
  process.env.ARP_SCAN_BIN = bin;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// One scan in which these devices answer ("ip mac"), announcing these mDNS names
const scan = (answers: string[], announced: Record<string, string> = {}) => {
  writeFileSync(fixture, answers.map((line) => line.replace(" ", "\t")).join("\n"));
  names = new Map(Object.entries(announced));
  return runDeviceScan();
};
const alerts = () => prisma.notification.findMany({ orderBy: { id: "asc" }, select: { kind: true, message: true } });

const TV = "192.168.0.20 a4:77:33:00:00:01";
const NAS = "192.168.0.21 00:11:32:00:00:02";
const LAPTOP = "192.168.0.30 3c:22:fb:00:00:03";

test("the first scan is the baseline; a device joining later alerts once, with its events", async () => {
  await scan([TV, NAS]);
  expect(await alerts()).toEqual([]);

  const result = await scan([TV, NAS, LAPTOP], { "192.168.0.30": "Ana-MacBook" });
  expect(result).toMatchObject({ found: 3, added: 1 });
  expect(await alerts()).toEqual([{ kind: "device", message: expect.stringContaining("Ana-MacBook") }]);

  await scan([TV, NAS, LAPTOP], { "192.168.0.30": "Ana-MacBook" });
  expect(await alerts()).toHaveLength(1);

  await scan([TV, LAPTOP]);
  expect(await prisma.deviceEvent.findMany({ where: { mac: "00:11:32:00:00:02" }, orderBy: { id: "asc" }, select: { online: true } })).toEqual([
    { online: true },
    { online: false },
  ]);
});

test("a phone back on a new private address keeps its name and history instead of alerting as new", async () => {
  await scan([TV, "192.168.0.40 da:00:00:00:00:01"], { "192.168.0.40": "Pixel-8" });
  await prisma.device.update({ where: { mac: "da:00:00:00:00:01" }, data: { name: "Ana's phone", known: true } });
  await scan([TV]);

  await scan([TV, "192.168.0.41 de:00:00:00:00:02"], { "192.168.0.41": "Pixel-8" });
  const phones = await prisma.device.findMany({ where: { hostname: "Pixel-8" }, include: { events: true } });
  expect(phones).toHaveLength(1);
  expect(phones[0]).toMatchObject({ mac: "de:00:00:00:00:02", ip: "192.168.0.41", name: "Ana's phone", known: true });
  expect(phones[0]!.events.map((event) => event.online)).toEqual([true, false, true]);
  expect(await alerts()).toEqual([]);
});

test("a watched device going offline alerts after its time, and again when it's back", async () => {
  await scan([TV, NAS]);
  await prisma.device.update({
    where: { mac: "00:11:32:00:00:02" },
    data: { name: "NAS", alertOfflineMinutes: 5, lastSeen: new Date(Date.now() - 10 * 60_000) },
  });
  await scan([TV]);
  await scan([TV, NAS]);
  expect((await alerts()).map((alert) => [alert.kind, alert.message])).toEqual([
    ["problem", "NAS (192.168.0.21) hasn't answered for 5 minutes."],
    ["resolved", "NAS (192.168.0.21) is back online."],
  ]);
});
