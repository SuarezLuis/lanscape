import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { createSession } from "./auth";
import { applyBackup, createBackup, inspectBackup, pack, unpack } from "./backup";
import { prisma } from "./db";
import { createMcpToken } from "./mcp";

const header = { format: "lanscape-backup", version: 1, app: "1.2.0", createdAt: "2026-10-31T00:00:00.000Z", encrypted: false } as const;

test("packs a backup, encrypted or not, and refuses a wrong passphrase or an edited header", () => {
  const database = Buffer.from("SQLite format 3\0 pretend");
  expect(unpack(pack(header, database)).database).toEqual(database);

  const sealed = pack(header, database, "hunter22");
  expect(unpack(sealed, "hunter22")).toEqual({ header: { ...header, encrypted: true }, database });
  expect(() => unpack(sealed)).toThrow("encrypted");
  expect(() => unpack(sealed, "wrong")).toThrow("Wrong passphrase");
  const edited = Buffer.from(sealed.toString("latin1").replace("1.2.0", "9.9.9"), "latin1");
  expect(() => unpack(edited, "hunter22")).toThrow("Wrong passphrase");

  expect(() => unpack(Buffer.from("not a backup"))).toThrow("isn't a LANscape backup");
  expect(() => unpack(pack({ ...header, version: 2 }, database))).toThrow("newer LANscape");
});

test("restores every table but keeps the current password, sessions and MCP token", () => {
  const dir = mkdtempSync(join(tmpdir(), "lanscape-test-"));
  const make = (name: string, rows: string) => {
    const db = new Database(join(dir, name));
    db.exec(`CREATE TABLE Setting (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE Device (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
      CREATE TABLE Session (tokenHash TEXT PRIMARY KEY);
      CREATE TABLE _prisma_migrations (migration_name TEXT); ${rows}`);
    db.close();
    return join(dir, name);
  };
  try {
    const live = make("live.db", `INSERT INTO Setting VALUES ('auth.password', 'current'), ('theme', 'dark');
      INSERT INTO Device (name) VALUES ('phone'); INSERT INTO Session VALUES ('me')`);
    const backup = make("backup.db", `INSERT INTO Setting VALUES ('auth.password', 'old'), ('ntfy.topic', 'home'), ('mcp.token', 'revoked since');
      INSERT INTO Device (name) VALUES ('tv'), ('laptop'); INSERT INTO Session VALUES ('stranger')`);
    applyBackup(live, backup);

    const db = new Database(live, { readonly: true });
    expect(db.prepare("SELECT key, value FROM Setting ORDER BY key").all()).toEqual([
      { key: "auth.password", value: "current" },
      { key: "ntfy.topic", value: "home" },
    ]);
    expect(db.prepare("SELECT name FROM Device ORDER BY id").pluck().all()).toEqual(["tv", "laptop"]);
    expect(db.prepare("SELECT tokenHash FROM Session").pluck().all()).toEqual(["me"]);
    expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'Device'").pluck().get()).toBe(2);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a backup of the live database carries the data but no sessions or MCP token", async () => {
  await prisma.device.create({ data: { mac: "aa:bb:cc:dd:ee:01", ip: "192.168.0.20", lastSeen: new Date(), name: "Printer" } });
  await createSession();
  await createMcpToken();

  const file = createBackup("a passphrase");
  expect(inspectBackup(file, "a passphrase")).toMatchObject({ encrypted: true, upgrades: 0, counts: expect.objectContaining({ devices: 1 }) });
  const dir = mkdtempSync(join(tmpdir(), "lanscape-test-"));
  try {
    const path = join(dir, "copy.db");
    writeFileSync(path, unpack(file, "a passphrase").database);
    const copy = new Database(path, { readonly: true });
    expect(copy.prepare("SELECT name FROM Device").pluck().all()).toEqual(["Printer"]);
    expect(copy.prepare("SELECT COUNT(*) FROM Session").pluck().get()).toBe(0);
    expect(copy.prepare("SELECT COUNT(*) FROM Setting WHERE key = 'mcp.token'").pluck().get()).toBe(0);
    copy.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
