import { expect, test } from "vitest";
import { prisma } from "./db";
import { overview, visitWindow } from "./overview";

const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const check = (at: Date, received: number) => ({ createdAt: at, target: "internet", host: "1.1.1.1", sent: 5, received, avgMs: received ? 11 : null });

test("an outage going on now shows the internet as down, with what's new since the last visit", async () => {
  await prisma.pingSample.createMany({ data: [check(ago(5), 5), check(ago(4), 0), check(ago(3), 0), check(ago(2), 0)] });
  await prisma.setting.create({ data: { key: "devices.lastScan", value: ago(1).toISOString() } });
  await prisma.device.createMany({
    data: [
      { mac: "aa:aa:aa:aa:aa:01", ip: "192.168.0.2", name: "Old TV", firstSeen: ago(60 * 24 * 10), lastSeen: ago(1), known: true },
      { mac: "aa:aa:aa:aa:aa:02", ip: "192.168.0.3", hostname: "new-phone", firstSeen: ago(30), lastSeen: ago(1) },
    ],
  });
  await prisma.serviceCheck.create({
    data: { name: "NAS", kind: "tcp", target: "192.168.0.5:22", failures: 2, failingSince: ago(10), results: { create: [{ at: ago(10), ok: false }, { at: ago(9), ok: false }] } },
  });

  const result = await overview(ago(60));
  expect(result.internet).toMatchObject({ status: "down", downSince: ago(4) });
  expect(result.devices).toMatchObject({ total: 2, online: 2, unknownOnline: 1, new: [{ name: "new-phone" }] });
  expect(result.services.trouble).toEqual([{ id: expect.any(Number), name: "NAS", status: "down", since: ago(10) }]);
});

test("a first visit looks back a day, and an old one at most 30 days", () => {
  expect(visitWindow(undefined, now).getTime()).toBe(now.getTime() - 86_400_000);
  expect(visitWindow(new Date(0), now).getTime()).toBe(now.getTime() - 30 * 86_400_000);
});
