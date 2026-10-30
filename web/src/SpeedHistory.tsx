import { LineChart } from "@mantine/charts";
import { Card, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "./trpc";

const when = (date: Date) =>
  date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const SpeedHistory = () => {
  const trpc = useTRPC();
  const history = useQuery(trpc.speedtest.history.queryOptions());
  const tests = history.data ?? [];
  if (tests.length === 0) return null;

  const points = tests.toReversed().map((test) => ({
    time: when(test.createdAt),
    Download: Math.round(test.downloadMbps),
    Upload: Math.round(test.uploadMbps),
    Ping: Math.round(test.pingMs),
    Jitter: Number(test.jitterMs.toFixed(1)),
  }));

  // Mbps and ms never share an axis; color steps validated for light and dark
  const charts = [
    { title: "Speed", unit: " Mbps", series: [{ name: "Download", color: "teal.7" }, { name: "Upload", color: "grape.6" }] },
    { title: "Latency", unit: " ms", series: [{ name: "Ping", color: "blue.6" }, { name: "Jitter", color: "orange.8" }] },
  ];

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="lg">
        <Title order={3}>History</Title>
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
                <Table.Th>When</Table.Th>
                <Table.Th ta="right">Download</Table.Th>
                <Table.Th ta="right">Upload</Table.Th>
                <Table.Th ta="right">Ping</Table.Th>
                <Table.Th ta="right">Jitter</Table.Th>
                <Table.Th>Server</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tests.map((test) => (
                <Table.Tr key={test.id}>
                  <Table.Td>{when(test.createdAt)}</Table.Td>
                  <Table.Td ta="right">{test.downloadMbps.toFixed(0)} Mbps</Table.Td>
                  <Table.Td ta="right">{test.uploadMbps.toFixed(0)} Mbps</Table.Td>
                  <Table.Td ta="right">{test.pingMs.toFixed(0)} ms</Table.Td>
                  <Table.Td ta="right">{test.jitterMs.toFixed(1)} ms</Table.Td>
                  <Table.Td>
                    {test.serverSponsor} · {test.serverName}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Card>
  );
};
