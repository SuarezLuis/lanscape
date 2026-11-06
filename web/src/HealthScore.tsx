import { Badge, Card, Group, Progress, SimpleGrid, Stack, Text, Title, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "./trpc";

const GRADE_COLOR: Record<string, string> = { Excellent: "teal", Good: "teal", Fair: "yellow", Poor: "red" };

export const HealthScore = () => {
  const trpc = useTRPC();
  const health = useQuery({ ...trpc.speedtest.health.queryOptions(), refetchInterval: 60_000 });
  const day = health.data?.day;
  const week = health.data?.week;

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md">
        <Title order={3}>Internet health</Title>
        {health.isPending ? <Loader size="sm" /> : !day ? (
          <Text size="sm" c="dimmed">
            Not enough data yet. The score needs half an hour of ping checks; turn them on in Automations if they're off.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl">
            <Stack gap={4}>
              <Group gap="sm" align="baseline">
                <Text fz={48} fw={700} lh={1}>
                  {day.score}
                </Text>
                <Text c="dimmed">/ 100</Text>
                <Badge color={GRADE_COLOR[day.grade]} variant="light">
                  {day.grade}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed">
                Last 24 hours
                {week && week.checks > day.checks ? ` · last 7 days: ${week.score} (${week.grade})` : ""}
              </Text>
              <Text size="xs" c="dimmed" mt="sm">
                From the ping checks to your internet host. Uptime counts 40%, packet loss outside outages 25%, ping 20% and
                jitter 15%. Each part gets full points at its best value and none at its worst.
              </Text>
            </Stack>
            <Stack gap="xs">
              {day.parts.map((part) => (
                <Stack key={part.key} gap={2}>
                  <Group justify="space-between" gap="xs">
                    <Text size="sm">{part.label}</Text>
                    <Text size="sm">
                      {part.value} {part.unit} · {part.points} pts
                    </Text>
                  </Group>
                  <Progress value={part.points} size="sm" aria-label={`${part.label}: ${part.points} of 100 points`} />
                  <Text size="xs" c="dimmed">
                    Full points at {part.great} {part.unit}, none at {part.bad} {part.unit}
                  </Text>
                </Stack>
              ))}
            </Stack>
          </SimpleGrid>
        )}
      </Stack>
    </Card>
  );
};
