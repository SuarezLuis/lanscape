import { prisma } from "../db";
import type { Automation } from "../generated/prisma/client";
import { runDeviceScan } from "./devices";
import { DEFAULT_INTERNET_HOST, runPingCheck } from "./ping";
import { runSpeedtest, speedtestRunning } from "./speedtest";

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

export const JOBS = ["speedtest", "ping", "devices"] as const;
export type Job = (typeof JOBS)[number];

// Full tests move ~2 GB each, so they start off; ping checks are nearly free
export const DEFAULTS: Record<Job, Automation> = {
  speedtest: { job: "speedtest", everyMinutes: null, offsetMinutes: 4 * 60, timeZone: "UTC", target: null },
  ping: { job: "ping", everyMinutes: 1, offsetMinutes: 0, timeZone: "UTC", target: DEFAULT_INTERNET_HOST },
  // An ARP sweep takes a couple of seconds and a few KB
  devices: { job: "devices", everyMinutes: 5, offsetMinutes: 0, timeZone: "UTC", target: null },
};

export const loadAutomations = async () => {
  const saved = await prisma.automation.findMany();
  return JOBS.map((job) => saved.find((row) => row.job === job) ?? DEFAULTS[job]);
};

const localMinute = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return value("hour") * 60 + value("minute");
};

// Every interval divides a day, so runs land on the same local times daily (offset 4:00 every 6h = 4, 10, 16, 22)
export const isDue = (automation: Automation, date: Date) => {
  const every = automation.everyMinutes;
  if (!every) return false;
  const minute = localMinute(date, automation.timeZone);
  return (((minute - automation.offsetMinutes) % every) + every) % every === 0;
};

export const nextRun = (automation: Automation, from = new Date()) => {
  if (!automation.everyMinutes) return null;
  const start = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS;
  for (let i = 1; i <= DAY_MINUTES; i++) {
    const candidate = new Date(start + i * MINUTE_MS);
    if (isDue(automation, candidate)) return candidate;
  }
  return null;
};

const run = (automation: Automation) => {
  if (automation.job === "speedtest") return runSpeedtest("automation");
  if (automation.job === "devices") return runDeviceScan();
  // A full test saturates the link, so pings taken during it would only measure the test
  if (speedtestRunning()) return;
  return runPingCheck("automation");
};

const logFailure = (job: string) => (error: unknown) =>
  console.error(`Scheduled ${job} failed:`, error instanceof Error ? error.message : error);

// Half a second past each minute, so a timer that fires a little early still lands in the right minute
const atNextMinute = (fn: () => void) => setTimeout(fn, MINUTE_MS - (Date.now() % MINUTE_MS) + 500);

export const startScheduler = () => {
  const tick = () => {
    atNextMinute(tick);
    const now = new Date();
    loadAutomations()
      .then((automations) => {
        for (const automation of automations.filter((a) => isDue(a, now))) {
          Promise.resolve(run(automation)).catch(logFailure(automation.job));
        }
      })
      .catch(logFailure("tick"));
  };
  atNextMinute(tick);
};
