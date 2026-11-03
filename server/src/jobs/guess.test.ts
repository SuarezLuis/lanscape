import { expect, test } from "vitest";
import { guessDevice } from "./guess";

const clues = { vendor: null, hostname: null, traits: undefined, ports: [] as number[], domains: [] as string[] };

test("guesses from the strongest clues and says why", () => {
  expect(guessDevice({ ...clues, vendor: "Espressif Inc.", ports: [554, 80] })).toEqual({ kind: "Camera", reasons: ["port 554 is open"] });
  expect(guessDevice({ ...clues, vendor: "Roku, Inc.", domains: ["scribe.logs.roku.com"] })).toEqual({
    kind: "Roku",
    reasons: ["it looks up scribe.logs.roku.com", "its maker is Roku, Inc."],
  });
  expect(guessDevice({ ...clues, vendor: "Private address", traits: { "dhcp-vendor": "android-dhcp-15" } })?.kind).toBe("Android phone or tablet");
  expect(guessDevice({ ...clues, vendor: "Raspberry Pi Trading Ltd", hostname: "umbrel", ports: [22, 80, 8123, 32400] })).toEqual({
    kind: "Home server",
    reasons: ["it runs Home Assistant (port 8123), Plex (port 32400)", "its name is umbrel"],
  });
});

test("no guess for a device that names its model, or when nothing hints at a kind", () => {
  expect(guessDevice({ ...clues, ports: [8009], traits: { model: "Google TV Streamer" } })).toBeNull();
  expect(guessDevice({ ...clues, vendor: "Some Company" })).toBeNull();
});
