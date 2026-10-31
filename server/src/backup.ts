import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { PASSWORD } from "./auth";
import { databasePath } from "./db";

/**
 * A backup is one file: a JSON header line, then the gzipped SQLite database. With a passphrase the database part is
 * AES-256-GCM encrypted (key from scrypt), with the header as associated data so it can't be edited either.
 */
const FORMAT = "lanscape-backup";
const FORMAT_VERSION = 1;
const SAFETY_KEPT = 3;

const serverDir = fileURLToPath(new URL("..", import.meta.url));
export const safetyDir = join(dirname(databasePath), "backups");

export class BackupError extends Error {}

export type BackupHeader = {
  format: typeof FORMAT;
  version: number;
  app: string;
  createdAt: string;
  encrypted: boolean;
};

export type BackupPreview = Omit<BackupHeader, "format" | "version"> & {
  counts: Record<string, number>;
  // Older backups are brought up to this version's schema on restore
  upgrades: number;
};

// Run on the backup before it's upgraded, so only name tables and columns every backup has (all exist since 1.0.0)
const COUNTS = {
  devices: "SELECT COUNT(*) FROM Device",
  namedDevices: "SELECT COUNT(*) FROM Device WHERE name IS NOT NULL",
  speedTests: "SELECT COUNT(*) FROM SpeedTest",
  pingChecks: "SELECT COUNT(*) FROM PingSample",
  rules: "SELECT COUNT(*) FROM NotificationRule",
  alerts: "SELECT COUNT(*) FROM Notification",
  schedules: "SELECT COUNT(*) FROM Automation",
};

const keyFor = (passphrase: string, salt: Buffer) => scryptSync(passphrase, salt, 32);

export const pack = (header: BackupHeader, database: Buffer, passphrase?: string) => {
  const head = Buffer.from(`${JSON.stringify({ ...header, encrypted: Boolean(passphrase) })}\n`);
  const body = gzipSync(database);
  if (!passphrase) return Buffer.concat([head, body]);
  const [salt, iv] = [randomBytes(16), randomBytes(12)];
  const cipher = createCipheriv("aes-256-gcm", keyFor(passphrase, salt), iv).setAAD(head);
  const data = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([head, salt, iv, cipher.getAuthTag(), data]);
};

export const unpack = (file: Buffer, passphrase?: string) => {
  const end = file.indexOf(0x0a);
  let header: BackupHeader | undefined;
  try {
    header = end > 0 && end < 4096 ? JSON.parse(file.subarray(0, end).toString()) : undefined;
  } catch {}
  if (header?.format !== FORMAT) throw new BackupError("This isn't a LANscape backup file.");
  if (header.version !== FORMAT_VERSION) throw new BackupError("This backup was made by a newer LANscape. Update LANscape first.");

  let body = file.subarray(end + 1);
  if (header.encrypted) {
    if (!passphrase) throw new BackupError("This backup is encrypted. Enter its passphrase.");
    const decipher = createDecipheriv("aes-256-gcm", keyFor(passphrase, body.subarray(0, 16)), body.subarray(16, 28))
      .setAAD(file.subarray(0, end + 1))
      .setAuthTag(body.subarray(28, 44));
    try {
      body = Buffer.concat([decipher.update(body.subarray(44)), decipher.final()]);
    } catch {
      throw new BackupError("Wrong passphrase, or the file is damaged.");
    }
  }
  try {
    return { header, database: gunzipSync(body) };
  } catch {
    throw new BackupError("The backup file is damaged.");
  }
};

const appliedMigrations = (db: Database.Database) =>
  db
    .prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
    .pluck()
    .all() as string[];

const knownMigrations = () =>
  readdirSync(join(serverDir, "prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

const withTempDir = <T>(fn: (dir: string) => T) => {
  const dir = mkdtempSync(join(tmpdir(), "lanscape-backup-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// VACUUM INTO takes a consistent copy while jobs keep writing. Sessions stay out: a backup shouldn't sign anyone in
export const createBackup = (passphrase?: string) =>
  withTempDir((dir) => {
    const copy = join(dir, "lanscape.db");
    const live = new Database(databasePath, { fileMustExist: true });
    try {
      live.pragma("busy_timeout = 10000");
      live.prepare("VACUUM INTO ?").run(copy);
    } finally {
      live.close();
    }
    const snapshot = new Database(copy);
    snapshot.exec("DELETE FROM Session; VACUUM");
    snapshot.close();
    const header = { format: FORMAT, version: FORMAT_VERSION, app: process.env.APP_VERSION ?? "dev", createdAt: new Date().toISOString(), encrypted: false } as const;
    return pack(header, readFileSync(copy), passphrase);
  });

// Unpacks into a temp file and checks it's a sound LANscape database this version can take
const stage = (dir: string, file: Buffer, passphrase?: string) => {
  const { header, database } = unpack(file, passphrase);
  const path = join(dir, "restore.db");
  writeFileSync(path, database);
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new BackupError("The database in this backup is damaged.");
    const known = new Set(knownMigrations());
    const applied = appliedMigrations(db);
    if (applied.some((name) => !known.has(name))) throw new BackupError("This backup was made by a newer LANscape. Update LANscape first.");
    const counts = Object.fromEntries(Object.entries(COUNTS).map(([key, sql]) => [key, db!.prepare(sql).pluck().get() as number]));
    const preview: BackupPreview = { app: header.app, createdAt: header.createdAt, encrypted: header.encrypted, counts, upgrades: known.size - applied.length };
    return { path, preview };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError("This backup doesn't contain a LANscape database.");
  } finally {
    db?.close();
  }
};

export const inspectBackup = (file: Buffer, passphrase?: string) => withTempDir((dir) => stage(dir, file, passphrase).preview);

/**
 * Replaces every table's rows with the backup's in one transaction, so a failure leaves the data as it was. Sessions
 * and the current password stay: whoever restores stays signed in and keeps the password they know.
 */
export const applyBackup = (livePath: string, backupPath: string) => {
  const live = new Database(livePath, { fileMustExist: true });
  try {
    live.pragma("busy_timeout = 10000");
    live.pragma("foreign_keys = OFF");
    live.prepare("ATTACH ? AS backup").run(backupPath);
    const tables = live
      .prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT IN ('_prisma_migrations', 'Session') AND name NOT LIKE 'sqlite_%'")
      .pluck()
      .all() as string[];
    live.transaction(() => {
      const password = live.prepare("SELECT value FROM Setting WHERE key = ?").pluck().get(PASSWORD);
      for (const table of tables) {
        const columns = (live.prepare("SELECT name FROM pragma_table_info(?)").pluck().all(table) as string[]).map((name) => `"${name}"`).join(", ");
        live.exec(`DELETE FROM main."${table}"; INSERT INTO main."${table}" (${columns}) SELECT ${columns} FROM backup."${table}"`);
      }
      live.exec("DELETE FROM main.sqlite_sequence; INSERT INTO main.sqlite_sequence SELECT * FROM backup.sqlite_sequence");
      if (password !== undefined) live.prepare("INSERT OR REPLACE INTO Setting (key, value) VALUES (?, ?)").run(PASSWORD, password);
    })();
  } finally {
    live.close();
  }
};

const saveSafetyBackup = () => {
  mkdirSync(safetyDir, { recursive: true });
  writeFileSync(join(safetyDir, `before-restore-${new Date().toISOString().replaceAll(":", "-")}.lanscape`), createBackup());
  for (const old of listSafetyBackups().slice(SAFETY_KEPT)) rmSync(join(safetyDir, old));
};

// Newest first; the names sort by time
export const listSafetyBackups = () => {
  try {
    return readdirSync(safetyDir).filter((name) => name.endsWith(".lanscape")).sort().reverse();
  } catch {
    return [];
  }
};

export const restoreBackup = (file: Buffer, passphrase?: string) =>
  withTempDir((dir) => {
    const { path, preview } = stage(dir, file, passphrase);
    // Same migrations the container runs on start, so an older backup gets this version's schema first
    if (preview.upgrades > 0) {
      execFileSync(join(serverDir, "../node_modules/.bin/prisma"), ["migrate", "deploy"], {
        cwd: serverDir,
        env: { ...process.env, DATABASE_URL: `file:${path}` },
        stdio: "pipe",
      });
    }
    saveSafetyBackup();
    applyBackup(databasePath, path);
    return preview;
  });

// The way back from a restore: the data as it was just before it
export const undoRestore = () => {
  const [latest] = listSafetyBackups();
  if (!latest) throw new BackupError("There's no restore to undo.");
  const file = readFileSync(join(safetyDir, latest));
  const preview = restoreBackup(file);
  // Restoring made its own safety copy; the one just used is spent
  rmSync(join(safetyDir, latest), { force: true });
  return preview;
};
