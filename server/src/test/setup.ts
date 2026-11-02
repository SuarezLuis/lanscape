import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeEach } from "vitest";

// Each test file gets its own SQLite file with the real migrations applied, emptied before every test
const dir = mkdtempSync(join(tmpdir(), "lanscape-test-db-"));
const path = join(dir, "test.db");
const migrations = join(import.meta.dirname, "../../prisma/migrations");
const db = new Database(path);
// Recorded like prisma migrate does, since backups check which migrations a database has
db.exec("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME, started_at DATETIME NOT NULL DEFAULT current_timestamp, applied_steps_count INTEGER NOT NULL DEFAULT 0)");
for (const name of readdirSync(migrations).filter((entry) => /^\d/.test(entry)).toSorted()) {
  db.exec(readFileSync(join(migrations, name, "migration.sql"), "utf8"));
  db.prepare("INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, '', current_timestamp, ?, 1)").run(name, name);
}
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'")
  .pluck()
  .all() as string[];
db.close();
process.env.DATABASE_URL = `file:${path}`;

const { prisma } = await import("../db");

beforeEach(async () => {
  for (const table of tables) await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});
