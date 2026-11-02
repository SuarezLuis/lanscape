import { Badge, Box, Card, Group, SegmentedControl, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@lanscape/server/router";
import { useState } from "react";
import { useTRPC } from "./trpc";

type Range = inferRouterInputs<AppRouter>["speedtest"]["outages"]["range"];
type Outage = inferRouterOutputs<AppRouter>["speedtest"]["outages"][number];

const RANGES: { value: Range; label: string; days: number; text: string }[] = [
  { value: "day", label: "24h", days: 1, text: "in the last 24 hours" },
  { value: "week", label: "Week", days: 7, text: "in the last week" },
  { value: "month", label: "Month", days: 30, text: "in the last month" },
  { value: "year", label: "Year", days: 365, text: "in the last year" },
];

const CAUSES = {
  internet: { label: "Past router", color: "orange", tip: "Your router kept answering: your internet provider or beyond." },
  home: { label: "Home network", color: "red", tip: "Your router didn't answer either: the router, or the Umbrel's connection to it." },
  unknown: { label: "Unknown", color: "gray", tip: "No router checks to compare with." },
} as const;

const when = (date: Date) => date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const minutes = (outage: Outage, now: number) => ((outage.end?.getTime() ?? now) - outage.start.getTime()) / 60_000;

const lasted = (total: number) => {
  const rounded = Math.max(1, Math.round(total));
  return rounded < 60 ? `${rounded} min` : `${Math.floor(rounded / 60)} h ${rounded % 60 ? `${rounded % 60} min` : ""}`.trim();
};

export const Outages = () => {
  const trpc = useTRPC();
  const [range, setRange] = useState<Range>("week");
  const outages = useQuery({ ...trpc.speedtest.outages.queryOptions({ range }), placeholderData: keepPreviousData, refetchInterval: 60_000 });
  const selected = RANGES.find((option) => option.value === range)!;
  const list = outages.data ?? [];
  const now = Date.now();
  const from = now - selected.days * 86_400_000;
  const total = list.reduce((sum, outage) => sum + minutes(outage, now), 0);
  const byCause = (cause: keyof typeof CAUSES) => list.filter((outage) => outage.cause === cause).length;

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={3}>Outages</Title>
          <SegmentedControl size="xs" value={range} onChange={(value) => setRange(value as Range)} data={RANGES} />
        </Group>
        <Text size="sm" c="dimmed">
          Two or more ping checks in a row where every packet to your internet host was lost. Comparing with your router
          tells whether the problem was in your home network or past it. Outages come from ping checks, so they need
          ping checks on in Automations.
        </Text>

        {outages.isPending ? null : list.length === 0 ? (
          <Text size="sm">No outages {selected.text}.</Text>
        ) : (
          <>
            <Text size="sm">
              {list.length} outage{list.length === 1 ? "" : "s"} {selected.text}, {lasted(total)} in total
              {byCause("internet") > 0 && byCause("home") > 0
                ? `: ${byCause("internet")} past your router, ${byCause("home")} in your home network`
                : ""}
              .
            </Text>
            <Stack gap={4}>
              <Box pos="relative" h={14} bg="var(--mantine-color-default-hover)" style={{ borderRadius: 4, overflow: "hidden" }}>
                {list.map((outage) => {
                  const left = Math.max(0, (outage.start.getTime() - from) / (now - from));
                  const width = Math.max(0.004, ((outage.end?.getTime() ?? now) - Math.max(outage.start.getTime(), from)) / (now - from));
                  return (
                    <Tooltip key={outage.start.toISOString()} label={`${when(outage.start)} · ${lasted(minutes(outage, now))} · ${CAUSES[outage.cause].label}`}>
                      <Box
                        pos="absolute"
                        top={0}
                        h="100%"
                        bg={`${CAUSES[outage.cause].color}.6`}
                        style={{ left: `min(${left * 100}%, calc(100% - 4px))`, width: `${width * 100}%`, minWidth: 4 }}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {when(new Date(from))}
                </Text>
                <Text size="xs" c="dimmed">
                  Now
                </Text>
              </Group>
            </Stack>
            <Table.ScrollContainer minWidth={320}>
              <Table fz="sm" verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Lasted</Table.Th>
                    <Table.Th>Where</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {list.map((outage) => (
                    <Table.Tr key={outage.start.toISOString()}>
                      <Table.Td>{when(outage.start)}</Table.Td>
                      <Table.Td>
                        {outage.end ? (
                          lasted(minutes(outage, now))
                        ) : (
                          <Badge color="red" variant="filled" size="sm">
                            Ongoing · {lasted(minutes(outage, now))}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={CAUSES[outage.cause].tip}>
                          <Badge color={CAUSES[outage.cause].color} variant="light" size="sm">
                            {CAUSES[outage.cause].label}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
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
