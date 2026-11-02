import { Box, Card, Group, NumberInput, SegmentedControl, Stack, Text, Title, Tooltip } from "@mantine/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTRPC } from "./trpc";

type Metric = "download" | "upload" | "ping";
const METRICS: { value: Metric; label: string }[] = [
  { value: "download", label: "Download" },
  { value: "upload", label: "Upload" },
  { value: "ping", label: "Ping" },
];
// Monday first, as most people read a week; values are SQLite's %w (0 = Sunday)
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = (hour: number) => new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });

const PlanInputs = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const plan = useQuery(trpc.speedtest.plan.queryOptions());
  const save = useMutation(trpc.speedtest.setPlan.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.speedtest.plan.queryFilter()) }));
  const [draft, setDraft] = useState<{ downloadMbps: number | null; uploadMbps: number | null } | null>(null);
  useEffect(() => {
    if (plan.data) setDraft(plan.data);
  }, [plan.data]);
  if (!draft) return null;
  const commit = () => {
    if (draft.downloadMbps !== plan.data?.downloadMbps || draft.uploadMbps !== plan.data?.uploadMbps) save.mutate(draft);
  };
  const field = (key: "downloadMbps" | "uploadMbps", label: string) => (
    <NumberInput
      size="xs"
      w={130}
      label={label}
      suffix=" Mbps"
      min={1}
      allowNegative={false}
      value={draft[key] ?? ""}
      onChange={(value) => setDraft({ ...draft, [key]: typeof value === "number" ? value : null })}
      onBlur={commit}
    />
  );
  return (
    <Group gap="xs" align="flex-end">
      {field("downloadMbps", "Plan download")}
      {field("uploadMbps", "Plan upload")}
    </Group>
  );
};

export const SpeedPattern = () => {
  const trpc = useTRPC();
  const [metric, setMetric] = useState<Metric>("download");
  const pattern = useQuery({ ...trpc.speedtest.pattern.queryOptions({ offsetMinutes: -new Date().getTimezoneOffset() }), placeholderData: keepPreviousData });
  const plan = useQuery(trpc.speedtest.plan.queryOptions());
  const cells = pattern.data?.[metric] ?? [];
  const planned = metric === "ping" ? null : metric === "download" ? plan.data?.downloadMbps : plan.data?.uploadMbps;
  const unit = metric === "ping" ? "ms" : "Mbps";
  const values = cells.map((cell) => cell.value);
  // Against the plan when one is set (0 to plan); otherwise from the lowest hour to the highest, so differences show
  const low = planned ? 0 : Math.min(...values);
  const high = planned ?? Math.max(...values);
  const shade = (value: number) => Math.round(15 + 85 * Math.min(1, Math.max(0, (value - low) / (high - low || 1))));
  const byKey = new Map(cells.map((cell) => [`${cell.day}-${cell.hour}`, cell]));

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-end">
          <Title order={3}>Weekly pattern</Title>
          <SegmentedControl size="xs" value={metric} onChange={(value) => setMetric(value as Metric)} data={METRICS} />
        </Group>
        <Text size="sm" c="dimmed">
          {metric === "ping"
            ? "Average internet ping by day and hour over the last 30 days of ping checks. Deeper is slower."
            : `Average ${metric} by day and hour over the last year of speed tests. Hours without a test stay blank; scheduling tests at different times fills them in.`}
        </Text>
        {cells.length === 0 ? (
          <Text size="sm">No data yet.</Text>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <Stack gap={2} miw={300}>
              {DAYS.map((day) => (
                <Group key={day} gap={2} wrap="nowrap">
                  <Text size="xs" c="dimmed" w={32} style={{ flexShrink: 0 }}>
                    {DAY_NAMES[day]}
                  </Text>
                  {Array.from({ length: 24 }, (_, hour) => {
                    const cell = byKey.get(`${day}-${hour}`);
                    const label = cell
                      ? `${DAY_NAMES[day]} ${hourLabel(hour)}: ${cell.value} ${unit}${planned ? ` (${Math.round((100 * cell.value) / planned)}% of plan)` : ""} · ${cell.count} ${metric === "ping" ? "checks" : cell.count === 1 ? "test" : "tests"}`
                      : `${DAY_NAMES[day]} ${hourLabel(hour)}: no data`;
                    return (
                      <Tooltip key={hour} label={label} openDelay={100}>
                        <Box
                          aria-label={label}
                          h={16}
                          style={{
                            flex: 1,
                            minWidth: 8,
                            borderRadius: 2,
                            background: cell ? `color-mix(in srgb, var(--mantine-color-teal-6) ${shade(cell.value)}%, transparent)` : "transparent",
                            border: cell ? undefined : "1px dashed var(--mantine-color-default-border)",
                          }}
                        />
                      </Tooltip>
                    );
                  })}
                </Group>
              ))}
              <Group gap={2} wrap="nowrap">
                <Box w={32} style={{ flexShrink: 0 }} />
                {[0, 6, 12, 18].map((hour) => (
                  <Text key={hour} size="xs" c="dimmed" style={{ flex: 6 }}>
                    {hourLabel(hour)}
                  </Text>
                ))}
              </Group>
            </Stack>
          </Box>
        )}
        <Group justify="space-between" align="flex-end" gap="md">
          {cells.length > 0 && (
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                {low} {unit}
              </Text>
              <Box w={120} h={10} style={{ borderRadius: 2, background: "linear-gradient(to right, color-mix(in srgb, var(--mantine-color-teal-6) 15%, transparent), var(--mantine-color-teal-6))" }} />
              <Text size="xs" c="dimmed">
                {planned ? `${planned} ${unit} (plan)` : `${high} ${unit}`}
              </Text>
            </Group>
          )}
          {metric !== "ping" && <PlanInputs />}
        </Group>
      </Stack>
    </Card>
  );
};
