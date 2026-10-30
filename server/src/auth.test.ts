import { expect, test } from "vitest";
import { hashPassword, passwordAction, readSessionCookie, verifyPassword } from "./auth";

test("hashes passwords with a fresh salt and verifies them", async () => {
  const [first, second] = [await hashPassword("correct horse"), await hashPassword("correct horse")];
  expect(first).not.toBe(second);
  expect(await verifyPassword("correct horse", first)).toBe(true);
  expect(await verifyPassword("wrong horse", first)).toBe(false);
  expect(await verifyPassword("correct horse", "garbage")).toBe(false);
});

test("reads the session cookie among others", () => {
  expect(readSessionCookie("theme=dark; lanscape_session=abc123; other=1")).toBe("abc123");
  expect(readSessionCookie("theme=dark")).toBeNull();
  expect(readSessionCookie(undefined)).toBeNull();
});

test("decides what to do with the password on start", () => {
  const base = { hasPassword: true, onUmbrel: true, resetSetting: false, resetFile: false };
  expect(passwordAction({ ...base, hasPassword: false })).toBe("umbrel"); // new Umbrel install
  expect(passwordAction(base)).toBeNull(); // keeps a password the user chose
  expect(passwordAction({ ...base, resetSetting: true })).toBe("umbrel");
  expect(passwordAction({ ...base, resetFile: true })).toBe("umbrel");
  expect(passwordAction({ ...base, onUmbrel: false, resetFile: true })).toBe("clear"); // plain Docker: first-run setup
  expect(passwordAction({ ...base, onUmbrel: false, hasPassword: false })).toBeNull();
  expect(passwordAction({ ...base, onUmbrel: false, resetSetting: true })).toBeNull();
});
