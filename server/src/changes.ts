import { z } from "zod";
import { prisma } from "./db";
import { deviceLabel } from "./jobs/devices";
import { ruleText } from "./jobs/notify";
import { SERVICE_EVERY, serviceInput } from "./jobs/services";

/**
 * Changes an AI may make to LANscape's own data: names, known marks, per-device alerts, service checks, alert rules.
 * Nothing here touches the network itself. Each change is planned first (what exactly it will do, in words), then
 * applied and logged with who made it and how to put things back. The assistant only proposes: the owner approves
 * each change in the app. MCP agents need a separate change token.
 */

type Undo = { tool: string; input: Record<string, unknown> };
type Plan = { summary: string; apply: () => Promise<Undo | null> };
type ChangeTool<Input extends z.ZodObject> = { description: string; input: Input; plan: (input: z.output<Input>) => Promise<Plan>; hidden?: boolean };
const changeTool = <Input extends z.ZodObject>(definition: ChangeTool<Input>) => definition as unknown as ChangeTool<z.ZodObject>;

const mac = z.string().trim().toLowerCase().regex(/^([\da-f]{2}:){5}[\da-f]{2}$/, "A MAC like aa:bb:cc:dd:ee:ff");
const OFFLINE_MINUTES = [5, 10, 30, 60] as const;
const ONLINE_MINUTES = [15, 30, 60, 240] as const;
const minutes = (choices: readonly number[]) => z.union(choices.map((value) => z.literal(value))).nullable();

const findDevice = async (address: string) => {
  const device = await prisma.device.findUnique({ where: { mac: address } });
  if (!device) throw new Error(`No device with MAC ${address}`);
  return { device, label: `${deviceLabel(device)} (${device.ip})` };
};

const findRule = async (id: number) => {
  const rule = await prisma.notificationRule.findUnique({ where: { id } });
  if (!rule) throw new Error(`No alert rule with id ${id}`);
  return rule;
};

export const CHANGE_TOOLS: Record<string, ChangeTool<z.ZodObject>> = {
  rename_device: changeTool({
    description: "Give a device a name (shown instead of its hostname), or clear it with an empty name. Find the MAC with list_devices.",
    input: z.object({ mac, name: z.string().trim().max(60).describe("The new name; empty clears it") }),
    plan: async ({ mac, name }) => {
      const { device, label } = await findDevice(mac);
      if ((device.name ?? "") === name) throw new Error(`${label} already has that name`);
      return {
        summary: name ? `Rename ${label} to “${name}”` : `Clear the name of ${label}`,
        apply: async () => {
          await prisma.device.update({ where: { mac }, data: { name: name || null } });
          return { tool: "rename_device", input: { mac, name: device.name ?? "" } };
        },
      };
    },
  }),
  set_device_known: changeTool({
    description: "Mark a device as known (the owner recognizes it) or as unknown again. Unknown devices are the ones LANscape flags.",
    input: z.object({ mac, known: z.boolean() }),
    plan: async ({ mac, known }) => {
      const { device, label } = await findDevice(mac);
      if (device.known === known) throw new Error(`${label} is already marked ${known ? "known" : "unknown"}`);
      return {
        summary: `Mark ${label} as ${known ? "known" : "unknown"}`,
        apply: async () => {
          await prisma.device.update({ where: { mac }, data: { known } });
          return { tool: "set_device_known", input: { mac, known: !known } };
        },
      };
    },
  }),
  set_device_alerts: changeTool({
    description: `Per-device alerts: offlineMinutes alerts when the device has been offline that long (${OFFLINE_MINUTES.join(", ")}; null turns it off); onlineMinutes alerts each time it comes back after being away at least that long (${ONLINE_MINUTES.join(", ")}; null turns it off). Leave one out to keep it as it is.`,
    input: z.object({ mac, offlineMinutes: minutes(OFFLINE_MINUTES).optional(), onlineMinutes: minutes(ONLINE_MINUTES).optional() }),
    plan: async ({ mac, offlineMinutes, onlineMinutes }) => {
      if (offlineMinutes === undefined && onlineMinutes === undefined) throw new Error("Give offlineMinutes, onlineMinutes or both");
      const { device, label } = await findDevice(mac);
      const parts = [
        offlineMinutes === undefined ? null : offlineMinutes === null ? "no offline alerts" : `an alert after ${offlineMinutes} minutes offline`,
        onlineMinutes === undefined ? null : onlineMinutes === null ? "no back-online alerts" : `an alert when it's back after ${onlineMinutes} minutes away`,
      ].filter(Boolean);
      return {
        summary: `Set ${label} to ${parts.join(" and ")}`,
        apply: async () => {
          await prisma.device.update({
            where: { mac },
            // A changed offline setting starts its alert state over, as in the app
            data: { ...(offlineMinutes !== undefined ? { alertOfflineMinutes: offlineMinutes, offlineAlerted: false } : {}), ...(onlineMinutes !== undefined ? { alertOnlineMinutes: onlineMinutes } : {}) },
          });
          return {
            tool: "set_device_alerts",
            input: { mac, ...(offlineMinutes !== undefined ? { offlineMinutes: device.alertOfflineMinutes } : {}), ...(onlineMinutes !== undefined ? { onlineMinutes: device.alertOnlineMinutes } : {}) },
          };
        },
      };
    },
  }),
  add_service_check: changeTool({
    description:
      "Start watching a service on the LAN: kind http (target is a full URL), tcp (target is host:port) or dns (target is the DNS server's IP, query the name to look up). Checked every everyMinutes, with an alert when it goes down.",
    input: z.object({
      name: z.string().trim().min(1).max(60),
      kind: z.enum(["http", "tcp", "dns"]),
      target: z.string().trim().max(500),
      query: z.string().trim().max(253).optional(),
      everyMinutes: z.union(SERVICE_EVERY.map((value) => z.literal(value))).default(5),
    }),
    plan: async (input) => {
      const parsed = serviceInput.safeParse({ ...input, enabled: true, alert: true });
      if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
      const { id: _, ...service } = parsed.data;
      return {
        summary: `Add a ${service.kind.toUpperCase()} check “${service.name}” of ${service.target}${service.query ? ` (looking up ${service.query})` : ""}, every ${service.everyMinutes} minute${service.everyMinutes === 1 ? "" : "s"}, with alerts`,
        apply: async () => {
          const created = await prisma.serviceCheck.create({ data: service });
          return { tool: "remove_service_check", input: { id: created.id } };
        },
      };
    },
  }),
  // Only for undoing add_service_check; agents can't delete
  remove_service_check: changeTool({
    description: "Remove a service check.",
    hidden: true,
    input: z.object({ id: z.int() }),
    plan: async ({ id }) => {
      const service = await prisma.serviceCheck.findUnique({ where: { id } });
      if (!service) throw new Error("That service check is already gone");
      return {
        summary: `Remove the service check “${service.name}”`,
        apply: async () => {
          await prisma.serviceCheck.delete({ where: { id } });
          return null;
        },
      };
    },
  }),
  set_alert_rule_enabled: changeTool({
    description: "Turn an alert rule (like download below 100 Mbps) on or off. Find its id with list_alert_rules.",
    input: z.object({ id: z.int(), enabled: z.boolean() }),
    plan: async ({ id, enabled }) => {
      const rule = await findRule(id);
      if (rule.enabled === enabled) throw new Error(`The rule “${ruleText(rule)}” is already ${enabled ? "on" : "off"}`);
      return {
        summary: `Turn ${enabled ? "on" : "off"} the alert rule “${ruleText(rule)}”`,
        apply: async () => {
          // Like any edit in the app, it starts the rule's state over
          await prisma.notificationRule.update({ where: { id }, data: { enabled, pendingSince: null, alerting: false } });
          return { tool: "set_alert_rule_enabled", input: { id, enabled: !enabled } };
        },
      };
    },
  }),
};

export const isChangeTool = (name: string) => Object.hasOwn(CHANGE_TOOLS, name) && !CHANGE_TOOLS[name]!.hidden;

const plan = async (name: string, args: unknown) => {
  const definition = CHANGE_TOOLS[name];
  if (!definition) throw new Error(`Unknown tool: ${name}`);
  const input = definition.input.safeParse(args ?? {});
  if (!input.success) throw new Error(z.prettifyError(input.error));
  return definition.plan(input.data);
};

// What a change would do, in words, without doing it
export const describeChange = async (name: string, args: unknown) => (await plan(name, args)).summary;

export const applyChange = async (name: string, args: unknown, by: string) => {
  if (!isChangeTool(name)) throw new Error(`Unknown tool: ${name}`);
  const { summary, apply } = await plan(name, args);
  const undo = await apply();
  await prisma.aiChange.create({ data: { by, tool: name, summary, undo: JSON.stringify(undo) } });
  return summary;
};

export const listChanges = () => prisma.aiChange.findMany({ orderBy: { at: "desc" }, take: 50 });

export const undoChange = async (id: number) => {
  const change = await prisma.aiChange.findUnique({ where: { id } });
  if (!change) throw new Error("No such change");
  if (change.undoneAt) throw new Error("Already undone");
  const undo = JSON.parse(change.undo) as Undo | null;
  if (!undo) throw new Error("This change can't be undone");
  await (await plan(undo.tool, undo.input)).apply();
  await prisma.aiChange.update({ where: { id }, data: { undoneAt: new Date() } });
};

const KEEP_DAYS = 90;
export const pruneChanges = () => prisma.aiChange.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
