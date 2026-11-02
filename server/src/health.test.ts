import { expect, test } from "vitest";
import { prisma } from "./db";
import { grade, healthScore, partScore, scoreFrom } from "./health";

test("each part scores 100 at great, 0 at bad, linear in between", () => {
  expect(partScore("latency", 10)).toBe(100);
  expect(partScore("latency", 85)).toBe(50);
  expect(partScore("latency", 500)).toBe(0);
  expect(partScore("uptime", 99)).toBe(50);
  expect(partScore("loss", 0)).toBe(100);
  expect(scoreFrom({ uptime: 100, loss: 0, latency: 12, jitter: 1 })).toMatchObject({ score: 100, grade: "Excellent" });
  expect(scoreFrom({ uptime: 99, loss: 0, latency: 12, jitter: 1 }).score).toBe(80);
  expect([grade(95), grade(80), grade(60), grade(10)]).toEqual(["Excellent", "Good", "Fair", "Poor"]);
});

test("an hour with a 6-minute outage loses uptime points but not loss points", async () => {
  const now = new Date();
  const start = now.getTime() - 60 * 60_000;
  await prisma.pingSample.createMany({
    data: Array.from({ length: 60 }, (_, minute) => {
      const down = minute >= 20 && minute < 26;
      return { createdAt: new Date(start + minute * 60_000), target: "internet", host: "1.1.1.1", sent: 5, received: down ? 0 : 5, avgMs: down ? null : 12, jitterMs: down ? null : 1 };
    }),
  });

  const health = await healthScore(1, now);
  const part = (key: string) => health?.parts.find((entry) => entry.key === key);
  expect(part("uptime")?.value).toBeCloseTo(90, 0);
  expect(part("uptime")?.points).toBe(0);
  expect(part("loss")).toMatchObject({ value: 0, points: 100 });
  expect(health).toMatchObject({ score: 60, grade: "Fair", checks: 60 });
});

test("too few checks to score", async () => {
  await prisma.pingSample.create({ data: { target: "internet", host: "1.1.1.1", sent: 5, received: 5, avgMs: 10, jitterMs: 1 } });
  expect(await healthScore(1)).toBeNull();
});
