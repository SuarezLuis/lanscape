import { on } from "node:events";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { prisma } from "./db";
import { latencyHistory, RANGES, since } from "./latency";
import { METRIC_KEYS, METRICS, NTFY_TOKEN, NTFY_URL, readSettings, sendNtfy } from "./jobs/notify";
import { findGateway } from "./jobs/ping";
import { loadAutomations, nextRun } from "./jobs/scheduler";
import { cancelSpeedtest, currentProgress, runSpeedtest, type SpeedtestProgress, speedtestEvents } from "./jobs/speedtest";

const t = initTRPC.create({ transformer: superjson });

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

const saveSetting = (key: string, value: string) =>
  prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

const automationInput = z.discriminatedUnion("job", [
  z.object({
    job: z.literal("speedtest"),
    everyMinutes: z.union([z.literal(60), z.literal(360), z.literal(720), z.literal(1440)]).nullable(),
    offsetMinutes: z.int().min(0).max(1439),
    timeZone: z.string().refine(validTimeZone, "Unknown time zone"),
  }),
  z.object({
    job: z.literal("ping"),
    everyMinutes: z.union([z.literal(1), z.literal(5)]).nullable(),
    target: pingHost,
  }),
]);

export const appRouter = t.router({
  health: t.procedure.query(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, version: process.env.APP_VERSION ?? "dev" };
  }),
  speedtest: t.router({
    latest: t.procedure.query(() => prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } })),
    history: t.procedure.input(rangeInput).query(({ input }) => {
      const from = since(input.range);
      return prisma.speedTest.findMany({
        where: from ? { createdAt: { gte: from } } : {},
        orderBy: { createdAt: "desc" },
      });
    }),
    latency: t.procedure.input(rangeInput).query(({ input }) => latencyHistory(input.range)),
    // Resolves null when the test is cancelled
    run: t.procedure.mutation(() => runSpeedtest("manual")),
    cancel: t.procedure.mutation(() => cancelSpeedtest()),
    // The current test's progress, then every update; null means no test is running
    progress: t.procedure.subscription(async function* ({ signal }): AsyncGenerator<SpeedtestProgress | null> {
      yield currentProgress();
      for await (const [progress] of on(speedtestEvents, "progress", { signal })) yield progress;
    }),
  }),
  notifications: t.router({
    rules: t.procedure.query(async () => ({
      rules: await prisma.notificationRule.findMany({ orderBy: { id: "asc" } }),
      metrics: METRICS,
    })),
    // Any edit starts the rule's state over, so a changed threshold can't inherit an old alert
    saveRule: t.procedure.input(ruleInput).mutation(({ input: { id, ...rule } }) => {
      const data = { ...rule, pendingSince: null, alerting: false };
      return id ? prisma.notificationRule.update({ where: { id }, data }) : prisma.notificationRule.create({ data });
    }),
    deleteRule: t.procedure.input(z.object({ id: z.int() })).mutation(({ input }) =>
      prisma.notificationRule.delete({ where: { id: input.id } }),
    ),
    list: t.procedure.query(() => prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 200 })),
    unread: t.procedure.query(() => prisma.notification.count({ where: { read: false } })),
    markAllRead: t.procedure.mutation(() => prisma.notification.updateMany({ where: { read: false }, data: { read: true } })),
    // The token never leaves the server; the page only learns whether one is set
    channel: t.procedure.query(async () => {
      const { url, token } = await readSettings();
      return { url, hasToken: token !== null };
    }),
    saveChannel: t.procedure
      .input(
        z.object({
          url: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]),
          token: z.string().max(500).optional(), // undefined keeps the saved token, "" clears it
        }),
      )
      .mutation(async ({ input }) => {
        await saveSetting(NTFY_URL, input.url);
        if (input.token !== undefined) await saveSetting(NTFY_TOKEN, input.token);
      }),
    test: t.procedure.mutation(() =>
      sendNtfy("Test notification", "Notifications from LANscape will arrive here.", false),
    ),
  }),
  automations: t.router({
    list: t.procedure.query(async () => {
      const [automations, router] = await Promise.all([loadAutomations(), findGateway()]);
      return { automations: automations.map((automation) => ({ ...automation, nextRun: nextRun(automation) })), router };
    }),
    update: t.procedure
      .input(automationInput)
      .mutation(({ input }) => prisma.automation.upsert({ where: { job: input.job }, create: input, update: input })),
  }),
});

export type AppRouter = typeof appRouter;
