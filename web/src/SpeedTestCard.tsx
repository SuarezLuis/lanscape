import { Button, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "./trpc";

export const SpeedTestCard = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const latest = useQuery(trpc.speedtest.latest.queryOptions());
  const run = useMutation(
    trpc.speedtest.run.mutationOptions({
      onSuccess: (result) => queryClient.setQueryData(trpc.speedtest.latest.queryKey(), result),
    }),
  );

  const result = latest.data;
  const stats = result
    ? [
        ["Download", `${result.downloadMbps.toFixed(0)} Mbps`],
        ["Upload", `${result.uploadMbps.toFixed(0)} Mbps`],
        ["Ping", `${result.pingMs.toFixed(0)} ms`],
        ["Jitter", `${result.jitterMs.toFixed(1)} ms`],
      ]
    : [];

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Speed test</Title>
        <Button onClick={() => run.mutate()} loading={run.isPending}>
          Run speed test
        </Button>
      </Group>

      {run.isPending && (
        <Text c="dimmed" size="sm" mb="md">
          Testing download and upload. This takes about 25 seconds.
        </Text>
      )}
      {run.isError && (
        <Text c="red" size="sm" mb="md">
          The speed test failed: {run.error.message}
        </Text>
      )}

      {result ? (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            {stats.map(([label, value]) => (
              <div key={label}>
                <Text size="sm" c="dimmed">
                  {label}
                </Text>
                <Text size="xl" fw={600}>
                  {value}
                </Text>
              </div>
            ))}
          </SimpleGrid>
          <Text size="sm" c="dimmed">
            {result.serverSponsor} · {result.serverName} · {result.serverDistanceKm.toFixed(0)} km away ·{" "}
            {result.createdAt.toLocaleString()}
          </Text>
        </Stack>
      ) : (
        !latest.isPending && <Text c="dimmed">No speed tests yet. Run one to see your download and upload speeds.</Text>
      )}
    </Card>
  );
};
