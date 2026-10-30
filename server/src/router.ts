import { initTRPC } from "@trpc/server";
import { prisma } from "./db";

const t = initTRPC.create();

export const appRouter = t.router({
  health: t.procedure.query(async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, version: process.env.APP_VERSION ?? "dev" };
  }),
});

export type AppRouter = typeof appRouter;
