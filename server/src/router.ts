import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { prisma } from "./db";
import { runSpeedtest } from "./jobs/speedtest";

const t = initTRPC.create({ transformer: superjson });

export const appRouter = t.router({
  health: t.procedure.query(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, version: process.env.APP_VERSION ?? "dev" };
  }),
  speedtest: t.router({
    latest: t.procedure.query(() => prisma.speedTest.findFirst({ orderBy: { createdAt: "desc" } })),
    run: t.procedure.mutation(() => runSpeedtest()),
  }),
});

export type AppRouter = typeof appRouter;
