import { prisma } from "../db";

// What devices say about themselves, by MAC (see MacTrait in the schema)
export const TRAIT_KINDS = ["cast", "airplay", "hap", "ssdp", "model", "dhcp-host", "dhcp-vendor", "dhcp-fp"] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];
export type TraitMap = Partial<Record<TraitKind, string>>;

export const saveTraits = async (mac: string, traits: TraitMap, now = new Date()) => {
  for (const [kind, value] of Object.entries(traits)) {
    if (!value) continue;
    await prisma.macTrait.upsert({ where: { mac_kind: { mac, kind } }, create: { mac, kind, value, seenAt: now }, update: { value, seenAt: now } });
  }
};

export const readTraits = async (macs: string[]) => {
  const rows = await prisma.macTrait.findMany({ where: { mac: { in: macs } } });
  const traits = new Map<string, TraitMap>();
  for (const row of rows) traits.set(row.mac, { ...traits.get(row.mac), [row.kind]: row.value });
  return traits;
};

// Traits of MACs no device has anymore, after a long while
export const pruneTraits = () =>
  prisma.$executeRaw`DELETE FROM MacTrait WHERE seenAt < ${new Date(Date.now() - 180 * 86_400_000).toISOString().replace("Z", "+00:00")} AND mac NOT IN (SELECT mac FROM Device)`;
