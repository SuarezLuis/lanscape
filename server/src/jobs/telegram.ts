import { prisma } from "../db";
import { readValues } from "./channels";

const CHATS = "telegram.chats";
const MAX_CHATS = 10;
const POLL_SECONDS = 25;

type Chat = { id: number; type: string; title?: string; first_name?: string; last_name?: string };
type Update = { update_id: number; message?: { chat: Chat; text?: string } };

const telegram = async <T>(token: string, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json()) as { ok: boolean; description?: string; result: T };
  if (!body.ok) throw new Error(body.description ?? `Telegram refused ${method}`);
  return body.result;
};

const chatName = (chat: Chat) => chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ");

const readChats = async () => {
  const row = await prisma.setting.findUnique({ where: { key: CHATS } });
  return row ? (JSON.parse(row.value) as { id: string; name: string }[]) : [];
};

// Most recent first, so the chat that just pressed Start tops the list
const rememberChat = async (chat: Chat) => {
  const entry = { id: String(chat.id), name: chatName(chat) };
  const chats = [entry, ...(await readChats()).filter((known) => known.id !== entry.id)].slice(0, MAX_CHATS);
  const value = JSON.stringify(chats);
  await prisma.setting.upsert({ where: { key: CHATS }, create: { key: CHATS, value }, update: { value } });
};

const reply = (token: string, chat: Chat) =>
  telegram(token, "sendMessage", {
    chat_id: chat.id,
    text:
      "I'm the LANscape alert bot. I only send alerts about your home network and can't answer messages.\n\n" +
      `This chat's ID is ${chat.id}. To get alerts here, click Find chat ID in LANscape, then Save.`,
  });

// Chats come from the poller below: while it holds getUpdates, a second getUpdates call would conflict
export const findTelegramChats = async () => {
  const { token } = await readValues("telegram");
  if (!token) throw new Error("Save the bot token first");
  const bot = await telegram<{ username: string }>(token, "getMe");
  return { bot: bot.username, chats: await readChats() };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long-polls Telegram so the bot can answer anyone who messages it. Webhooks would need a public HTTPS address;
 * polling is outbound only. Picks up a new or removed token within one poll.
 */
export const startTelegramReplies = async () => {
  let offset = 0;
  let lastToken: string | null = null;
  for (;;) {
    const { token } = await readValues("telegram").catch(() => ({ token: null }));
    if (!token) {
      await sleep(30_000);
      continue;
    }
    if (token !== lastToken) [offset, lastToken] = [0, token];
    try {
      const updates = await telegram<Update[]>(
        token,
        "getUpdates",
        { offset, timeout: POLL_SECONDS, allowed_updates: ["message"] },
        (POLL_SECONDS + 10) * 1000,
      );
      for (const update of updates) {
        offset = update.update_id + 1;
        const chat = update.message?.chat;
        if (!chat) continue;
        await rememberChat(chat);
        // In groups, only answer /start, so the bot doesn't reply to every message it can see
        if (chat.type === "private" || update.message?.text?.startsWith("/start")) await reply(token, chat);
      }
    } catch (error) {
      console.error("Telegram polling failed:", error instanceof Error ? error.message : error);
      await sleep(60_000);
    }
  }
};
