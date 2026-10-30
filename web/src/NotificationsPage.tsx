import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@lanscape/server/router";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useEffect, useState } from "react";
import { XIcon } from "./icons/x";
import { useTRPC } from "./trpc";

type RuleInput = inferRouterInputs<AppRouter>["notifications"]["saveRule"];
type RulesData = inferRouterOutputs<AppRouter>["notifications"]["rules"];
type Rule = RulesData["rules"][number];
type Metrics = RulesData["metrics"];

const SUSTAIN = [
  { value: "0", label: "Right away" },
  { value: "5", label: "For 5 minutes" },
  { value: "10", label: "For 10 minutes" },
  { value: "15", label: "For 15 minutes" },
  { value: "30", label: "For 30 minutes" },
];

const NEW_RULE: RuleInput = {
  metric: "internetPing",
  direction: "above",
  mode: "percent",
  value: 50,
  sustainMinutes: 5,
  enabled: false,
};

const toInput = (rule: Rule): RuleInput => ({
  id: rule.id,
  metric: rule.metric as RuleInput["metric"],
  direction: rule.direction as RuleInput["direction"],
  mode: rule.mode as RuleInput["mode"],
  value: rule.value,
  sustainMinutes: rule.sustainMinutes,
  enabled: rule.enabled,
});

const RuleRow = ({ rule, metrics, save, remove }: { rule: Rule; metrics: Metrics; save: (rule: RuleInput) => void; remove: () => void }) => {
  const current = toInput(rule);
  const metric = metrics[current.metric];
  // Loss sits near zero, so "percent of normal" means nothing for it
  const isLoss = metric.unit === "%";
  const [value, setValue] = useState<string | number>(rule.value);
  const update = (changes: Partial<RuleInput>) => {
    const next = { ...current, ...changes };
    save(metrics[next.metric].unit === "%" ? { ...next, mode: "fixed" } : next);
  };

  return (
    <Group gap="xs" align="flex-end" wrap="wrap">
      <Switch
        checked={rule.enabled}
        onChange={(event) => update({ enabled: event.currentTarget.checked })}
        aria-label="Rule on"
        mb={8}
      />
      <Select
        w={190}
        data={Object.entries(metrics).map(([key, { label }]) => ({ value: key, label }))}
        value={current.metric}
        onChange={(next) => next && update({ metric: next as RuleInput["metric"] })}
        allowDeselect={false}
        aria-label="Metric"
      />
      <Select
        w={100}
        data={[
          { value: "above", label: "above" },
          { value: "below", label: "below" },
        ]}
        value={current.direction}
        onChange={(next) => next && update({ direction: next as RuleInput["direction"] })}
        allowDeselect={false}
        aria-label="Direction"
      />
      <NumberInput
        w={90}
        min={0}
        value={value}
        onChange={setValue}
        onBlur={() => typeof value === "number" && value > 0 && value !== rule.value && update({ value })}
        aria-label="Threshold"
      />
      <Select
        w={150}
        data={[
          { value: "fixed", label: metric.unit },
          { value: "percent", label: "% from normal", disabled: isLoss },
        ]}
        value={current.mode}
        onChange={(next) => next && update({ mode: next as RuleInput["mode"] })}
        allowDeselect={false}
        aria-label="Threshold type"
      />
      {metric.source === "ping" && (
        <Select
          w={150}
          data={SUSTAIN}
          value={String(current.sustainMinutes)}
          onChange={(next) => update({ sustainMinutes: Number(next) })}
          allowDeselect={false}
          aria-label="How long"
        />
      )}
      <ActionIcon variant="subtle" color="gray" onClick={remove} aria-label="Delete rule" mb={4}>
        <XIcon size={16} />
      </ActionIcon>
    </Group>
  );
};

export const NotificationsPage = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries(trpc.notifications.pathFilter());
  const rules = useQuery(trpc.notifications.rules.queryOptions());
  const list = useQuery(trpc.notifications.list.queryOptions());
  const channel = useQuery(trpc.notifications.channel.queryOptions());
  const saveRule = useMutation(trpc.notifications.saveRule.mutationOptions({ onSuccess: refresh }));
  const deleteRule = useMutation(trpc.notifications.deleteRule.mutationOptions({ onSuccess: refresh }));
  const markAllRead = useMutation(trpc.notifications.markAllRead.mutationOptions({ onSuccess: refresh }));
  const saveChannel = useMutation(trpc.notifications.saveChannel.mutationOptions({ onSuccess: refresh }));
  const sendTest = useMutation(trpc.notifications.test.mutationOptions());
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState("");

  const unread = (list.data ?? []).some((notification) => !notification.read);
  // Seeing the page counts as reading it; this view keeps the bold until the next visit
  useEffect(() => {
    if (unread) markAllRead.mutate();
  }, [unread]);

  const savedUrl = channel.data?.url ?? "";
  const draftUrl = url ?? savedUrl;

  return (
    <Stack gap="lg">
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Push notifications</Title>
          <Text size="sm" c="dimmed">
            Alerts go to an ntfy topic. Install the ntfy app on your phone and subscribe to the same topic, on ntfy.sh or
            your own ntfy server.
          </Text>
          <TextInput
            label="Topic URL"
            placeholder="https://ntfy.sh/your-secret-topic"
            value={draftUrl}
            onChange={(event) => setUrl(event.currentTarget.value.trim())}
            error={saveChannel.isError ? "Enter an http(s) URL" : null}
          />
          <PasswordInput
            label="Access token"
            description="Only for protected topics."
            placeholder={channel.data?.hasToken ? "Saved. Type to replace, or clear and save to remove." : "None"}
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
          />
          <Group>
            <Button
              loading={saveChannel.isPending}
              onClick={() =>
                saveChannel.mutate(
                  { url: draftUrl, ...(token || channel.data?.hasToken === false ? { token } : {}) },
                  { onSuccess: () => (setUrl(null), setToken("")) },
                )
              }
            >
              Save
            </Button>
            <Button variant="default" disabled={!savedUrl} loading={sendTest.isPending} onClick={() => sendTest.mutate()}>
              Send test
            </Button>
            {sendTest.isSuccess && <Text size="sm">Sent.</Text>}
            {sendTest.isError && (
              <Text size="sm" c="red">
                {sendTest.error.message}
              </Text>
            )}
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Title order={3}>Rules</Title>
            <Button variant="light" size="xs" onClick={() => saveRule.mutate(NEW_RULE)}>
              Add rule
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            Each rule notifies once when a problem starts and once when it clears. "Normal" is the median of the last 7
            days, and needs at least 5 speed tests or an hour of ping checks.
          </Text>
          {rules.data?.rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              metrics={rules.data.metrics}
              save={(next) => saveRule.mutate(next)}
              remove={() => deleteRule.mutate({ id: rule.id })}
            />
          ))}
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Recent alerts</Title>
          {(list.data ?? []).length === 0 && <Text c="dimmed">No alerts yet.</Text>}
          {list.data?.map((notification) => (
            <Group key={notification.id} gap="sm" wrap="nowrap" align="flex-start">
              <Badge color={notification.kind === "problem" ? "red" : "teal"} variant="light" miw={84}>
                {notification.kind === "problem" ? "Problem" : "Resolved"}
              </Badge>
              <Text size="sm" fw={notification.read ? undefined : 600} style={{ flex: 1 }}>
                {notification.message}
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                {notification.createdAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </Text>
            </Group>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
};
