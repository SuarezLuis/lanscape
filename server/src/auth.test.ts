import { expect, test } from "vitest";
import { hashPassword, readSessionCookie, verifyPassword } from "./auth";

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
