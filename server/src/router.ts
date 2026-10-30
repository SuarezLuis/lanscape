import { on } from "node:events";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { prisma } from "./db";
import { cancelSpeedtest, currentProgress, runSpeedtest, type SpeedtestProgress, speedtestEvents } from "./jobs/speedtest";

const t = initTRPC.create({ transformer: superjson });

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_RANGES = ["day", "week", "month", "year", "all"] as const;
const RANGE_DAYS: Record<(typeof HISTORY_RANGES)[number], number | null> = { day: 1, week: 7, month: 30, year: 365, all: null };

export const appRouter = t.router({
  health: t.procedure.query(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, version: process.env.APP_VERSION ?? "dev" };
  }),
  speedtest: t.router({
    latest: t.procedure.query(() => prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } })),
    history: t.procedure.input(z.object({ range: z.enum(HISTORY_RANGES) })).query(({ input }) => {
      const days = RANGE_DAYS[input.range];
      return prisma.speedTest.findMany({
        where: days ? { createdAt: { gte: new Date(Date.now() - days * DAY_MS) } } : {},
        orderBy: { createdAt: "desc" },
      });
    }),
    // Resolves null when the test is cancelled
    run: t.procedure.mutation(() => runSpeedtest()),
    cancel: t.procedure.mutation(() => cancelSpeedtest()),
    // The current test's progress, then every update; null means no test is running
    progress: t.procedure.subscription(async function* ({ signal }): AsyncGenerator<SpeedtestProgress | null> {
      yield currentProgress();
      for await (const [progress] of on(speedtestEvents, "progress", { signal })) yield progress;
    }),
  }),
});

export type AppRouter = typeof appRouter;
