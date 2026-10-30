import { prisma } from "./db";

// RFC 4180 quoting. Text starting with = + - @ gets a leading ' so spreadsheets don't run it as a formula:
// device names come from the network, so they're untrusted
export const field = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
};

const csv = (columns: string[], rows: Record<string, unknown>[]) =>
  [columns.join(","), ...rows.map((row) => columns.map((column) => field(row[column])).join(","))].join("\r\n") + "\r\n";

export const EXPORTS = {
  "speedtests.csv": async () =>
    csv(
      ["createdAt", "downloadMbps", "uploadMbps", "pingMs", "jitterMs", "routerPingMs", "internetPingMs", "serverId", "serverName", "serverSponsor", "serverDistanceKm", "trigger"],
      await prisma.speedTest.findMany({ orderBy: { createdAt: "asc" } }),
    ),
  "pings.csv": async () =>
    csv(
      ["createdAt", "target", "host", "sent", "received", "avgMs", "jitterMs", "trigger"],
      await prisma.pingSample.findMany({ orderBy: { createdAt: "asc" } }),
    ),
  "devices.csv": async () =>
    csv(
      ["mac", "ip", "name", "hostname", "vendor", "known", "firstSeen", "lastSeen"],
      await prisma.device.findMany({ orderBy: { ip: "asc" } }),
    ),
} as const;

export type ExportName = keyof typeof EXPORTS;
export const isExportName = (name: string): name is ExportName => name in EXPORTS;
