import { prisma } from "../db";

export type Status = { at: string; ok: boolean; summary?: string; error?: string };

const key = (name: string) => `status.${name}`;

// Last outcome of each background job and alert channel, so failures show in the app instead of only in logs
export const recordStatus = (name: string, outcome: Omit<Status, "at">) => {
  const value = JSON.stringify({ at: new Date().toISOString(), ...outcome });
  return prisma.setting
    .upsert({ where: { key: key(name) }, create: { key: key(name), value }, update: { value } })
    .catch((error: unknown) => console.error(`Recording ${name} status failed:`, error));
};

export const recordFailure = (name: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${name} failed:`, message);
  return recordStatus(name, { ok: false, error: message });
};

export const readStatus = async (name: string) => {
  const row = await prisma.setting.findUnique({ where: { key: key(name) } });
  return row ? (JSON.parse(row.value) as Status) : null;
};
