import { expect, test } from "vitest";
import { durationText, findOutages, outageAlert } from "./outages";

// One check a minute from 10:00; "x" lost every packet, "." answered, " " no check that minute
const checks = (internet: string, router = "") =>
  [...internet].flatMap((mark, minute) => {
    const createdAt = new Date(Date.UTC(2026, 10, 2, 10, minute));
    const routerMark = router[minute];
    return [
      ...(routerMark && routerMark !== " " ? [{ createdAt, target: "router", received: routerMark === "x" ? 0 : 5 }] : []),
      ...(mark !== " " ? [{ createdAt, target: "internet", received: mark === "x" ? 0 : 5 }] : []),
    ];
  });
const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 10, minute));

test("two or more lost checks in a row are an outage, ended by the next answer", () => {
  expect(findOutages(checks("..x..xxx..", "..........")), "one lost check is a blip").toEqual([
    { start: at(5), end: at(8), failedChecks: 3, cause: "internet" },
  ]);
});

test("the router going quiet too puts the problem inside the home network", () => {
  expect(findOutages(checks(".xxx.", ".xx..")).map((outage) => outage.cause)).toEqual(["home"]);
  expect(findOutages(checks(".xxx.")).map((outage) => outage.cause)).toEqual(["unknown"]);
});

test("an outage still going has no end, unless the checks stopped long ago", () => {
  expect(findOutages(checks("..xxx"), at(5))).toMatchObject([{ start: at(2), end: null }]);
  expect(findOutages(checks("..xxx"), at(60))).toMatchObject([{ start: at(2), end: at(4) }]);
});

test("a long gap between checks splits what's known", () => {
  const samples = [...checks("xx"), ...checks("x.").map((sample) => ({ ...sample, createdAt: new Date(sample.createdAt.getTime() + 30 * 60_000) }))];
  expect(findOutages(samples).map(({ start, end }) => [start, end])).toEqual([[at(0), at(1)]]);
});

test("the alert says how long, and where the problem was", () => {
  expect(durationText(90 * 60_000)).toBe("1 hour 30 min");
  expect(outageAlert({ start: at(0), end: at(7), failedChecks: 7, cause: "internet" }).message).toBe(
    "The internet was down for 7 minutes and is back now. Your router answered the whole time, so the problem was past it: your internet provider or beyond.",
  );
});
