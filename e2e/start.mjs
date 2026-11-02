// Starts the built app for end-to-end tests: a throwaway database with the demo data (scripts/demo/seed.mjs),
// and stand-ins for speedtest-go and arp-scan, so nothing measures the real network. Run `npm run build` first.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "lanscape-e2e-"));
const database = join(dir, "lanscape.db");
const env = {
  ...process.env,
  DATABASE_URL: `file:${database}`,
  PORT: process.env.E2E_PORT ?? "4600",
  // Like Umbrel: the password is preset, so there's no first-run screen
  APP_PASSWORD: "e2e-password-1",
  SPEEDTEST_BIN: join(root, "e2e/stubs/speedtest-go"),
  ARP_SCAN_BIN: join(root, "e2e/stubs/arp-scan"),
};

execFileSync("npm", ["exec", "-w", "server", "--", "prisma", "migrate", "deploy"], { cwd: root, env, stdio: "inherit" });
execFileSync(process.execPath, [join(root, "scripts/demo/seed.mjs"), database], { cwd: root, stdio: "inherit" });
// The demo has invented alert channels for screenshots; an alert during the tests mustn't go anywhere
execFileSync(process.execPath, ["-e", `require("better-sqlite3")(process.argv[1]).exec("DELETE FROM Setting WHERE key LIKE 'ntfy.%' OR key LIKE 'telegram.%' OR key LIKE 'discord.%' OR key LIKE 'slack.%' OR key LIKE 'webhook.%' OR key LIKE 'pihole.%'")`, database], { cwd: join(root, "server"), stdio: "inherit" });

const server = spawn(process.execPath, [join(root, "server/dist/index.js")], { cwd: root, env, stdio: "inherit" });
const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
