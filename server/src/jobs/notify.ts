import { prisma } from "../db";
import type { NotificationRule, PingSample, SpeedTest } from "../generated/prisma/client";
import { sendAll } from "./channels";

const MINUTE_MS = 60_000;
const BASELINE_DAYS = 7;

export const METRICS = {
  download: { label: "Download", unit: "Mbps", source: "test" },
  upload: { label: "Upload", unit: "Mbps", source: "test" },
  testPing: { label: "Speed test ping", unit: "ms", source: "test" },
  jitter: { label: "Jitter", unit: "ms", source: "test" },
  internetPing: { label: "Internet ping", unit: "ms", source: "ping" },
  routerPing: { label: "Router ping", unit: "ms", source: "ping" },
  internetLoss: { label: "Internet packet loss", unit: "%", source: "ping" },
  routerLoss: { label: "Router packet loss", unit: "%", source: "ping" },
} as const;
export type Metric = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as [Metric, ...Metric[]];

// "Normal" needs enough history to mean anything; until then percent rules stay quiet
const MIN_BASELINE_SAMPLES = { test: 5, ping: 60 };

type Values = Partial<Record<Metric, number | null>>;

export const testValues = (test: SpeedTest): Values => ({
  download: test.downloadMbps,
  upload: test.uploadMbps,
  testPing: test.pingMs,
  jitter: test.jitterMs,
});

const lossPercent = (sample: Pick<PingSample, "sent" | "received">) =>
  sample.sent ? ((sample.sent - sample.received) / sample.sent) * 100 : null;

export const pingValues = (samples: Pick<PingSample, "target" | "avgMs" | "sent" | "received">[]): Values =>
  Object.fromEntries(
    samples.flatMap((sample) => [
      [`${sample.target}Ping`, sample.avgMs],
      [`${sample.target}Loss`, lossPercent(sample)],
    ]),
  );

export const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const baselineFor = async (metric: Metric) => {
  const since = new Date(Date.now() - BASELINE_DAYS * 24 * 60 * MINUTE_MS);
  const source = METRICS[metric].source;
  let history: Values[];
  if (source === "test") {
    history = (await prisma.speedTest.findMany({ where: { createdAt: { gte: since } } })).map(testValues);
  } else {
    const target = metric.startsWith("router") ? "router" : "internet";
    const samples = await prisma.pingSample.findMany({ where: { target, createdAt: { gte: since } } });
    history = samples.map((sample) => pingValues([sample]));
  }
  const values = history.map((entry) => entry[metric]).filter((value): value is number => typeof value === "number");
  return values.length >= MIN_BASELINE_SAMPLES[source] ? median(values) : null;
};

type RuleShape = Pick<NotificationRule, "direction" | "mode" | "value">;

// Percent rules sit a percentage away from normal: "50% below" a 600 Mbps median is 300 Mbps
export const thresholdFor = (rule: RuleShape, baseline: number | null) =>
  rule.mode === "fixed" ? rule.value : (baseline ?? 0) * (1 + ((rule.direction === "above" ? 1 : -1) * rule.value) / 100);

export const breaches = (rule: RuleShape, value: number, baseline: number | null) =>
  rule.direction === "above" ? value > thresholdFor(rule, baseline) : value < thresholdFor(rule, baseline);

type RuleState = Pick<NotificationRule, "pendingSince" | "alerting" | "sustainMinutes">;

// One "problem" once the condition has held for sustainMinutes, one "resolved" when it clears
export const advance = (state: RuleState, breached: boolean, now: Date) => {
  if (!breached) {
    return { pendingSince: null, alerting: false, fire: state.alerting ? ("resolved" as const) : null };
  }
  const pendingSince = state.pendingSince ?? now;
  const held = now.getTime() - pendingSince.getTime() >= state.sustainMinutes * MINUTE_MS;
  return {
    pendingSince,
    alerting: state.alerting || held,
    fire: !state.alerting && held ? ("problem" as const) : null,
  };
};

const format = (metric: Metric, value: number) => {
  const { unit } = METRICS[metric];
  return unit === "%" ? `${value.toFixed(0)}%` : `${value.toFixed(unit === "ms" ? 1 : 0)} ${unit}`;
};

export const describe = (rule: NotificationRule, kind: "problem" | "resolved", value: number, baseline: number | null) => {
  const metric = rule.metric as Metric;
  const { label } = METRICS[metric];
  if (kind === "resolved") return { title: `${label} is back to normal`, message: `${label} is back to ${format(metric, value)}.` };
  const lasting = rule.sustainMinutes ? ` for ${rule.sustainMinutes} minutes` : "";
  const message =
    rule.mode === "percent"
      ? `${label} is ${format(metric, value)}, more than ${rule.value}% ${rule.direction} normal (${format(metric, baseline ?? 0)})${lasting}.`
      : `${label} is ${format(metric, value)}, ${rule.direction} ${format(metric, rule.value)}${lasting}.`;
  return { title: `${label} is ${rule.direction === "above" ? "high" : "low"}`, message };
};

// Runs after each saved speed test or ping check, against whichever metrics that run measured
export const checkRules = async (values: Values) => {
  const now = new Date();
  const rules = await prisma.notificationRule.findMany({ where: { enabled: true } });
  for (const rule of rules) {
    const metric = rule.metric as Metric;
    const value = values[metric];
    if (typeof value !== "number") continue;
    const baseline = rule.mode === "percent" ? await baselineFor(metric) : null;
    if (rule.mode === "percent" && baseline === null) continue;

    const next = advance(rule, breaches(rule, value, baseline), now);
    await prisma.notificationRule.update({
      where: { id: rule.id },
      data: { pendingSince: next.pendingSince, alerting: next.alerting },
    });
    if (!next.fire) continue;

    const { title, message } = describe(rule, next.fire, value, baseline);
    await prisma.notification.create({ data: { ruleId: rule.id, kind: next.fire, value, baseline, message } });
    await sendAll({ kind: next.fire, title, message, metric, value, baseline });
  }
};
