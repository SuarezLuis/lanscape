import { expect, test } from "vitest";
import { appRouter } from "./router";

test("health reaches the database", async () => {
  const caller = appRouter.createCaller({});
  await expect(caller.health()).resolves.toEqual({ ok: true, version: "dev" });
});
