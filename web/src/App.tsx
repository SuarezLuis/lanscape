import { Badge, Container, Group, Stack, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { SpeedTestCard } from "./SpeedTestCard";
import { useTRPC } from "./trpc";

export const App = () => {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.queryOptions());

  const status = health.isPending ? "checking" : health.isError ? "server unreachable" : `ok · ${health.data.version}`;
  const color = health.isPending ? "gray" : health.isError ? "red" : "teal";

  return (
    <Container py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>Lanscape</Title>
          <Badge color={color}>{status}</Badge>
        </Group>
        <SpeedTestCard />
      </Stack>
    </Container>
  );
};
