import { describe, expect, test } from "vitest";
import { prisma } from "./db";
import { listChanges, undoChange } from "./changes";
import { createMcpToken, handleMcp, mcpScope, revokeMcpToken, withinRateLimit } from "./mcp";

test("answers the MCP handshake and lists read-only tools", async () => {
  const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, "test");
  expect(init).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } });
  const unknownVersion = await handleMcp({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, "test");
  expect(unknownVersion).toMatchObject({ result: { protocolVersion: "2025-11-25" } });

  expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, "test")).toBeNull();

  const list = (await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/list" }, "test")) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
  expect(list.result.tools.map((tool) => tool.name)).toContain("get_network_summary");
  expect(list.result.tools.every((tool) => tool.inputSchema.type === "object")).toBe(true);

  expect(await handleMcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "drop_tables" } }, "test")).toMatchObject({ error: { code: -32602 } });
  expect(await handleMcp({ jsonrpc: "2.0", id: 5, method: "resources/list" }, "test")).toMatchObject({ error: { code: -32601 } });
  expect(await handleMcp({ id: 6 }, "test")).toMatchObject({ error: { code: -32600 } });
});

test("rate limit allows 120 requests a minute per address", () => {
  const now = 1_000_000;
  for (let i = 0; i < 120; i++) expect(withinRateLimit("10.0.0.9", now)).toBe(true);
  expect(withinRateLimit("10.0.0.9", now)).toBe(false);
  expect(withinRateLimit("10.0.0.8", now)).toBe(true);
  expect(withinRateLimit("10.0.0.9", now + 60_000)).toBe(true);
});

describe("with the database", () => {
  const call = (name: string, args: object = {}) =>
    handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, "10.0.0.5") as Promise<{
      result: { content: { text: string }[]; isError?: boolean };
    }>;

  test("only the newest token works, and only until it's revoked; the change token is separate", async () => {
    expect(await mcpScope("Bearer anything")).toBeNull();
    const first = await createMcpToken();
    const second = await createMcpToken();
    const change = await createMcpToken("change");
    expect(await mcpScope(`Bearer ${first}`)).toBeNull();
    expect(await mcpScope(`Bearer ${second}`)).toBe("read");
    expect(await mcpScope(`Bearer ${change}`)).toBe("change");
    await revokeMcpToken();
    expect(await mcpScope(`Bearer ${second}`)).toBeNull();
    expect(await mcpScope(`Bearer ${change}`)).toBe("change");
  });

  test("change tools only run for a change token, are logged with who made them, and undo", async () => {
    await prisma.device.create({ data: { mac: "aa:aa:aa:aa:aa:09", ip: "192.168.0.9", hostname: "esp-1234", lastSeen: new Date() } });
    const rename = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rename_device", arguments: { mac: "aa:aa:aa:aa:aa:09", name: "Porch light" } } };
    const list = (scope: "read" | "change") => handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "10.0.0.5", scope) as Promise<{ result: { tools: { name: string }[] } }>;
    expect((await list("read")).result.tools.map((tool) => tool.name)).not.toContain("rename_device");
    expect((await list("change")).result.tools.map((tool) => tool.name)).toContain("rename_device");
    expect((await list("change")).result.tools.map((tool) => tool.name)).not.toContain("remove_service_check");
    expect(await handleMcp(rename, "10.0.0.5")).toMatchObject({ error: { code: -32602 } });
    expect(await handleMcp(rename, "10.0.0.5", "change")).toMatchObject({ result: { content: [{ text: "Done: Rename esp-1234 (192.168.0.9) to “Porch light”. The owner can undo it in LANscape." }] } });
    const [change] = await listChanges();
    expect(change).toMatchObject({ by: "MCP agent at 10.0.0.5", tool: "rename_device", undoneAt: null });
    await undoChange(change!.id);
    expect((await prisma.device.findUniqueOrThrow({ where: { mac: "aa:aa:aa:aa:aa:09" } })).name).toBeNull();
    await expect(undoChange(change!.id)).rejects.toThrow("Already undone");
  });

  test("the summary counts devices and ping loss, and every call is logged", async () => {
    const scan = new Date();
    await prisma.setting.create({ data: { key: "devices.lastScan", value: scan.toISOString() } });
    await prisma.device.createMany({
      data: [
        { mac: "aa:aa:aa:aa:aa:01", ip: "192.168.0.10", lastSeen: scan, known: true },
        { mac: "aa:aa:aa:aa:aa:02", ip: "192.168.0.11", lastSeen: scan },
        { mac: "aa:aa:aa:aa:aa:03", ip: "192.168.0.12", lastSeen: new Date(scan.getTime() - 3_600_000) },
      ],
    });
    await prisma.pingSample.createMany({
      data: [
        { target: "internet", host: "1.1.1.1", sent: 5, received: 5, avgMs: 10 },
        { target: "internet", host: "1.1.1.1", sent: 5, received: 0, avgMs: null },
      ],
    });

    const summary = JSON.parse((await call("get_network_summary")).result.content[0]!.text);
    expect(summary.devices).toMatchObject({ total: 3, online: 2, unknown: 2, unknownOnline: 1 });
    expect(summary.pingLast24h.internet).toEqual({ checks: 2, averageMs: 10, packetLossPercent: 50 });

    const history = await call("get_device_history", { mac: "AA:AA:AA:AA:AA:09" });
    expect(history.result).toMatchObject({ isError: true, content: [{ text: "No device with MAC aa:aa:aa:aa:aa:09" }] });
    expect(await prisma.mcpCall.findMany({ select: { tool: true, ok: true, ip: true } })).toEqual([
      { tool: "get_network_summary", ok: true, ip: "10.0.0.5" },
      { tool: "get_device_history", ok: false, ip: "10.0.0.5" },
    ]);
  });
});
