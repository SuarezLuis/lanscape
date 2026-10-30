import {
  Accordion,
  Anchor,
  Code,
  List,
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
import { type ReactNode, useEffect, useState } from "react";
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

const KIND: Record<string, { label: string; color: string }> = {
  problem: { label: "Problem", color: "red" },
  resolved: { label: "Resolved", color: "teal" },
  device: { label: "New device", color: "blue" },
};

type Channel = inferRouterOutputs<AppRouter>["notifications"]["channels"][number];

const CHANNEL_UI: Record<Channel["id"], { label: string; help: ReactNode; fields: Record<string, { label: string; placeholder?: string; description?: string }> }> = {
  ntfy: {
    label: "ntfy",
    help: "Install the ntfy app and subscribe to a topic, on ntfy.sh or your own ntfy server. Pick a hard-to-guess topic name.",
    fields: {
      url: { label: "Topic URL", placeholder: "https://ntfy.sh/your-secret-topic" },
      token: { label: "Access token", description: "Only for protected topics." },
    },
  },
  telegram: {
    label: "Telegram",
    help: (
      <List type="ordered" size="sm" spacing={4}>
        <List.Item>
          In Telegram, open{" "}
          <Anchor href="https://t.me/BotFather" target="_blank">
            @BotFather
          </Anchor>
          , send <Code>/newbot</Code> and follow the prompts.
        </List.Item>
        <List.Item>Copy the token BotFather gives you and paste it below.</List.Item>
        <List.Item>
          Open your new bot (BotFather links it) and press <b>Start</b>. Alerts go to whichever chat messages it, so use the
          account or group that should get them.
        </List.Item>
        <List.Item>
          Click <b>Find chat ID</b>, then <b>Save</b> and <b>Send test</b>.
        </List.Item>
      </List>
    ),
    fields: { token: { label: "Bot token", placeholder: "123456:ABC-DEF..." }, chatId: { label: "Chat ID", placeholder: "123456789" } },
  },
  discord: {
    label: "Discord",
    help: "In a channel's settings: Integrations, Webhooks, New Webhook, Copy Webhook URL.",
    fields: { url: { label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/..." } },
  },
  slack: {
    label: "Slack",
    help: "Add an Incoming Webhook to a Slack app and paste its URL.",
    fields: { url: { label: "Webhook URL", placeholder: "https://hooks.slack.com/services/..." } },
  },
  webhook: {
    label: "Webhook",
    help: "LANscape POSTs JSON with app, time, kind (problem, resolved or test), title, message, metric, value and baseline. Works with Home Assistant, n8n and similar tools.",
    fields: { url: { label: "URL", placeholder: "http://homeassistant.local:8123/api/webhook/..." } },
  },
};

const ChannelPanel = ({ channel, onSaved }: { channel: Channel; onSaved: () => void }) => {
  const trpc = useTRPC();
  const ui = CHANNEL_UI[channel.id];
  // undefined = untouched, so saving only sends what changed and never round-trips secrets
  const [drafts, setDrafts] = useState<Record<string, string | undefined>>({});
  const save = useMutation(trpc.notifications.saveChannel.mutationOptions({ onSuccess: () => (setDrafts({}), onSaved()) }));
  const test = useMutation(trpc.notifications.test.mutationOptions());
  const findChats = useMutation(
    trpc.notifications.findTelegramChats.mutationOptions({
      onSuccess: ({ chats }) => {
        if (chats.length === 1 && chats[0]) setDrafts((current) => ({ ...current, chatId: chats[0]?.id }));
      },
    }),
  );
  const changed = Object.values(drafts).some((value) => value !== undefined);
  const clearAll = Object.fromEntries(channel.fields.map(({ field }) => [field, ""]));

  return (
    <Stack gap="sm">
      {typeof ui.help === "string" ? (
        <Text size="sm" c="dimmed">
          {ui.help}
        </Text>
      ) : (
        ui.help
      )}
      {channel.fields.map(({ field, secret, isSet, value }) => {
        const meta = ui.fields[field] ?? { label: field };
        const Input = secret ? PasswordInput : TextInput;
        return (
          <Input
            key={field}
            label={meta.label}
            description={meta.description}
            placeholder={secret && isSet ? "Saved. Type to replace." : meta.placeholder}
            value={drafts[field] ?? (secret ? "" : (value ?? ""))}
            onChange={(event) => setDrafts({ ...drafts, [field]: event.currentTarget.value.trim() })}
          />
        );
      })}
      {channel.id === "telegram" && (
        <Stack gap={4}>
          <Group>
            <Button variant="light" size="xs" loading={findChats.isPending} onClick={() => findChats.mutate({ token: drafts.token })}>
              Find chat ID
            </Button>
            {findChats.isError && (
              <Text size="sm" c="red">
                {findChats.error.message}
              </Text>
            )}
          </Group>
          {findChats.data?.chats.length === 0 && (
            <Text size="sm">
              No messages yet. Open{" "}
              <Anchor href={`https://t.me/${findChats.data.bot}`} target="_blank">
                @{findChats.data.bot}
              </Anchor>
              , press Start, then try again.
            </Text>
          )}
          {findChats.data?.chats.length === 1 && <Text size="sm">Found {findChats.data.chats[0]?.name}. Save to finish.</Text>}
          {(findChats.data?.chats.length ?? 0) > 1 && (
            <Group gap="xs">
              <Text size="sm">Pick a chat:</Text>
              {findChats.data?.chats.map((chat) => (
                <Button key={chat.id} size="compact-xs" variant="default" onClick={() => setDrafts({ ...drafts, chatId: chat.id })}>
                  {chat.name || chat.id}
                </Button>
              ))}
            </Group>
          )}
        </Stack>
      )}
      {save.isError && (
        <Text size="sm" c="red">
          {save.error.message}
        </Text>
      )}
      <Group>
        <Button disabled={!changed} loading={save.isPending} onClick={() => save.mutate({ channel: channel.id, values: drafts })}>
          Save
        </Button>
        <Button variant="default" disabled={!channel.configured} loading={test.isPending} onClick={() => test.mutate({ channel: channel.id })}>
          Send test
        </Button>
        {channel.configured && (
          <Button variant="subtle" color="red" onClick={() => save.mutate({ channel: channel.id, values: clearAll })}>
            Remove
          </Button>
        )}
        {test.isSuccess && <Text size="sm">Sent.</Text>}
        {test.isError && (
          <Text size="sm" c="red">
            {test.error.message}
          </Text>
        )}
      </Group>
    </Stack>
  );
};

export const NotificationsPage = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries(trpc.notifications.pathFilter());
  const rules = useQuery(trpc.notifications.rules.queryOptions());
  const list = useQuery(trpc.notifications.list.queryOptions());
  const channels = useQuery(trpc.notifications.channels.queryOptions());
  const saveRule = useMutation(trpc.notifications.saveRule.mutationOptions({ onSuccess: refresh }));
  const deleteRule = useMutation(trpc.notifications.deleteRule.mutationOptions({ onSuccess: refresh }));
  const markAllRead = useMutation(trpc.notifications.markAllRead.mutationOptions({ onSuccess: refresh }));

  const newDeviceAlerts = useQuery(trpc.notifications.newDeviceAlerts.queryOptions());
  const setNewDeviceAlerts = useMutation(trpc.notifications.setNewDeviceAlerts.mutationOptions({ onSuccess: refresh }));
  const unread = (list.data ?? []).some((notification) => !notification.read);
  // Seeing the page counts as reading it; this view keeps the bold until the next visit
  useEffect(() => {
    if (unread) markAllRead.mutate();
  }, [unread]);


  return (
    <Stack gap="lg">
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Where alerts go</Title>
          <Text size="sm" c="dimmed">
            Every alert goes to each channel you set up.
          </Text>
          <Accordion variant="separated">
            {channels.data?.map((channel) => (
              <Accordion.Item key={channel.id} value={channel.id}>
                <Accordion.Control>
                  <Group justify="space-between" pr="sm">
                    <Text fw={500}>{CHANNEL_UI[channel.id].label}</Text>
                    {channel.configured && (
                      <Badge color="teal" variant="light">
                        On
                      </Badge>
                    )}
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <ChannelPanel channel={channel} onSaved={refresh} />
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
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
          <Switch
            label="New device joins the network"
            checked={newDeviceAlerts.data ?? true}
            onChange={(event) => setNewDeviceAlerts.mutate(event.currentTarget.checked)}
          />
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
              <Badge color={KIND[notification.kind]?.color ?? "gray"} variant="light" miw={92}>
                {KIND[notification.kind]?.label ?? notification.kind}
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
