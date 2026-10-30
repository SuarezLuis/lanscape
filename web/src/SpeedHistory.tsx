import { LineChart } from "@mantine/charts";
import { Card, Group, SegmentedControl, SimpleGrid, Stack, Table, Text, Title, UnstyledButton } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@lanscape/server/router";
import { useState } from "react";
import { useTRPC } from "./trpc";

type Range = inferRouterInputs<AppRouter>["speedtest"]["history"]["range"];
type SpeedTest = inferRouterOutputs<AppRouter>["speedtest"]["history"][number];

const RANGES: { value: Range; label: string; empty: string }[] = [
  { value: "day", label: "24h", empty: "in the last 24 hours" },
  { value: "week", label: "Week", empty: "in the last week" },
  { value: "month", label: "Month", empty: "in the last month" },
  { value: "year", label: "Year", empty: "in the last year" },
  { value: "all", label: "All", empty: "yet" },
];

const COLUMNS = [
  { key: "createdAt", label: "When", numeric: false, render: (test: SpeedTest) => when(test.createdAt) },
  { key: "downloadMbps", label: "Download", numeric: true, render: (test: SpeedTest) => `${test.downloadMbps.toFixed(0)} Mbps` },
  { key: "uploadMbps", label: "Upload", numeric: true, render: (test: SpeedTest) => `${test.uploadMbps.toFixed(0)} Mbps` },
  { key: "pingMs", label: "Ping", numeric: true, render: (test: SpeedTest) => `${test.pingMs.toFixed(0)} ms` },
  { key: "jitterMs", label: "Jitter", numeric: true, render: (test: SpeedTest) => `${test.jitterMs.toFixed(1)} ms` },
  { key: "trigger", label: "Run by", numeric: false, render: (test: SpeedTest) => (test.trigger === "manual" ? "You" : "Schedule") },
  { key: "serverName", label: "Server", numeric: false, render: (test: SpeedTest) => `${test.serverSponsor} · ${test.serverName}` },
] as const;

type Source = "tests" | "pings" | "both";
const SOURCES: { value: Source; label: string }[] = [
  { value: "tests", label: "Full tests" },
  { value: "pings", label: "Ping checks" },
  { value: "both", label: "Both" },
];
const SPEED_SERIES = [
  { name: "Download", color: "teal.7" },
  { name: "Upload", color: "grape.6" },
];
const LATENCY_SERIES = {
  tests: [
    { name: "Ping", color: "blue.6" },
    { name: "Jitter", color: "orange.8" },
  ],
  pings: [
    { name: "Internet", color: "pink.6" },
    { name: "Router", color: "lime.8" },
  ],
  both: [
    { name: "Speed test ping", color: "blue.6" },
    { name: "Internet", color: "pink.6" },
    { name: "Router", color: "lime.8" },
  ],
} as const;

const oneDecimal = (value: number | null) => (value === null ? null : Number(value.toFixed(1)));

const Chart = (props: { data: Record<string, unknown>[]; unit: string; series: readonly { name: string; color: string }[] }) => (
  <LineChart
    h={220}
    data={props.data}
    dataKey="time"
    series={[...props.series]}
    unit={props.unit}
    curveType="linear"
    strokeWidth={2}
    connectNulls
    withLegend
    legendProps={{ verticalAlign: "bottom" }}
    gridAxis="y"
    tickLine="none"
  />
);

type SortKey = (typeof COLUMNS)[number]["key"];
type Sort = { key: SortKey; desc: boolean };

const when = (date: Date) =>
  date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const compare = (a: SpeedTest, b: SpeedTest, key: SortKey) => {
  const [x, y] = [a[key], b[key]];
  return typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
};

export const SpeedHistory = () => {
  const trpc = useTRPC();
  const [range, setRange] = useState<Range>("week");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", desc: true });
  const [source, setSource] = useState<Source>("both");
  const history = useQuery({ ...trpc.speedtest.history.queryOptions({ range }), placeholderData: keepPreviousData });
  const latency = useQuery({ ...trpc.speedtest.latency.queryOptions({ range }), placeholderData: keepPreviousData });
  const tests = history.data ?? [];
  const selected = RANGES.find((option) => option.value === range);

  const speedPoints = tests.toReversed().map((test) => ({
    time: when(test.createdAt),
    Download: Math.round(test.downloadMbps),
    Upload: Math.round(test.uploadMbps),
  }));
  const latencySeries = LATENCY_SERIES[source];
  // Buckets with nothing for the chosen source would only stretch the time axis
  const latencyPoints = (latency.data ?? [])
    .map((point) => ({
      time: when(point.time),
      Ping: oneDecimal(point.testPingMs),
      "Speed test ping": oneDecimal(point.testPingMs),
      Jitter: oneDecimal(point.testJitterMs),
      Internet: oneDecimal(point.internetMs),
      Router: oneDecimal(point.routerMs),
    }))
    .filter((point) => latencySeries.some((series) => point[series.name] !== null));
  const rows = tests.toSorted((a, b) => (sort.desc ? -1 : 1) * compare(a, b, sort.key));
  const loading = history.isPending || latency.isPending;

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>History</Title>
          <SegmentedControl size="xs" value={range} onChange={(value) => setRange(value as Range)} data={RANGES} />
        </Group>

        {tests.length === 0 && (latency.data ?? []).length === 0 ? (
          !loading && <Text c="dimmed">No speed tests or ping checks {selected?.empty}.</Text>
        ) : (
          <>
            {/* Mbps and ms never share an axis; color steps validated for light and dark */}
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <div>
                <Text fw={600} mb="xs" lh="30px">
                  Speed
                </Text>
                {speedPoints.length > 0 ? (
                  <Chart data={speedPoints} unit=" Mbps" series={SPEED_SERIES} />
                ) : (
                  <Text c="dimmed" size="sm">
                    No full speed tests {selected?.empty}.
                  </Text>
                )}
              </div>
              <div>
                <Group justify="space-between" mb="xs">
                  <Text fw={600}>Latency</Text>
                  <SegmentedControl size="xs" value={source} onChange={(value) => setSource(value as Source)} data={SOURCES} />
                </Group>
                {latencyPoints.length > 0 ? (
                  <Chart data={latencyPoints} unit=" ms" series={latencySeries} />
                ) : (
                  <Text c="dimmed" size="sm">
                    Nothing to show {selected?.empty}.
                  </Text>
                )}
              </div>
            </SimpleGrid>

            {tests.length > 0 && (
            <Table.ScrollContainer minWidth={600}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    {COLUMNS.map((column) => {
                      const active = sort.key === column.key;
                      return (
                        <Table.Th
                          key={column.key}
                          ta={column.numeric ? "right" : undefined}
                          aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
                        >
                          <UnstyledButton
                            fw={600}
                            fz="sm"
                            onClick={() => setSort({ key: column.key, desc: active ? !sort.desc : column.numeric || column.key === "createdAt" })}
                          >
                            {column.label}{" "}
                            <Text span inherit c={active ? undefined : "dimmed"} aria-hidden>
                              {active ? (sort.desc ? "↓" : "↑") : "↕"}
                            </Text>
                          </UnstyledButton>
                        </Table.Th>
                      );
                    })}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((test) => (
                    <Table.Tr key={test.id}>
                      {COLUMNS.map((column) => (
                        <Table.Td key={column.key} ta={column.numeric ? "right" : undefined}>
                          {column.render(test)}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
};
