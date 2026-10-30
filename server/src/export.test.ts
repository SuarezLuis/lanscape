import { expect, test } from "vitest";
import { field } from "./export";

test("quotes CSV fields and defuses spreadsheet formulas", () => {
  expect(field('Say "hi"')).toBe('"Say ""hi"""');
  expect(field("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
  expect(field(-12.5)).toBe('"-12.5"');
  expect(field(null)).toBe("");
  expect(field(new Date("2026-10-30T12:00:00Z"))).toBe('"2026-10-30T12:00:00.000Z"');
});
