import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chat, type ChatEvent, chatInput, describeAi, destination, saveAi } from "./ai";
import { prisma } from "./db";

// A fake provider: answers model lists, and chat requests from a script (first a tool call, then an answer)
type Seen = { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };
let seen: Seen[] = [];
let script: unknown[] = [];
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push({ path: request.url ?? "", headers: request.headers, body });
      const send = (status: number, json: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
      if (request.headers.authorization === "Bearer wrong" || request.headers["x-api-key"] === "wrong") return send(401, { error: { message: "invalid key" } });
      if (request.url?.split("?")[0]?.endsWith("/models")) {
        return send(200, { data: [{ id: "local-model", type: "model", display_name: "Local", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: null, last_id: null });
      }
      // Streamed: each scripted entry is a list of server-sent events ([event name, data])
      const events = script.shift() as [string | null, unknown][];
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [event, data] of events) response.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
      response.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

const question = [{ role: "user" as const, content: "How's my internet?" }];

test("says where the data goes: Anthropic and OpenAI are cloud, a LAN server is local", () => {
  expect(destination({ provider: "anthropic", url: "" })).toEqual({ local: false, name: "Anthropic" });
  expect(destination({ provider: "openai", url: "https://api.openai.com/v1" })).toEqual({ local: false, name: "OpenAI" });
  expect(destination({ provider: "openai", url: "https://openrouter.ai/api/v1" })).toEqual({ local: false, name: "openrouter.ai" });
  for (const url of ["http://localhost:11434/v1", "http://192.168.0.101:11434/v1", "http://umbrel.local:11434/v1", "http://ollama:11434/v1", "http://[::1]:11434/v1"]) {
    expect(destination({ provider: "openai", url }).local).toBe(true);
  }
});

test("keeps the history it's sent short, and wants a question last", () => {
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: `message ${i}` }));
  expect(chatInput.parse({ messages: [...long, { role: "user", content: "last" }] }).messages).toHaveLength(20);
  expect(chatInput.safeParse({ messages: [{ role: "assistant", content: "hi" }] }).success).toBe(false);
});

test("an OpenAI-compatible model calls a tool, and the answer comes back with what it looked at", async () => {
  await saveAi({ provider: "openai", url: `${base}/v1`, model: "local-model", apiKey: "" });
  expect(await describeAi()).toMatchObject({ provider: "openai", model: "local-model", keySet: false, local: true });
  seen = [];
  const delta = (delta: object, finish_reason: string | null = null) => [null, { choices: [{ delta, finish_reason }] }] as const;
  script = [
    [
      delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_outages", arguments: '{"range":' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"day"}' } }] }),
      delta({}, "tool_calls"),
      [null, "[DONE]"],
    ],
    [delta({ content: "No outages " }), delta({ content: "in the last day." }), delta({}, "stop"), [null, "[DONE]"]],
  ];

  const events: ChatEvent[] = [];
  const result = await chat(question, (event) => events.push(event));
  expect(events).toEqual([
    { type: "tool", name: "get_outages", input: { range: "day" } },
    { type: "tool_done", name: "get_outages", ok: true },
    { type: "round" },
    { type: "text", text: "No outages " },
    { type: "text", text: "in the last day." },
  ]);
  expect(result).toMatchObject({ reply: "No outages in the last day.", local: true, tools: [{ name: "get_outages", input: { range: "day" }, ok: true, result: "[]" }] });
  const [first, second] = seen;
  expect(first?.body.tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "list_devices" }) })]));
  expect(first?.body.stream).toBe(true);
  expect(second?.body.messages).toEqual(expect.arrayContaining([{ role: "tool", tool_call_id: "call_1", content: "[]" }]));
  expect(await prisma.mcpCall.findMany({ select: { tool: true, ip: true } })).toEqual([{ tool: "get_outages", ip: "LANscape chat" }]);
});

test("Claude gets the tools, the fallback setting, and the tool results in one message", async () => {
  process.env.ANTHROPIC_BASE_URL = base;
  await expect(saveAi({ provider: "anthropic", model: "claude-opus-5-5" })).rejects.toThrow("Enter an Anthropic API key");
  await expect(saveAi({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "wrong" })).rejects.toThrow();
  await saveAi({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-test" });
  // A later save without a key keeps the saved one
  await saveAi({ provider: "anthropic", model: "claude-opus-5-5" });
  expect(await describeAi()).toMatchObject({ provider: "anthropic", keySet: true, local: false, name: "Anthropic" });

  seen = [];
  // The Messages API's stream events for one response made of these blocks
  const stream = (blocks: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: object })[], stop_reason: string) => [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ...blocks.flatMap((block, index) => [
      ["content_block_start", { type: "content_block_start", index, content_block: block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} } }],
      ["content_block_delta", { type: "content_block_delta", index, delta: block.type === "text" ? { type: "text_delta", text: block.text } : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }],
      ["content_block_stop", { type: "content_block_stop", index }],
    ]),
    ["message_delta", { type: "message_delta", delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  script = [
    stream([{ type: "tool_use", id: "tu_1", name: "get_speed_history", input: { range: "week" } }, { type: "tool_use", id: "tu_2", name: "nope", input: {} }], "tool_use"),
    stream([{ type: "text", text: "No speed tests this week." }], "end_turn"),
  ];
  const events: ChatEvent[] = [];
  const result = await chat(question, (event) => events.push(event));
  expect(events.filter((event) => event.type === "text")).toEqual([{ type: "text", text: "No speed tests this week." }]);
  expect(result.reply).toBe("No speed tests this week.");
  expect(result.tools.map((tool) => [tool.name, tool.ok])).toEqual([["get_speed_history", true], ["nope", false]]);

  const [first, second] = seen.filter((request) => request.path.startsWith("/v1/messages"));
  expect(first?.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
  expect(first?.headers["x-api-key"]).toBe("sk-ant-test");
  expect(first?.body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", stream: true });
  const messages = second?.body.messages as { role: string; content: unknown }[];
  expect(messages.at(-1)).toEqual({
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "tu_1", content: "[]" },
      { type: "tool_result", tool_use_id: "tu_2", content: "Unknown tool: nope", is_error: true },
    ],
  });
  delete process.env.ANTHROPIC_BASE_URL;
});
