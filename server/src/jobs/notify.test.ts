import { expect, test } from "vitest";
import { advance, breaches, median, pingValues, thresholdFor } from "./notify";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 30, 12, minute));

test("percent rules sit a percentage away from the median", () => {
  const halfBelow = { direction: "below", mode: "percent", value: 50 };
  expect(thresholdFor(halfBelow, 600)).toBe(300);
  expect(breaches(halfBelow, 280, 600)).toBe(true);
  expect(breaches(halfBelow, 320, 600)).toBe(false);
  expect(thresholdFor({ direction: "above", mode: "percent", value: 50 }, 10)).toBe(15);
  expect(breaches({ direction: "above", mode: "fixed", value: 20 }, 25, null)).toBe(true);
});

test("median ignores outliers that would drag an average", () => {
  expect(median([600, 610, 620, 5, 630])).toBe(610);
  expect(median([1, 3])).toBe(2);
  expect(median([])).toBeNull();
});

test("notifies once when a problem has lasted, once when it clears", () => {
  let state = { pendingSince: null as Date | null, alerting: false, sustainMinutes: 5 };
  const fired: (string | null)[] = [];
  for (const [minute, breached] of [[0, true], [3, true], [5, true], [6, true], [7, false], [8, false]] as const) {
    const next = advance(state, breached, at(minute));
    fired.push(next.fire);
    state = { ...state, pendingSince: next.pendingSince, alerting: next.alerting };
  }
  expect(fired).toEqual([null, null, "problem", null, "resolved", null]);
});

test("a blip shorter than the sustain window never notifies", () => {
  const start = advance({ pendingSince: null, alerting: false, sustainMinutes: 5 }, true, at(0));
  const cleared = advance({ ...start, sustainMinutes: 5 }, false, at(2));
  expect([start.fire, cleared.fire]).toEqual([null, null]);
});

test("turns ping samples into per-target ping and loss values", () => {
  expect(
    pingValues([
      { target: "router", avgMs: 0.5, sent: 5, received: 5 },
      { target: "internet", avgMs: null, sent: 5, received: 0 },
    ]),
  ).toEqual({ routerPing: 0.5, routerLoss: 0, internetPing: null, internetLoss: 100 });
});
