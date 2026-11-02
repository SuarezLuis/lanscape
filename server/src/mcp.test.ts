import { expect, test } from "vitest";
import { handleMcp, withinRateLimit } from "./mcp";

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
