import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { createSession } from "./auth";
import { applyBackup, createBackup, inspectBackup, listSafetyBackups, pack, restoreBackup, undoRestore, unpack } from "./backup";
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

test("restore swaps in the backup's data, keeps a safety copy, and undo puts it back", async () => {
  await prisma.device.create({ data: { mac: "aa:bb:cc:dd:ee:02", ip: "192.168.0.21", lastSeen: new Date(), name: "TV" } });
  const file = createBackup();
  await prisma.device.update({ where: { mac: "aa:bb:cc:dd:ee:02" }, data: { name: "Renamed after the backup" } });
  await prisma.device.create({ data: { mac: "aa:bb:cc:dd:ee:03", ip: "192.168.0.22", lastSeen: new Date() } });

  expect(restoreBackup(file)).toMatchObject({ counts: expect.objectContaining({ devices: 1 }) });
  expect(await prisma.device.findMany({ select: { name: true } })).toEqual([{ name: "TV" }]);
  expect(listSafetyBackups().length).toBeGreaterThan(0);

  undoRestore();
  expect(await prisma.device.findMany({ orderBy: { mac: "asc" }, select: { name: true } })).toEqual([{ name: "Renamed after the backup" }, { name: null }]);
});

test("a backup from an older version is brought up to date as it's restored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lanscape-test-"));
  try {
    // A database as an older LANscape left it: every migration but the newest
    const migrations = join(import.meta.dirname, "../prisma/migrations");
    const names = readdirSync(migrations).filter((name) => /^\d/.test(name)).toSorted();
    const old = new Database(join(dir, "old.db"));
    old.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0)");
    for (const name of names.slice(0, -1)) {
      const sql = readFileSync(join(migrations, name, "migration.sql"), "utf8");
      old.exec(sql);
      old.prepare("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, current_timestamp, ?, 1)").run(name, createHash("sha256").update(sql).digest("hex"), name);
    }
    old.prepare("INSERT INTO Device (mac, ip, lastSeen, name) VALUES (?, ?, ?, ?)").run("aa:bb:cc:dd:ee:04", "192.168.0.23", new Date().toISOString(), "Old printer");
    old.close();
    const file = pack({ ...header, app: "1.0.0" }, readFileSync(join(dir, "old.db")));

    expect(inspectBackup(file)).toMatchObject({ upgrades: 1 });
    restoreBackup(file);
    expect(await prisma.device.findMany({ select: { name: true } })).toEqual([{ name: "Old printer" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
