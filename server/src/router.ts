import { on } from "node:events";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { prisma } from "./db";
import { cancelSpeedtest, currentProgress, runSpeedtest, type SpeedtestProgress, speedtestEvents } from "./jobs/speedtest";

const t = initTRPC.create({ transformer: superjson });

export const appRouter = t.router({
  health: t.procedure.query(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, version: process.env.APP_VERSION ?? "dev" };
  }),
  speedtest: t.router({
    latest: t.procedure.query(() => prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } })),
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
