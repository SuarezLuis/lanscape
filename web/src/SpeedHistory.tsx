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
  { key: "serverName", label: "Server", numeric: false, render: (test: SpeedTest) => `${test.serverSponsor} · ${test.serverName}` },
] as const;

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
  const history = useQuery({ ...trpc.speedtest.history.queryOptions({ range }), placeholderData: keepPreviousData });
  const tests = history.data ?? [];
  const selected = RANGES.find((option) => option.value === range);

  const points = tests.toReversed().map((test) => ({
    time: when(test.createdAt),
    Download: Math.round(test.downloadMbps),
    Upload: Math.round(test.uploadMbps),
    Ping: Math.round(test.pingMs),
    Jitter: Number(test.jitterMs.toFixed(1)),
  }));
  const rows = tests.toSorted((a, b) => (sort.desc ? -1 : 1) * compare(a, b, sort.key));

  // Mbps and ms never share an axis; color steps validated for light and dark
  const charts = [
    { title: "Speed", unit: " Mbps", series: [{ name: "Download", color: "teal.7" }, { name: "Upload", color: "grape.6" }] },
    { title: "Latency", unit: " ms", series: [{ name: "Ping", color: "blue.6" }, { name: "Jitter", color: "orange.8" }] },
  ];

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>History</Title>
          <SegmentedControl size="xs" value={range} onChange={(value) => setRange(value as Range)} data={RANGES} />
        </Group>

        {tests.length === 0 ? (
          !history.isPending && <Text c="dimmed">No speed tests {selected?.empty}.</Text>
        ) : (
          <>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              {charts.map((chart) => (
                <div key={chart.title}>
                  <Text fw={600} mb="xs">
                    {chart.title}
                  </Text>
                  <LineChart
                    h={220}
                    data={points}
                    dataKey="time"
                    series={chart.series}
                    unit={chart.unit}
                    curveType="linear"
                    strokeWidth={2}
                    withLegend
                    legendProps={{ verticalAlign: "bottom" }}
                    gridAxis="y"
                    tickLine="none"
                  />
                </div>
              ))}
            </SimpleGrid>

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
                            {column.label} {active ? (sort.desc ? "↓" : "↑") : ""}
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
          </>
        )}
      </Stack>
    </Card>
  );
};
