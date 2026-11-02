import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "./db";
import { callTool, INSTRUCTIONS, toolList } from "./mcp";

/**
 * Built-in chat: a model of the owner's choice answers questions about the network with the same read-only tools
 * the MCP server offers. Claude goes through Anthropic's SDK; OpenAI, Ollama and other OpenAI-compatible servers
 * through their chat completions endpoint. Conversations aren't stored: the browser sends the recent history.
 */

const KEYS = { provider: "ai.provider", url: "ai.url", model: "ai.model", apiKey: "ai.apiKey" } as const;
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_URL = "https://api.openai.com/v1";

// Bounds: what the browser may send, how long tool use may go on, and how much one tool result may add
const MAX_MESSAGES = 20;
const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_TEXT = 30_000;
const TIMEOUT_MS = 120_000;

type Provider = "anthropic" | "openai";
type Settings = { provider: Provider; url: string; model: string; apiKey: string | null };

const readSettings = async (): Promise<Settings | null> => {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  const provider = value(KEYS.provider);
  if (provider !== "anthropic" && provider !== "openai") return null;
  const model = value(KEYS.model);
  return model ? { provider, url: value(KEYS.url) ?? DEFAULT_URL, model, apiKey: value(KEYS.apiKey) } : null;
};

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|[^.]+$|.+\.local$|.+\.lan$|.+\.home\.arpa$)/i;

// Where questions and the data the tools return end up: a server on this network, or a company's cloud
export const destination = (settings: Pick<Settings, "provider" | "url">) => {
  if (settings.provider === "anthropic") return { local: false, name: "Anthropic" };
  const host = URL.parse(settings.url)?.hostname ?? settings.url;
  if (PRIVATE_HOST.test(host)) return { local: true, name: host };
  return { local: false, name: host === "api.openai.com" ? "OpenAI" : host };
};

export const describeAi = async () => {
  const settings = await readSettings();
  return settings && { provider: settings.provider, url: settings.url, model: settings.model, keySet: settings.apiKey !== null, ...destination(settings) };
};

export const aiSettings = z.object({
  provider: z.enum(["anthropic", "openai"]),
  url: z.url({ protocol: /^https?$/ }).max(300).transform((url) => url.replace(/\/+$/, "")).optional(),
  model: z.string().trim().min(1).max(200),
  // undefined keeps the saved one; "" clears it (Ollama needs none)
  apiKey: z.string().trim().max(500).optional(),
});

// Effort and thinking are left to each model's defaults, so whichever Claude model the owner picks works
const anthropic = (settings: Settings) => new Anthropic({ apiKey: settings.apiKey ?? "", timeout: TIMEOUT_MS, maxRetries: 1 });

const openaiFetch = async (settings: Settings, path: string, body?: unknown) => {
  const response = await fetch(`${settings.url}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  if (!response.ok) {
    const message = typeof json?.error === "string" ? json.error : json?.error?.message;
    throw new Error(`${destination(settings).name} answered ${response.status}${message ? `: ${message}` : ""}`);
  }
  return json;
};

// The models the key or server offers, newest first where the API says; also how a connection is tested
export const listModels = async (settings: Settings) => {
  if (settings.provider === "anthropic") {
    const ids: string[] = [];
    for await (const model of anthropic(settings).models.list({ limit: 100 })) ids.push(model.id);
    return ids;
  }
  const json = (await openaiFetch(settings, "/models")) as { data?: { id: string }[] } | null;
  return (json?.data ?? []).map((model) => model.id).toSorted();
};

// Saves only once the provider accepts the settings, like the Pi-hole connection
export const saveAi = async (input: z.output<typeof aiSettings>) => {
  const saved = await readSettings();
  const apiKey = input.apiKey === undefined ? (saved?.provider === input.provider ? saved.apiKey : null) : input.apiKey || null;
  const settings: Settings = { provider: input.provider, url: input.url ?? DEFAULT_URL, model: input.model, apiKey };
  if (settings.provider === "anthropic" && !apiKey) throw new Error("Enter an Anthropic API key");
  const models = await listModels(settings);
  const values = { [KEYS.provider]: settings.provider, [KEYS.url]: settings.url, [KEYS.model]: settings.model };
  await prisma.$transaction([
    ...Object.entries(values).map(([key, value]) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })),
    apiKey ? prisma.setting.upsert({ where: { key: KEYS.apiKey }, create: { key: KEYS.apiKey, value: apiKey }, update: { value: apiKey } }) : prisma.setting.deleteMany({ where: { key: KEYS.apiKey } }),
  ]);
  return { models: models.length, modelFound: models.length === 0 || models.includes(settings.model) };
};

// The provider's own message ("invalid x-api-key", "model not found") is what the owner needs to see
export const providerError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message) ? "Couldn't reach the AI provider" : message;
};

export const removeAi = () => prisma.setting.deleteMany({ where: { key: { in: Object.values(KEYS) } } });

export const chatInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) }))
    .min(1)
    .transform((messages) => messages.slice(-MAX_MESSAGES))
    .refine((messages) => messages.at(-1)?.role === "user", "The last message must be a question"),
});
type ChatMessage = z.output<typeof chatInput>["messages"][number];

export type ToolUse = { name: string; input: unknown; ok: boolean; result: string };

const system = () =>
  `${INSTRUCTIONS}

You are the assistant built into LANscape, answering the owner's questions about their home network. The current time is ${new Date().toISOString()} (UTC).
- Use the tools for every fact about the network; never guess numbers, names or times.
- Ground each claim in what a tool returned, and say what it was based on ("the speed tests from the last week show..."). If the data doesn't cover the question, say so.
- Keep a clear line between what the data shows and possible causes; offer causes as possibilities.
- Answer in plain language, briefly. Use the owner's device names. Show times in a readable form.`;

const clip = (text: string) => (text.length > MAX_TOOL_TEXT ? `${text.slice(0, MAX_TOOL_TEXT)}\n[cut at ${MAX_TOOL_TEXT} characters; ask for a narrower range]` : text);

// What the browser hears while an answer is worked out: text as it's written, and each tool as it runs.
// "round" starts over the text: words written before a tool call are replaced by what comes after it
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "round" }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_done"; name: string; ok: boolean };
type Emit = (event: ChatEvent) => void;

const runTool = async (name: string, input: unknown, emit: Emit): Promise<ToolUse> => {
  emit({ type: "tool", name, input });
  const { text, isError } = await callTool(name, input, "LANscape chat");
  emit({ type: "tool_done", name, ok: !isError });
  return { name, input, ok: !isError, result: clip(text) };
};

const chatAnthropic = async (settings: Settings, history: ChatMessage[], used: ToolUse[], emit: Emit) => {
  const client = anthropic(settings);
  // eager_input_streaming stays off: these inputs are a few bytes ({"range":"week"}), so buffered validation costs
  // nothing, and callTool validates every input again anyway
  const tools = toolList.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema as Anthropic.Beta.BetaTool.InputSchema }));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((message) => ({ role: message.role, content: message.content }));
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (round > 0) emit({ type: "round" });
    const stream = client.beta.messages.stream({
      model: settings.model,
      max_tokens: 16000,
      system: system(),
      tools,
      // On a policy decline, Anthropic retries on its default fallback model instead of stopping
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    });
    stream.on("text", (text) => emit({ type: "text", text }));
    const response = await stream.finalMessage();
    if (response.stop_reason === "refusal") return "The model declined to answer this one.";
    const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim();
    const calls = response.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
    // A turn cut off at max_tokens may hold a half-written tool call, so its tools never run
    if (response.stop_reason !== "tool_use" || calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      return (text || "No answer came back.") + (response.stop_reason === "max_tokens" ? "\n\n(The answer was cut off.)" : "");
    }
    messages.push({ role: "assistant", content: response.content });
    // Run together, listed in the order asked, and returned in one message so parallel calls stay parallel
    const results = await Promise.all(calls.map((call) => runTool(call.name, call.input, emit)));
    used.push(...results);
    messages.push({
      role: "user",
      content: results.map((result, i) => ({ type: "tool_result" as const, tool_use_id: calls[i]!.id, content: result.result, ...(result.ok ? {} : { is_error: true }) })),
    });
  }
  return "No answer came back.";
};

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAIMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type Delta = { choices?: { finish_reason?: string | null; delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };

// One streamed chat completion: server-sent "data:" lines, each a delta; tool calls arrive in pieces by index
const openaiStream = async (settings: Settings, body: unknown, emit: Emit) => {
  const response = await fetch(`${settings.url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
    const message = typeof json?.error === "string" ? json.error : json?.error?.message;
    throw new Error(`${destination(settings).name} answered ${response.status}${message ? `: ${message}` : ""}`);
  }
  let content = "";
  let finish: string | null = null;
  const calls: ToolCall[] = [];
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      const choice = (JSON.parse(data) as Delta).choices?.[0];
      if (choice?.delta?.content) {
        content += choice.delta.content;
        emit({ type: "text", text: choice.delta.content });
      }
      for (const piece of choice?.delta?.tool_calls ?? []) {
        const call = (calls[piece.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
        if (piece.id) call.id = piece.id;
        call.function.name += piece.function?.name ?? "";
        call.function.arguments += piece.function?.arguments ?? "";
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
    }
  }
  return { content, finish, calls: calls.filter(Boolean) };
};

const chatOpenAI = async (settings: Settings, history: ChatMessage[], used: ToolUse[], emit: Emit) => {
  const tools = toolList.map(({ name, description, inputSchema }) => ({ type: "function", function: { name, description, parameters: inputSchema } }));
  const messages: OpenAIMessage[] = [{ role: "system", content: system() }, ...history];
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (round > 0) emit({ type: "round" });
    const { content, finish, calls } = await openaiStream(settings, { model: settings.model, messages, tools, stream: true }, emit);
    if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
      return (content.trim() || "No answer came back.") + (finish === "length" ? "\n\n(The answer was cut off.)" : "");
    }
    messages.push({ role: "assistant", content: content || null, tool_calls: calls });
    for (const call of calls) {
      let input: unknown = {};
      try {
        input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({ role: "tool", tool_call_id: call.id, content: "The arguments weren't valid JSON." });
        continue;
      }
      const result = await runTool(call.function.name, input, emit);
      used.push(result);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.result });
    }
  }
  return "No answer came back.";
};

export const chat = async (history: ChatMessage[], emit: Emit = () => {}) => {
  const settings = await readSettings();
  if (!settings) throw new Error("Set up the assistant first, under Integrations → AI assistant.");
  const used: ToolUse[] = [];
  const reply = settings.provider === "anthropic" ? await chatAnthropic(settings, history, used, emit) : await chatOpenAI(settings, history, used, emit);
  return { reply, tools: used, ...destination(settings) };
};
