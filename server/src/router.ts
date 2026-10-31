import { on } from "node:events";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import {
  assertNotLockedOut,
  checkPassword,
  createSession,
  endAllSessions,
  endSession,
  passwordIsSet,
  recordLogin,
  sessionCookie,
  sessionValid,
  setPassword,
  umbrelPassword,
} from "./auth";
import { BackupError, listSafetyBackups, undoRestore } from "./backup";
import { prisma } from "./db";
import { latencyHistory, RANGES, since } from "./latency";
import { CHANNEL_IDS, describeChannels, saveChannel, sendTest } from "./jobs/channels";
import { METRIC_KEYS, METRICS } from "./jobs/notify";
import { LAST_SCAN, NEW_DEVICE_ALERTS, readDeviceAlerts, runDeviceScan, UNKNOWN_BACK_ALERTS } from "./jobs/devices";
import { findGateway } from "./jobs/ping";
import { readStatus } from "./jobs/status";
import { findTelegramChats } from "./jobs/telegram";
import { loadAutomations, nextRun } from "./jobs/scheduler";
import {
  cancelSpeedtest,
  currentProgress,
  listServers,
  runSpeedtest,
  SERVER_SETTING, type SpeedtestProgress, speedtestEvents } from "./jobs/speedtest";

export type Context = { token: string | null; ip: string; setCookie: (cookie: string) => void };

const t = initTRPC.context<Context>().create({ transformer: superjson });

const publicProcedure = t.procedure;
// Everything except signing in needs a session; host-network apps skip Umbrel's own login
const procedure = t.procedure.use(async ({ ctx, next }) => {
  if (!(await sessionValid(ctx.token))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first" });
  return next();
});

const password = z.string().min(8, "Use at least 8 characters").max(200);

const startSession = async (ctx: Context) => {
  const token = await createSession();
  ctx.setCookie(sessionCookie(token));
};

const rangeInput = z.object({ range: z.enum(RANGES) });

const validTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

// The host goes straight into ping's arguments, so only addresses and hostnames get through
const pingHost = z.union([z.ipv4(), z.ipv6(), z.hostname()]).refine((host) => !host.startsWith("-"));

const ruleInput = z.object({
  id: z.int().optional(),
  metric: z.enum(METRIC_KEYS),
  direction: z.enum(["above", "below"]),
  mode: z.enum(["fixed", "percent"]),
  value: z.number().positive().max(100_000),
  sustainMinutes: z.int().min(0).max(60),
  enabled: z.boolean(),
});

const automationInput = z.discriminatedUnion("job", [
  z.object({
    job: z.literal("speedtest"),
    everyMinutes: z.union([z.literal(60), z.literal(360), z.literal(720), z.literal(1440)]).nullable(),
    offsetMinutes: z.int().min(0).max(1439),
    timeZone: z.string().refine(validTimeZone, "Unknown time zone"),
  }),
  z.object({
    job: z.literal("devices"),
    everyMinutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]).nullable(),
  }),
  z.object({
    job: z.literal("ping"),
    everyMinutes: z.union([z.literal(1), z.literal(5)]).nullable(),
    target: pingHost,
  }),
]);

export const appRouter = t.router({
  auth: t.router({
    status: publicProcedure.query(async ({ ctx }) => ({
      passwordSet: await passwordIsSet(),
      signedIn: await sessionValid(ctx.token),
      onUmbrel: umbrelPassword() !== null,
    })),
    // First run only: whoever opens LANscape first sets the password, like Umbrel's own setup
    setup: publicProcedure.input(z.object({ password })).mutation(async ({ ctx, input }) => {
      if (await passwordIsSet()) throw new TRPCError({ code: "FORBIDDEN", message: "A password is already set" });
      await setPassword(input.password);
      await startSession(ctx);
    }),
    login: publicProcedure.input(z.object({ password: z.string().max(200) })).mutation(async ({ ctx, input }) => {
      assertNotLockedOut(ctx.ip);
      const ok = await checkPassword(input.password);
      recordLogin(ctx.ip, ok);
      if (!ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "Wrong password" });
      await startSession(ctx);
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await endSession(ctx.token);
      ctx.setCookie(sessionCookie(null));
    }),
    // Changing the password signs out every other browser
    changePassword: procedure.input(z.object({ current: z.string().max(200), next: password })).mutation(async ({ ctx, input }) => {
      assertNotLockedOut(ctx.ip);
      const ok = await checkPassword(input.current);
      recordLogin(ctx.ip, ok);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "The current password is wrong" });
      await setPassword(input.next);
      await endAllSessions(ctx.token ?? undefined);
    }),
    // Back to the password Umbrel shows on its dashboard; other browsers are signed out
    resetToUmbrel: procedure.mutation(async ({ ctx }) => {
      const umbrel = umbrelPassword();
      if (!umbrel) throw new TRPCError({ code: "BAD_REQUEST", message: "Not running on Umbrel" });
      await setPassword(umbrel);
      await endAllSessions(ctx.token ?? undefined);
    }),
    logoutEverywhere: procedure.mutation(async ({ ctx }) => {
      await endAllSessions();
      ctx.setCookie(sessionCookie(null));
    }),
  }),
  health: publicProcedure.query(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, version: process.env.APP_VERSION ?? "dev" };
  }),
  speedtest: t.router({
    latest: procedure.query(() => prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } })),
    history: procedure.input(rangeInput).query(({ input }) => {
      const from = since(input.range);
      return prisma.speedTest.findMany({
        where: from ? { createdAt: { gte: from } } : {},
        orderBy: { createdAt: "desc" },
      });
    }),
    latency: procedure.input(rangeInput).query(({ input }) => latencyHistory(input.range)),
    servers: procedure.query(() => listServers()),
    server: procedure.query(async () => (await prisma.setting.findUnique({ where: { key: SERVER_SETTING } }))?.value || null),
    setServer: procedure
      .input(z.object({ id: z.string().regex(/^\d*$/) })) // "" = automatic (nearest)
      .mutation(({ input }) =>
        prisma.setting.upsert({
          where: { key: SERVER_SETTING },
          create: { key: SERVER_SETTING, value: input.id },
          update: { value: input.id },
        }),
      ),
    // Resolves null when the test is cancelled
    run: procedure.mutation(() => runSpeedtest("manual")),
    cancel: procedure.mutation(() => cancelSpeedtest()),
    // The current test's progress, then every update; null means no test is running
    progress: procedure.subscription(async function* ({ signal }): AsyncGenerator<SpeedtestProgress | null> {
      yield currentProgress();
      for await (const [progress] of on(speedtestEvents, "progress", { signal })) yield progress;
    }),
  }),
  notifications: t.router({
    rules: procedure.query(async () => ({
      rules: await prisma.notificationRule.findMany({ orderBy: { id: "asc" } }),
      metrics: METRICS,
    })),
    // Any edit starts the rule's state over, so a changed threshold can't inherit an old alert
    saveRule: procedure.input(ruleInput).mutation(({ input: { id, ...rule } }) => {
      const data = { ...rule, pendingSince: null, alerting: false };
      return id ? prisma.notificationRule.update({ where: { id }, data }) : prisma.notificationRule.create({ data });
    }),
    deleteRule: procedure.input(z.object({ id: z.int() })).mutation(({ input }) =>
      prisma.notificationRule.delete({ where: { id: input.id } }),
    ),
    list: procedure.query(() => prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 200 })),
    unread: procedure.query(() => prisma.notification.count({ where: { read: false } })),
    markAllRead: procedure.mutation(() => prisma.notification.updateMany({ where: { read: false }, data: { read: true } })),
    channels: procedure.query(() => describeChannels()),
    deviceAlerts: procedure.query(() => readDeviceAlerts()),
    setDeviceAlert: procedure
      .input(z.object({ alert: z.enum(["newDevice", "unknownBack"]), on: z.boolean() }))
      .mutation(({ input }) => {
        const key = input.alert === "newDevice" ? NEW_DEVICE_ALERTS : UNKNOWN_BACK_ALERTS;
        const value = input.on ? "on" : "off";
        return prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }),
    saveChannel: procedure
      .input(z.object({ channel: z.enum(CHANNEL_IDS), values: z.record(z.string(), z.string().max(1000).optional()) }))
      .mutation(({ input }) => saveChannel(input.channel, input.values)),
    test: procedure.input(z.object({ channel: z.enum(CHANNEL_IDS) })).mutation(({ input }) => sendTest(input.channel)),
    findTelegramChats: procedure.mutation(() => findTelegramChats()),
  }),
  devices: t.router({
    list: procedure.query(async () => {
      const [devices, lastScan] = await Promise.all([
        prisma.device.findMany(),
        prisma.setting.findUnique({ where: { key: LAST_SCAN } }),
      ]);
      const scannedAt = lastScan ? new Date(lastScan.value) : null;
      return {
        lastScan: scannedAt,
        devices: devices.map((device) => ({ ...device, online: scannedAt !== null && device.lastSeen >= scannedAt })),
      };
    }),
    scan: procedure
      .input(z.object({ thorough: z.boolean() }).optional())
      .mutation(({ input }) => runDeviceScan({ thorough: input?.thorough })),
    update: procedure
      .input(
        z.object({
          mac: z.string(),
          known: z.boolean().optional(),
          alertOfflineMinutes: z.union([z.literal(5), z.literal(10), z.literal(30), z.literal(60), z.null()]).optional(),
        }),
      )
      .mutation(({ input: { mac, known, alertOfflineMinutes } }) =>
        prisma.device.update({
          where: { mac },
          // A changed offline setting starts its alert state over
          data: { known, ...(alertOfflineMinutes !== undefined ? { alertOfflineMinutes, offlineAlerted: false } : {}) },
        }),
      ),
    markAllKnown: procedure.mutation(() => prisma.device.updateMany({ where: { known: false }, data: { known: true } })),
    history: procedure
      .input(z.object({ mac: z.string() }))
      .query(({ input }) => prisma.deviceEvent.findMany({ where: { mac: input.mac }, orderBy: { at: "desc" }, take: 100 })),
    rename: procedure
      .input(z.object({ mac: z.string(), name: z.string().trim().max(60) }))
      .mutation(({ input }) => prisma.device.update({ where: { mac: input.mac }, data: { name: input.name || null } })),
  }),
  automations: t.router({
    list: procedure.query(async () => {
      const [automations, router] = await Promise.all([loadAutomations(), findGateway()]);
      const withStatus = await Promise.all(
        automations.map(async (automation) => ({
          ...automation,
          nextRun: nextRun(automation),
          status: await readStatus(`job.${automation.job}`),
        })),
      );
      return { automations: withStatus, router };
    }),
    update: procedure
      .input(automationInput)
      .mutation(({ input }) => prisma.automation.upsert({ where: { job: input.job }, create: input, update: input })),
  }),
  // Downloading and restoring backups are plain HTTP routes in index.ts, since they move files
  backup: t.router({
    canUndo: procedure.query(() => listSafetyBackups().length > 0),
    undo: procedure.mutation(() => {
      try {
        return undoRestore();
      } catch (error) {
        if (error instanceof BackupError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        throw error;
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
