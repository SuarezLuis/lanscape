import { Button, Card, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@lanscape/server/router";
import type { inferRouterInputs } from "@trpc/server";
import { useState } from "react";
import { useTRPC } from "./trpc";

type AutomationInput = inferRouterInputs<AppRouter>["automations"]["update"];
type SpeedtestInput = Extract<AutomationInput, { job: "speedtest" }>;
type PingInput = Extract<AutomationInput, { job: "ping" }>;
type DevicesInput = Extract<AutomationInput, { job: "devices" }>;

const SPEEDTEST_EVERY = [
  { value: "off", label: "Off" },
  { value: "60", label: "Every hour" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
];
const PING_EVERY = [
  { value: "off", label: "Off" },
  { value: "1", label: "Every minute" },
  { value: "5", label: "Every 5 minutes" },
];
const DEVICES_EVERY = [
  { value: "off", label: "Off" },
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
];
const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour * 60),
  label: new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
}));

const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const toEvery = (value: string | null) => (value && value !== "off" ? Number(value) : null);
const fromEvery = (every: number | null) => (every === null ? "off" : String(every));
const nextRunText = (date: Date | null) =>
  date ? `Next run ${date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Not scheduled.";

export const AutomationsPage = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const list = useQuery(trpc.automations.list.queryOptions());
  const update = useMutation(
    trpc.automations.update.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.automations.list.queryFilter()),
    }),
  );
  const [target, setTarget] = useState<string | null>(null);

  const speedtest = list.data?.automations.find((a) => a.job === "speedtest");
  const ping = list.data?.automations.find((a) => a.job === "ping");
  const devices = list.data?.automations.find((a) => a.job === "devices");
  if (!speedtest || !ping || !devices) return null;

  const savedTarget = ping.target ?? "1.1.1.1";
  const draftTarget = target ?? savedTarget;
  // Saving the speed test schedule pins it to this browser's time zone, since the Umbrel runs on UTC
  const saveSpeedtest = (changes: Partial<Pick<SpeedtestInput, "everyMinutes" | "offsetMinutes">>) =>
    update.mutate({
      job: "speedtest",
      everyMinutes: speedtest.everyMinutes as SpeedtestInput["everyMinutes"],
      offsetMinutes: speedtest.offsetMinutes,
      ...changes,
      timeZone: browserTimeZone,
    });
  const savePing = (changes: Partial<Pick<PingInput, "everyMinutes" | "target">>) =>
    update.mutate(
      { job: "ping", everyMinutes: ping.everyMinutes as PingInput["everyMinutes"], target: savedTarget, ...changes },
      { onSuccess: () => setTarget(null) },
    );

  return (
    <Stack gap="lg">
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Full speed test</Title>
          <Text size="sm" c="dimmed">
            Measures download and upload. Each test takes about 25 seconds, slows your network while it runs, and
            transfers about 2 GB at your current speeds.
          </Text>
          <Group grow align="flex-end">
            <Select
              label="How often"
              data={SPEEDTEST_EVERY}
              value={fromEvery(speedtest.everyMinutes)}
              onChange={(value) => saveSpeedtest({ everyMinutes: toEvery(value) as SpeedtestInput["everyMinutes"] })}
              allowDeselect={false}
            />
            <Select
              label="Starting at"
              data={HOURS}
              value={String(Math.floor(speedtest.offsetMinutes / 60) * 60)}
              onChange={(value) => saveSpeedtest({ offsetMinutes: Number(value) })}
              disabled={!speedtest.everyMinutes || speedtest.everyMinutes < 360}
              allowDeselect={false}
            />
          </Group>
          <Text size="sm" c="dimmed">
            {nextRunText(speedtest.nextRun)} {speedtest.everyMinutes ? `Times follow ${speedtest.timeZone}.` : ""}
          </Text>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Ping check</Title>
          <Text size="sm" c="dimmed">
            Pings your router and an internet host to track latency and packet loss. Uses almost no data, and skips
            any minute a full speed test is running.
          </Text>
          <Select
            label="How often"
            data={PING_EVERY}
            value={fromEvery(ping.everyMinutes)}
            onChange={(value) => savePing({ everyMinutes: toEvery(value) as PingInput["everyMinutes"] })}
            allowDeselect={false}
          />
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              label="Internet host"
              description="An IP address or hostname. Default 1.1.1.1 (Cloudflare)."
              value={draftTarget}
              onChange={(event) => setTarget(event.currentTarget.value.trim())}
              error={update.isError && update.variables?.job === "ping" ? "Enter a valid IP address or hostname" : null}
            />
            <Button
              disabled={draftTarget === savedTarget || !draftTarget}
              loading={update.isPending && update.variables?.job === "ping"}
              onClick={() => savePing({ target: draftTarget })}
            >
              Save
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Router: {list.data?.router ?? "not found"}. {nextRunText(ping.nextRun)}
          </Text>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Device scan</Title>
          <Text size="sm" c="dimmed">
            Sweeps your network with ARP to keep the device list current and spot new devices. Takes a few seconds and a
            few KB.
          </Text>
          <Select
            label="How often"
            data={DEVICES_EVERY}
            value={fromEvery(devices.everyMinutes)}
            onChange={(value) =>
              update.mutate({ job: "devices", everyMinutes: toEvery(value) as DevicesInput["everyMinutes"] })
            }
            allowDeselect={false}
          />
          <Text size="sm" c="dimmed">
            {nextRunText(devices.nextRun)}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
};
