// Starts the built app for end-to-end tests: a throwaway database with the demo data (scripts/demo/seed.mjs),
// and stand-ins for speedtest-go and arp-scan, so nothing measures the real network. Run `npm run build` first.
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
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

// A stand-in for an OpenAI-compatible model server (like Ollama): it asks for the device list, then answers from it
const model = createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    const send = (json) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(json));
    if (request.url === "/v1/models") return send({ data: [{ id: "fake-model" }] });
    // Streamed like the real thing: one "data:" line per delta
    const stream = (deltas) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finish_reason] of deltas) response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    };
    const last = JSON.parse(raw).messages.at(-1);
    if (last.role === "tool") {
      const { devices } = JSON.parse(last.content);
      return stream([[{ content: "You have " }, null], [{ content: `**${devices.length} devices** on your network.` }, null], [{}, "stop"]]);
    }
    stream([[{ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "list_devices", arguments: "{}" } }] }, null], [{}, "tool_calls"]]);
  });
});
model.listen(Number(process.env.E2E_MODEL_PORT ?? 4601), "127.0.0.1");

const server = spawn(process.execPath, [join(root, "server/dist/index.js")], { cwd: root, env, stdio: "inherit" });
const stop = () => server.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  model.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
