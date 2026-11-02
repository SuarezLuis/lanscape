import { Button, Card, Group, Select, Stack, Switch, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "./trpc";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: new Date(2026, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" }) }));

export const ReportsCard = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const settings = useQuery(trpc.reports.settings.queryOptions());
  const save = useMutation(trpc.reports.save.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.reports.settings.queryFilter()) }));
  const sendNow = useMutation(trpc.reports.sendNow.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.notifications.list.queryFilter()) }));
  const isp = useMutation({
    mutationFn: () => queryClient.fetchQuery({ ...trpc.reports.isp.queryOptions(), staleTime: 0 }),
    onSuccess: (text) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      link.download = `lanscape-isp-report-${new Date().toISOString().slice(0, 10)}.txt`;
      link.click();
      URL.revokeObjectURL(link.href);
    },
  });
  const current = settings.data;
  // Saved with this browser's time zone, so "Monday 8 AM" means the owner's Monday
  const update = (patch: Partial<NonNullable<typeof current>>) =>
    current && save.mutate({ ...current, ...patch, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="sm">
        <Title order={3}>Reports</Title>
        <Switch
          label="Weekly summary"
          description="This week against last: health score, speeds, ping and loss, outages, new devices and alerts. Sent to every channel below."
          checked={current?.enabled ?? false}
          onChange={(event) => update({ enabled: event.currentTarget.checked })}
        />
        {current?.enabled && (
          <Group gap="xs">
            <Select size="xs" w={140} aria-label="Day" value={String(current.weekday)} onChange={(value) => value && update({ weekday: Number(value) })} data={WEEKDAYS.map((label, value) => ({ value: String(value), label }))} allowDeselect={false} />
            <Select size="xs" w={110} aria-label="Hour" value={String(current.hour)} onChange={(value) => value && update({ hour: Number(value) })} data={HOURS} allowDeselect={false} />
          </Group>
        )}
        <Group gap="xs">
          <Button size="xs" variant="default" loading={sendNow.isPending} onClick={() => sendNow.mutate()}>
            Send a summary now
          </Button>
          <Button size="xs" variant="default" loading={isp.isPending} onClick={() => isp.mutate()}>
            Download ISP report
          </Button>
        </Group>
        {sendNow.isSuccess && <Text size="sm">Sent. It's also in Recent alerts above.</Text>}
        <Text size="xs" c="dimmed">
          The ISP report covers the last 30 days: speed tests against your plan (set on the Speed tests page), ping and
          packet loss, and every outage past your router, in plain text to send your internet provider.
        </Text>
      </Stack>
    </Card>
  );
};
