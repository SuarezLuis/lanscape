import { z } from "zod";
import { prisma } from "../db";

export type Alert = {
  kind: "problem" | "resolved" | "device" | "test";
  title: string;
  message: string;
  metric?: string;
  value?: number;
  baseline?: number | null;
};

const TIMEOUT_MS = 10_000;
const httpUrl = z.url({ protocol: /^https?$/, error: "Expected an http(s) URL" });

const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`answered ${response.status} ${response.statusText}`);
  return response;
};

type Fields = Record<string, { schema: z.ZodType<string>; secret: boolean; optional?: boolean }>;
type Channel<F extends Fields> = { fields: F; send: (values: Record<keyof F, string | null>, alert: Alert) => Promise<unknown> };
const channel = <F extends Fields>(definition: Channel<F>) => definition;

// Secret fields are write-only: the page learns whether they're set, never their value
export const CHANNELS = {
  ntfy: channel({
    fields: { url: { schema: httpUrl, secret: false }, token: { schema: z.string().max(500), secret: true, optional: true } },
    send: async ({ url, token }, alert) => {
      const response = await fetch(url ?? "", {
        method: "POST",
        body: alert.message,
        headers: {
          Title: `LANscape: ${alert.title}`,
          Tags: { problem: "warning", resolved: "white_check_mark", device: "new", test: "white_check_mark" }[alert.kind],
          Priority: alert.kind === "problem" ? "high" : "default",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`answered ${response.status} ${response.statusText}`);
    },
  }),
  telegram: channel({
    fields: {
      token: { schema: z.string().regex(/^\d+:[\w-]+$/, "Expected a bot token like 123456:ABC-DEF"), secret: true },
      chatId: { schema: z.string().regex(/^(-?\d+|@\w+)$/, "Expected a numeric chat ID or @channel"), secret: false },
    },
    send: async ({ token, chatId }, alert) => {
      const response = await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: `LANscape: ${alert.title}\n${alert.message}`,
      });
      const body = (await response.json()) as { ok: boolean; description?: string };
      if (!body.ok) throw new Error(body.description ?? "Telegram refused the message");
    },
  }),
  discord: channel({
    fields: { url: { schema: httpUrl, secret: true } },
    send: ({ url }, alert) => postJson(url ?? "", { content: `**LANscape: ${alert.title}**\n${alert.message}` }),
  }),
  slack: channel({
    fields: { url: { schema: httpUrl, secret: true } },
    send: ({ url }, alert) => postJson(url ?? "", { text: `*LANscape: ${alert.title}*\n${alert.message}` }),
  }),
  webhook: channel({
    fields: { url: { schema: httpUrl, secret: false } },
    send: ({ url }, alert) => postJson(url ?? "", { app: "LANscape", time: new Date().toISOString(), ...alert }),
  }),
};

export type ChannelId = keyof typeof CHANNELS;
export const CHANNEL_IDS = Object.keys(CHANNELS) as [ChannelId, ...ChannelId[]];

const settingKey = (id: string, field: string) => `${id}.${field}`;

const readValues = async (id: ChannelId) => {
  const fields = Object.keys(CHANNELS[id].fields);
  const rows = await prisma.setting.findMany({ where: { key: { in: fields.map((field) => settingKey(id, field)) } } });
  return Object.fromEntries(fields.map((field) => [field, rows.find((row) => row.key === settingKey(id, field))?.value || null]));
};

const isConfigured = (id: ChannelId, values: Record<string, string | null>) =>
  Object.entries(CHANNELS[id].fields).every(([field, spec]) => spec.optional || values[field]);

// What the page may see: values of non-secret fields, and whether each field is set
export const describeChannels = async () =>
  Promise.all(
    CHANNEL_IDS.map(async (id) => {
      const values = await readValues(id);
      return {
        id,
        configured: isConfigured(id, values),
        fields: Object.entries(CHANNELS[id].fields).map(([field, spec]) => ({
          field,
          secret: spec.secret,
          isSet: values[field] !== null,
          value: spec.secret ? null : values[field],
        })),
      };
    }),
  );

// undefined keeps a field, "" clears it, anything else must pass the field's schema
export const saveChannel = async (id: ChannelId, changes: Record<string, string | undefined>) => {
  const fields = CHANNELS[id].fields as Fields;
  for (const [field, value] of Object.entries(changes)) {
    const spec = fields[field];
    if (!spec || value === undefined) continue;
    const check = value === "" ? null : spec.schema.safeParse(value);
    if (check && !check.success) throw new Error(check.error.issues[0]?.message ?? `Invalid ${field}`);
    const key = settingKey(id, field);
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
};

const send = async (id: ChannelId, alert: Alert) => {
  const values = await readValues(id);
  if (!isConfigured(id, values)) throw new Error("This channel isn't set up yet");
  await (CHANNELS[id] as Channel<Fields>).send(values, alert);
  return true;
};

export const sendTest = (id: ChannelId) =>
  send(id, { kind: "test", title: "Test notification", message: "Notifications from LANscape will arrive here." });

// Every configured channel gets every alert; one failing channel doesn't stop the rest
export const sendAll = async (alert: Alert) => {
  const configured: ChannelId[] = [];
  for (const id of CHANNEL_IDS) if (isConfigured(id, await readValues(id))) configured.push(id);
  const results = await Promise.allSettled(configured.map((id) => send(id, alert)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`${configured[i]} delivery failed:`, reason);
    }
  });
};
