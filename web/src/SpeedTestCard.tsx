import { Button, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useSubscription } from "@trpc/tanstack-react-query";
import { gaugeMax, SpeedGauge } from "./SpeedGauge";
import { useTRPC } from "./trpc";

// Same steps as the history charts; validated for both color schemes
const COLORS = { download: "var(--mantine-color-teal-7)", upload: "var(--mantine-color-grape-6)" };

const mbps = (value: number | null) => (value === null ? "—" : value.toFixed(0));

export const SpeedTestCard = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const latest = useQuery(trpc.speedtest.latest.queryOptions());
  const run = useMutation(trpc.speedtest.run.mutationOptions());
  const cancel = useMutation(trpc.speedtest.cancel.mutationOptions());
  // Follows tests started from any tab; null once the test is saved
  const progress =
    useSubscription(
      trpc.speedtest.progress.subscriptionOptions(undefined, {
        onData: (data) => {
          if (!data) void queryClient.invalidateQueries(trpc.speedtest.pathFilter());
        },
      }),
    ).data ?? null;

  const testing = run.isPending || progress !== null;
  const phase = progress?.phase ?? "connecting";
  const live = progress ?? { pingMs: null, downloadMbps: null, uploadMbps: null };

  const result = latest.data;

  // The dial starts at the smallest scale and only grows during a test, so the needle never jumps back
  const peak = useRef(0);
  if (!testing) peak.current = 0;
  peak.current = Math.max(peak.current, live.downloadMbps ?? 0, live.uploadMbps ?? 0);
  const stats = result
    ? [
        ["Download", `${result.downloadMbps.toFixed(0)} Mbps`],
        ["Upload", `${result.uploadMbps.toFixed(0)} Mbps`],
        ["Ping", `${result.pingMs.toFixed(0)} ms`],
        ["Jitter", `${result.jitterMs.toFixed(1)} ms`],
      ]
    : [];

  const steps = [
    { key: "ping", label: "Ping", value: live.pingMs === null ? "—" : `${live.pingMs.toFixed(0)} ms` },
    { key: "download", label: "Download", value: `${mbps(live.downloadMbps)} Mbps` },
    { key: "upload", label: "Upload", value: `${mbps(live.uploadMbps)} Mbps` },
  ];

  const transferMbps = phase === "download" ? live.downloadMbps : phase === "upload" ? live.uploadMbps : null;
  const gauge =
    phase === "download" || phase === "upload"
      ? { mbps: transferMbps ?? 0, color: COLORS[phase], value: mbps(transferMbps), unit: `Mbps ${phase}` }
      : phase === "ping"
        ? { mbps: 0, color: COLORS.download, value: mbps(live.pingMs), unit: "ms ping" }
        : { mbps: 0, color: COLORS.download, value: "…", unit: "Finding a server" };

  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Speed test</Title>
        {testing ? (
          <Button color="red" variant="light" onClick={() => cancel.mutate()} loading={cancel.isPending}>
            Stop
          </Button>
        ) : (
          <Button onClick={() => run.mutate()}>Run speed test</Button>
        )}
      </Group>

      {run.isError && (
        <Text c="red" size="sm" mb="md">
          The speed test failed: {run.error.message}
        </Text>
      )}

      {testing ? (
        <Stack align="center" gap="md">
          <SpeedGauge {...gauge} max={gaugeMax(peak.current)} />
          <SimpleGrid cols={3} w="100%" maw={420}>
            {steps.map((step) => (
              <div key={step.key} style={{ textAlign: "center", opacity: step.key === phase ? 1 : 0.6 }}>
                <Text size="sm" c={step.key === phase ? undefined : "dimmed"} fw={step.key === phase ? 600 : undefined}>
                  {step.label}
                </Text>
                <Text size="lg" fw={600}>
                  {step.value}
                </Text>
              </div>
            ))}
          </SimpleGrid>
        </Stack>
      ) : result ? (
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
