import { expect, test } from "vitest";
import { bucketStart } from "../latency";
import { DEFAULTS, isDue, nextRun } from "./scheduler";

const everySixHoursFrom4am = { ...DEFAULTS.speedtest, everyMinutes: 360, timeZone: "America/Chicago" };

test("runs on local times in the saved time zone", () => {
  // 4:00 AM in Chicago (CDT, UTC-5) is 09:00 UTC
  expect(isDue(everySixHoursFrom4am, new Date("2026-10-30T09:00:30Z"))).toBe(true);
  expect(isDue(everySixHoursFrom4am, new Date("2026-10-30T15:00:00Z"))).toBe(true);
  expect(isDue(everySixHoursFrom4am, new Date("2026-10-30T04:00:00Z"))).toBe(false);
  expect(isDue(everySixHoursFrom4am, new Date("2026-10-30T09:01:00Z"))).toBe(false);
});

test("off never runs", () => {
  expect(isDue(DEFAULTS.speedtest, new Date("2026-10-30T04:00:00Z"))).toBe(false);
  expect(nextRun(DEFAULTS.speedtest)).toBeNull();
});

test("finds the next run", () => {
  // 11:20 AM Chicago; next slot is 4:00 PM, 21:00 UTC
  expect(nextRun(everySixHoursFrom4am, new Date("2026-10-30T16:20:00Z"))).toEqual(new Date("2026-10-30T21:00:00Z"));
});

test("turns text prefixes into bucket start times", () => {
  expect(bucketStart("2026-10-30T17:3")).toEqual(new Date("2026-10-30T17:30:00Z"));
  expect(bucketStart("2026-10-30T17")).toEqual(new Date("2026-10-30T17:00:00Z"));
  expect(bucketStart("2026-10-30")).toEqual(new Date("2026-10-30T00:00:00Z"));
});

test("rolls up pings older than 90 days, cut on the hour", async () => {
  const { rollupCutoff } = await import("./retention");
  expect(rollupCutoff(new Date("2026-10-30T19:42:10Z"))).toEqual(new Date("2026-08-01T19:00:00Z"));
});
