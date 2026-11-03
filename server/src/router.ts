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
  onUmbrel,
  umbrelPassword,
} from "./auth";
import { BackupError, listSafetyBackups, undoRestore } from "./backup";
import { prisma } from "./db";
import { aiSettings, DEFAULT_ANTHROPIC_MODEL, describeAi, providerError, removeAi, saveAi } from "./ai";
import { planInput, readPlan, savePlan, weeklyPattern } from "./analytics";
import { ispReport, readReportSettings, reportSettings, saveReportSettings, sendWeeklyReport } from "./reports";
import { healthScore } from "./health";
import { overview, visitWindow } from "./overview";
import { latencyHistory, RANGES, since } from "./latency";
import { createMcpToken, describeMcp, revokeMcpToken } from "./mcp";
import { listOutages, OUTAGE_ALERTS, OUTAGE_RANGES, outageAlertsOn } from "./outages";
import { CHANNEL_IDS, describeChannels, saveChannel, sendTest } from "./jobs/channels";
import { METRIC_KEYS, METRICS } from "./jobs/notify";
import { LAST_SCAN, NEW_DEVICE_ALERTS, readDeviceAlerts, runDeviceScan, UNKNOWN_BACK_ALERTS } from "./jobs/devices";
import { runDiagnostics } from "./jobs/diagnostics";
import { findGateway } from "./jobs/ping";
import { describePihole, PAUSE_MINUTES, pauseDevice, pausedUntil, piholeActivity, piholeSettings, removePihole, resumeDevice, savePihole } from "./jobs/pihole";
import { listServices, runServiceCheck, serviceInput } from "./jobs/services";
import { readStatus } from "./jobs/status";
import { guessDevice } from "./jobs/guess";
import { devicePorts, PORT_CLOSED_ALERTS, PORT_OPENED_ALERTS, readPortAlerts, scanDevicePorts } from "./jobs/ports";
import { displayModel, readTraits } from "./jobs/traits";
import { findTelegramChats } from "./jobs/telegram";
import { JOBS, jobRunning, loadAutomations, nextRun, runJobNow } from "./jobs/scheduler";
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
    job: z.literal("ports"),
    everyMinutes: z.union([z.literal(360), z.literal(720), z.literal(1440)]).nullable(),
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

const piholeCall = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TRPCError({ code: "BAD_REQUEST", message: /fetch failed|aborted|timeout|ECONNREFUSED/i.test(message) ? "Couldn't reach Pi-hole" : message });
  }
};

const providerCall = async <T>(run: () => Promise<T>) => {
  try {
    return await run();
  } catch (error) {
    throw new TRPCError({ code: "BAD_REQUEST", message: providerError(error) });
  }
};

export const appRouter = t.router({
  auth: t.router({
    status: publicProcedure.query(async ({ ctx }) => ({
      passwordSet: await passwordIsSet(),
      signedIn: await sessionValid(ctx.token),
      onUmbrel: onUmbrel(),
      // APP_PASSWORD: Umbrel's per-install password, or one set in a plain Docker compose file
      presetPassword: umbrelPassword() !== null,
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
      if (!umbrel) throw new TRPCError({ code: "BAD_REQUEST", message: "No APP_PASSWORD is set" });
      await setPassword(umbrel);
      await endAllSessions(ctx.token ?? undefined);
    }),
    logoutEverywhere: procedure.mutation(async ({ ctx }) => {
      await endAllSessions();
      ctx.setCookie(sessionCookie(null));
    }),
  }),
  // The home screen; `since` is the viewer's previous visit
  overview: procedure.input(z.object({ since: z.date().optional() })).query(({ input }) => overview(visitWindow(input.since))),
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
    health: procedure.query(async () => {
      const [day, week] = await Promise.all([healthScore(1), healthScore(7)]);
      return { day, week };
    }),
    // The viewer's UTC offset, so hours are local to them
    pattern: procedure.input(z.object({ offsetMinutes: z.int().min(-14 * 60).max(14 * 60) })).query(({ input }) => weeklyPattern(input.offsetMinutes)),
    plan: procedure.query(() => readPlan()),
    setPlan: procedure.input(planInput).mutation(({ input }) => savePlan(input)),
    outages: procedure.input(z.object({ range: z.enum(OUTAGE_RANGES) })).query(({ input }) => listOutages(input.range)),
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
    deviceAlerts: procedure.query(async () => ({ ...(await readDeviceAlerts()), ...(await readPortAlerts()), outage: await outageAlertsOn() })),
    setDeviceAlert: procedure
      .input(z.object({ alert: z.enum(["newDevice", "unknownBack", "outage", "portOpened", "portClosed"]), on: z.boolean() }))
      .mutation(({ input }) => {
        const key = {
          newDevice: NEW_DEVICE_ALERTS,
          unknownBack: UNKNOWN_BACK_ALERTS,
          outage: OUTAGE_ALERTS,
          portOpened: PORT_OPENED_ALERTS,
          portClosed: PORT_CLOSED_ALERTS,
        }[input.alert];
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
        prisma.device.findMany({ include: { ports: { select: { port: true }, orderBy: { port: "asc" } } } }),
        prisma.setting.findUnique({ where: { key: LAST_SCAN } }),
      ]);
      const scannedAt = lastScan ? new Date(lastScan.value) : null;
      const traits = await readTraits(devices.map((device) => device.mac));
      return {
        lastScan: scannedAt,
        devices: devices.map(({ ports, ...device }) => ({
          ...device,
          model: displayModel(traits.get(device.mac)),
          online: scannedAt !== null && device.lastSeen >= scannedAt,
          openPorts: ports.map((entry) => entry.port),
        })),
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
          alertOnlineMinutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(240), z.null()]).optional(),
        }),
      )
      .mutation(({ input: { mac, known, alertOfflineMinutes, alertOnlineMinutes } }) =>
        prisma.device.update({
          where: { mac },
          // A changed offline setting starts its alert state over
          data: {
            known,
            alertOnlineMinutes,
            ...(alertOfflineMinutes !== undefined ? { alertOfflineMinutes, offlineAlerted: false } : {}),
          },
        }),
      ),
    // Its history goes with it, and it counts as new the next time it shows up
    delete: procedure.input(z.object({ mac: z.string() })).mutation(({ input }) => prisma.device.delete({ where: { mac: input.mac } })),
    markAllKnown: procedure.mutation(() => prisma.device.updateMany({ where: { known: false }, data: { known: true } })),
    // What the device announces about itself (Cast id, model, DHCP hostname...), used to follow it across MACs
    identity: procedure.input(z.object({ mac: z.string() })).query(async ({ input }) => (await readTraits([input.mac])).get(input.mac) ?? {}),
    dhcpStatus: procedure.query(() => readStatus("integration.dhcp")),
    ports: procedure.input(z.object({ mac: z.string() })).query(({ input }) => devicePorts(input.mac)),
    // What it probably is, from its maker, name, DHCP details, open ports and (with Pi-hole) the domains it looks up
    guess: procedure.input(z.object({ mac: z.string() })).query(async ({ input }) => {
      const device = await prisma.device.findUnique({ where: { mac: input.mac }, include: { ports: { select: { port: true } } } });
      if (!device) return null;
      const [traits, activity] = await Promise.all([readTraits([input.mac]), piholeActivity(input.mac).catch(() => null)]);
      return guessDevice({
        vendor: device.vendor,
        hostname: device.hostname,
        traits: traits.get(input.mac),
        ports: device.ports.map((entry) => entry.port),
        domains: activity?.found ? activity.topDomains.map((entry) => entry.domain) : [],
      });
    }),
    pausedUntil: procedure.input(z.object({ mac: z.string() })).query(({ input }) => pausedUntil(input.mac)),
    pause: procedure
      .input(z.object({ mac: z.string(), minutes: z.union(PAUSE_MINUTES.map((minutes) => z.literal(minutes))) }))
      .mutation(({ input }) => piholeCall(() => pauseDevice(input.mac, input.minutes))),
    resume: procedure.input(z.object({ mac: z.string() })).mutation(({ input }) => piholeCall(() => resumeDevice(input.mac))),
    // Only devices on the list, at the address they were last seen at
    scanPorts: procedure.input(z.object({ mac: z.string() })).mutation(async ({ input }) => {
      try {
        await scanDevicePorts(input.mac);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
      }
    }),
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
          running: jobRunning(automation.job as (typeof JOBS)[number]),
          status: await readStatus(`job.${automation.job}`),
        })),
      );
      return { automations: withStatus, router };
    }),
    update: procedure
      .input(automationInput)
      .mutation(({ input }) => prisma.automation.upsert({ where: { job: input.job }, create: input, update: input })),
    run: procedure.input(z.object({ job: z.enum(JOBS) })).mutation(async ({ input }) => {
      try {
        await runJobNow(input.job);
      } catch (error) {
        throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : String(error) });
      }
    }),
  }),
  reports: t.router({
    settings: procedure.query(() => readReportSettings()),
    save: procedure.input(reportSettings).mutation(({ input }) => saveReportSettings(input)),
    sendNow: procedure.mutation(() => sendWeeklyReport()),
    isp: procedure.query(() => ispReport()),
  }),
  // Takes 10 to 30 seconds: pings, lookups and a traceroute, one after another
  diagnostics: t.router({ run: procedure.mutation(() => runDiagnostics()) }),
  services: t.router({
    list: procedure.query(() => listServices()),
    // A changed service starts its state over, so an edit can't inherit an old alert
    save: procedure.input(serviceInput).mutation(({ input: { id, ...service } }) => {
      const data = { ...service, failures: 0, failingSince: null, alerted: false };
      return id ? prisma.serviceCheck.update({ where: { id }, data }) : prisma.serviceCheck.create({ data });
    }),
    delete: procedure.input(z.object({ id: z.int() })).mutation(({ input }) => prisma.serviceCheck.delete({ where: { id: input.id } })),
    checkNow: procedure.input(z.object({ id: z.int() })).mutation(async ({ input }) =>
      runServiceCheck(await prisma.serviceCheck.findUniqueOrThrow({ where: { id: input.id } })),
    ),
  }),
  ai: t.router({
    settings: procedure.query(async () => ({ saved: await describeAi(), defaultAnthropicModel: DEFAULT_ANTHROPIC_MODEL })),
    save: procedure.input(aiSettings).mutation(({ input }) => providerCall(() => saveAi(input))),
    remove: procedure.mutation(() => removeAi()),
  }),
  integrations: t.router({
    pihole: procedure.query(() => describePihole()),
    savePihole: procedure.input(piholeSettings).mutation(async ({ input }) => {
      try {
        return await savePihole(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // fetch's own errors ("fetch failed", timeouts) don't say where; this does
        throw new TRPCError({ code: "BAD_REQUEST", message: /fetch failed|aborted|timeout/i.test(message) ? `Couldn't reach Pi-hole at ${input.url}` : message });
      }
    }),
    removePihole: procedure.mutation(() => removePihole()),
    mcp: procedure.query(() => describeMcp()),
    // Replaces any earlier token, so creating one also cuts off whoever had the old one
    createMcpToken: procedure.mutation(() => createMcpToken()),
    revokeMcpToken: procedure.mutation(() => revokeMcpToken()),
    piholeActivity: procedure.input(z.object({ mac: z.string() })).query(async ({ input }) => {
      try {
        return await piholeActivity(input.mac);
      } catch {
        return { found: false as const, error: "Couldn't reach Pi-hole" };
      }
    }),
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
