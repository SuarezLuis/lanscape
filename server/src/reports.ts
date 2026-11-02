import { z } from "zod";
import { comparePeriods, readPlan } from "./analytics";
import { prisma } from "./db";
import { healthScore } from "./health";
import { sendAll } from "./jobs/channels";
import { outagesBetween } from "./outages";

/**
 * Two reports: a weekly summary sent through the alert channels (this week against last), and a 30-day report to
 * download and send an internet provider (speeds against the plan, loss, and outages past the router).
 */

const SETTING = "report.weekly";
export const reportSettings = z.object({
  enabled: z.boolean(),
  weekday: z.int().min(0).max(6), // 0 = Sunday
  hour: z.int().min(0).max(23),
  timeZone: z.string().refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone"),
});
type ReportSettings = z.output<typeof reportSettings>;

export const readReportSettings = async (): Promise<ReportSettings> => {
  const row = await prisma.setting.findUnique({ where: { key: SETTING } });
  return row ? reportSettings.parse(JSON.parse(row.value)) : { enabled: false, weekday: 1, hour: 8, timeZone: "UTC" };
};

export const saveReportSettings = (settings: ReportSettings) => {
  const value = JSON.stringify(settings);
  return prisma.setting.upsert({ where: { key: SETTING }, create: { key: SETTING, value }, update: { value } });
};

const number = (value: number | null | undefined, digits = 0) => (value == null ? "–" : value.toFixed(digits));
// "+12%" / "−5%" against last week, or nothing when there's nothing to compare
const change = (now: number | null | undefined, before: number | null | undefined) => {
  if (now == null || before == null || before === 0) return "";
  const percent = Math.round((100 * (now - before)) / before);
  return percent === 0 ? " (same as last week)" : ` (${percent > 0 ? "+" : "−"}${Math.abs(percent)}% vs last week)`;
};
const day = (date: Date, timeZone: string) => date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });

export const weeklyReport = async (timeZone = "UTC", now = new Date()) => {
  const [{ current, previous }, health, healthBefore] = await Promise.all([
    comparePeriods("week", now),
    healthScore(7, now),
    healthScore(7, new Date(now.getTime() - 7 * 86_400_000)),
  ]);
  const tests = current.speedTests;
  const lines = [
    health ? `Internet health: ${health.score} (${health.grade})${healthBefore ? `, last week ${healthBefore.score}` : ""}` : "Internet health: not enough ping checks yet",
    tests.count
      ? `Speed: ${number(tests.downloadMbps)} down / ${number(tests.uploadMbps)} up Mbps on average${change(tests.downloadMbps, previous.speedTests.downloadMbps)}, ${tests.count} test${tests.count === 1 ? "" : "s"}`
      : "Speed: no speed tests this week",
    current.internetPing
      ? `Ping: ${number(current.internetPing.averageMs, 1)} ms, ${number(current.internetPing.packetLossPercent, 2)}% lost${change(current.internetPing.averageMs, previous.internetPing?.averageMs)}`
      : "Ping: no ping checks this week",
    current.outages.count
      ? `Outages: ${current.outages.count}, ${number(current.outages.minutes)} min in total (${current.outages.pastRouter} past your router, ${current.outages.homeNetwork} in your home network); last week ${previous.outages.count}`
      : `Outages: none${previous.outages.count ? ` (last week ${previous.outages.count})` : ""}`,
    `New devices: ${current.newDevices} · Alerts: ${Object.values(current.alerts).reduce((sum, count) => sum + count, 0)}`,
  ];
  return { title: `Your network, ${day(current.from, timeZone)} – ${day(current.to, timeZone)}`, message: lines.join("\n") };
};

export const sendWeeklyReport = async (now = new Date()) => {
  const { timeZone } = await readReportSettings();
  const { title, message } = await weeklyReport(timeZone, now);
  await prisma.notification.create({ data: { kind: "report", value: 0, message: `${title}\n${message}` } });
  await sendAll({ kind: "report", title, message });
  return { title, message };
};

const local = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday")), hour: Number(value("hour")), minute: Number(value("minute")) };
};

export const reportDue = (settings: ReportSettings, now: Date) => {
  if (!settings.enabled) return false;
  const at = local(now, settings.timeZone);
  return at.weekday === settings.weekday && at.hour === settings.hour && at.minute === 0;
};

// Called each minute by the scheduler
export const sendReportIfDue = async (now = new Date()) => {
  if (reportDue(await readReportSettings(), now)) await sendWeeklyReport(now);
};

// Plain text over 30 days, written for an internet provider's support team
export const ispReport = async (now = new Date()) => {
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const [plan, tests, pings, outages, health] = await Promise.all([
    readPlan(),
    prisma.speedTest.findMany({ where: { createdAt: { gte: from } }, orderBy: { createdAt: "asc" } }),
    prisma.pingSample.aggregate({ where: { target: "internet", createdAt: { gte: from } }, _avg: { avgMs: true }, _sum: { sent: true, received: true }, _count: true }),
    outagesBetween(from, now),
    healthScore(30, now),
  ]);
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const downloads = tests.map((test) => test.downloadMbps);
  const uploads = tests.map((test) => test.uploadMbps);
  const below = (values: number[], target: number | null) => (target ? values.filter((value) => value < 0.8 * target).length : null);
  const sent = pings._sum.sent ?? 0;
  const pastRouter = outages.filter((outage) => outage.cause === "internet");
  const when = (date: Date) => date.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return [
    `Internet connection report, ${when(from)} to ${when(now)}`,
    "Measured by LANscape on the customer's own network: speed tests against speedtest.net servers, and pings to the home router and to an internet host every minute.",
    "",
    "SPEED",
    plan.downloadMbps || plan.uploadMbps ? `Plan: ${plan.downloadMbps ?? "?"} Mbps down / ${plan.uploadMbps ?? "?"} Mbps up` : "Plan: not entered",
    `Speed tests: ${tests.length}`,
    `Download: average ${number(average(downloads))} Mbps, lowest ${number(downloads.length ? Math.min(...downloads) : null)} Mbps${plan.downloadMbps ? `; ${below(downloads, plan.downloadMbps)} of ${tests.length} tests under 80% of plan` : ""}`,
    `Upload: average ${number(average(uploads))} Mbps, lowest ${number(uploads.length ? Math.min(...uploads) : null)} Mbps${plan.uploadMbps ? `; ${below(uploads, plan.uploadMbps)} of ${tests.length} tests under 80% of plan` : ""}`,
    "",
    "LATENCY AND LOSS",
    `Ping checks: ${pings._count}; average ${number(pings._avg.avgMs, 1)} ms; packet loss ${sent ? number((100 * (sent - (pings._sum.received ?? 0))) / sent, 2) : "–"}%`,
    health ? `Health score: ${health.score}/100 (${health.grade})` : "",
    "",
    "OUTAGES PAST THE HOME ROUTER",
    "Times the router answered but the internet didn't (two or more lost checks in a row):",
    ...(pastRouter.length
      ? pastRouter.map((outage) => `- ${when(outage.start)}, ${number(((outage.end ?? now).getTime() - outage.start.getTime()) / 60_000)} min${outage.end ? "" : " (ongoing)"}`)
      : ["None."]),
    ...(outages.length > pastRouter.length ? ["", `(${outages.length - pastRouter.length} other outage(s) were inside the home network and aren't listed.)`] : []),
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
};
