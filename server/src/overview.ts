import { readPlan } from "./analytics";
import { prisma } from "./db";
import { healthScore } from "./health";
import { LAST_SCAN } from "./jobs/devices";
import { listServices } from "./jobs/services";
import { listOutages } from "./outages";

const DAY_MS = 86_400_000;

// Everything the home screen shows, in one round trip. `since`: the viewer's last visit, for "new since then"
export const overview = async (since: Date) => {
  const [lastInternet, health, latestTest, plan, outages, services, devices, lastScan, newDevices, unread, alerts, assistant] = await Promise.all([
    prisma.pingSample.findFirst({ where: { target: "internet", trigger: { not: "rollup" } }, orderBy: { createdAt: "desc" } }),
    healthScore(1),
    prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } }),
    readPlan(),
    listOutages("week"),
    listServices(),
    prisma.device.findMany({ select: { lastSeen: true, known: true } }),
    prisma.setting.findUnique({ where: { key: LAST_SCAN } }),
    prisma.device.findMany({ where: { firstSeen: { gte: since } }, orderBy: { firstSeen: "desc" }, take: 6 }),
    prisma.notification.count({ where: { read: false } }),
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { id: true, createdAt: true, kind: true, message: true } }),
    prisma.setting.findUnique({ where: { key: "ai.provider" } }),
  ]);
  const scannedAt = lastScan ? new Date(lastScan.value) : null;
  const online = devices.filter((device) => scannedAt !== null && device.lastSeen >= scannedAt);
  const ongoing = outages.find((outage) => outage.end === null) ?? null;
  const lastEnded = outages.find((outage) => outage.end !== null) ?? null;
  return {
    internet: {
      // Up unless an outage is going on now; unknown until the first ping check
      status: ongoing ? ("down" as const) : lastInternet ? ("up" as const) : ("unknown" as const),
      downSince: ongoing?.start ?? null,
      lastCheck: lastInternet?.createdAt ?? null,
      pingMs: lastInternet?.avgMs ?? null,
      health: health && { score: health.score, grade: health.grade },
    },
    speed: latestTest && {
      at: latestTest.createdAt,
      downloadMbps: latestTest.downloadMbps,
      uploadMbps: latestTest.uploadMbps,
      pingMs: latestTest.pingMs,
      planDownloadMbps: plan.downloadMbps,
      planUploadMbps: plan.uploadMbps,
    },
    outages: {
      thisWeek: outages.length,
      minutesThisWeek: outages.reduce((sum, outage) => sum + ((outage.end ?? new Date()).getTime() - outage.start.getTime()) / 60_000, 0),
      last: lastEnded && { start: lastEnded.start, minutes: (lastEnded.end!.getTime() - lastEnded.start.getTime()) / 60_000, cause: lastEnded.cause },
    },
    services: {
      total: services.filter((service) => service.enabled).length,
      up: services.filter((service) => service.enabled && service.status === "up").length,
      trouble: services
        .filter((service) => service.enabled && (service.status === "down" || service.status === "failing"))
        .map((service) => ({ id: service.id, name: service.name, status: service.status, since: service.failingSince })),
    },
    devices: {
      total: devices.length,
      online: online.length,
      unknownOnline: online.filter((device) => !device.known).length,
      lastScan: scannedAt,
      new: newDevices.map((device) => ({ mac: device.mac, name: device.name ?? device.hostname ?? device.vendor ?? device.ip, ip: device.ip, firstSeen: device.firstSeen })),
    },
    alerts: { unread, latest: alerts },
    assistant: assistant !== null,
    since,
  };
};

// The first visit counts as "a day ago"; a stored visit older than 30 days is clamped, so the list stays short
export const visitWindow = (since: Date | undefined, now = new Date()) =>
  new Date(Math.max(since?.getTime() ?? now.getTime() - DAY_MS, now.getTime() - 30 * DAY_MS));
