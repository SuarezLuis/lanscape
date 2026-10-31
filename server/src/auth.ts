import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { prisma } from "./db";

const PASSWORD = "auth.password";
const COOKIE = "lanscape_session";
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

const derive = (password: string, salt: Buffer, length: number) =>
  new Promise<Buffer>((done, fail) => scrypt(password, salt, length, (error, key) => (error ? fail(error) : done(key))));

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
};

export const verifyPassword = async (password: string, stored: string) => {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  return timingSafeEqual(await derive(password, Buffer.from(salt, "base64"), expected.length), expected);
};

const storedPassword = async () => (await prisma.setting.findUnique({ where: { key: PASSWORD } }))?.value ?? null;
export const passwordIsSet = async () => (await storedPassword()) !== null;

export const setPassword = async (password: string) => {
  const value = await hashPassword(password);
  await prisma.setting.upsert({ where: { key: PASSWORD }, create: { key: PASSWORD, value }, update: { value } });
};

// A copied password often picks up a space or newline; passwords set with spaces at the ends still match as typed
export const matchesPassword = async (password: string, stored: string) =>
  (await verifyPassword(password, stored)) || (password !== password.trim() && verifyPassword(password.trim(), stored));

export const checkPassword = async (password: string) => {
  const stored = await storedPassword();
  return stored !== null && matchesPassword(password, stored);
};

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export const createSession = async () => {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({ data: { tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS) } });
  return token;
};

// Sliding expiry: a session used at least once a month stays signed in
export const sessionValid = async (token: string | null) => {
  if (!token) return false;
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) } });
  if (!session || session.expiresAt.getTime() < Date.now()) return false;
  if (session.expiresAt.getTime() - Date.now() < (SESSION_DAYS - 1) * DAY_MS) {
    await prisma.session.update({ where: { tokenHash: session.tokenHash }, data: { expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS) } });
  }
  return true;
};

export const endSession = (token: string | null) =>
  token ? prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } }) : Promise.resolve();

export const endAllSessions = (except?: string) =>
  prisma.session.deleteMany({ where: except ? { tokenHash: { not: tokenHash(except) } } : {} });

export const readSessionCookie = (header: string | undefined) =>
  header
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === COOKIE)?.[1] ?? null;

// HttpOnly and SameSite=Lax; not Secure, because LANscape is served over plain http on the LAN
export const sessionCookie = (token: string | null) =>
  token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// Per address: five wrong passwords lock that address out for a minute
const failures = new Map<string, { count: number; lockedUntil: number }>();

export const assertNotLockedOut = (ip: string) => {
  const entry = failures.get(ip);
  if (entry && entry.lockedUntil > Date.now()) {
    throw new Error(`Too many wrong passwords. Try again in ${Math.ceil((entry.lockedUntil - Date.now()) / 1000)} seconds.`);
  }
};

export const recordLogin = (ip: string, ok: boolean) => {
  if (ok) return failures.delete(ip);
  const count = (failures.get(ip)?.count ?? 0) + 1;
  failures.set(ip, { count: count >= MAX_FAILURES ? 0 : count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0 });
};

// On Umbrel, APP_PASSWORD is the per-install password the dashboard shows for LANscape (deterministicPassword)
export const umbrelPassword = () => process.env.APP_PASSWORD || null;

// "umbrel": use Umbrel's password; "clear": back to first-run setup; null: leave it
export const passwordAction = (state: { hasPassword: boolean; onUmbrel: boolean; resetSetting: boolean; resetFile: boolean }) => {
  if (state.resetFile) return state.onUmbrel ? "umbrel" : "clear";
  if (state.onUmbrel && (state.resetSetting || !state.hasPassword)) return "umbrel";
  return null;
};

/**
 * Runs on start. On Umbrel a new install starts with Umbrel's password, so there's no first-run screen for someone
 * else on the LAN to reach first. Two ways back to it when forgotten: the RESET_PASSWORD app setting (umbrelOS 2.0),
 * or an empty reset-password file next to the database (~/umbrel/app-data/sz-lanscape/data/reset-password).
 */
export const preparePassword = async () => {
  const database = (process.env.DATABASE_URL ?? "file:./dev.db").replace(/^file:/, "");
  const flag = join(dirname(resolve(database)), "reset-password");
  const resetFile = existsSync(flag);
  const umbrel = umbrelPassword();
  const action = passwordAction({
    hasPassword: await passwordIsSet(),
    onUmbrel: umbrel !== null,
    resetSetting: process.env.RESET_PASSWORD === "yes",
    resetFile,
  });
  if (resetFile) unlinkSync(flag);

  if (action === "clear") {
    await prisma.setting.deleteMany({ where: { key: PASSWORD } });
    await endAllSessions();
    console.warn("Password cleared by reset-password file; the next visitor sets a new one");
  }
  // Left on, the reset setting only signs people out when the password actually changes
  if (action === "umbrel" && umbrel && !(await checkPassword(umbrel))) {
    await setPassword(umbrel);
    await endAllSessions();
    console.warn("Password set to the one Umbrel shows for LANscape");
  }
};
