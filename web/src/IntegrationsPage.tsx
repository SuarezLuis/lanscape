import { Anchor, Badge, Button, Card, Code, Group, List, PasswordInput, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useTRPC } from "./trpc";

const when = (date: Date | string) =>
  new Date(date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const PiholePanel = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pihole = useQuery(trpc.integrations.pihole.queryOptions());
  const refresh = () => queryClient.invalidateQueries(trpc.integrations.pihole.queryFilter());
  const save = useMutation(trpc.integrations.savePihole.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(
    trpc.integrations.removePihole.mutationOptions({
      onSuccess: () => {
        save.reset();
        return refresh();
      },
    }),
  );
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (pihole.data) setUrl(pihole.data.url);
  }, [pihole.data?.url]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ url, password: password || undefined }, { onSuccess: () => setPassword("") });
  };

  const status = pihole.data?.status;

  return (
    <Stack gap="md" maw={620}>
      <Text size="sm">
        With your Pi-hole connected, LANscape names devices that don't announce a name, counts a device as online when it
        has asked Pi-hole for something in the last 10 minutes (phones often sleep through scans), and shows what each
        device looks up in its panel on the Network page.
      </Text>
      <Group gap="xs">
        <Text size="sm" fw={600}>
          Status
        </Text>
        {pihole.data?.configured ? (
          status?.ok === false ? (
            <Badge color="red" variant="light">
              Not reachable
            </Badge>
          ) : (
            <Badge color="teal" variant="light">
              Connected
            </Badge>
          )
        ) : (
          <Badge color="gray" variant="light">
            Not set up
          </Badge>
        )}
        {status && (
          <Text size="sm" c={status.ok ? "dimmed" : "red"}>
            {status.ok ? status.summary : status.error} · {when(status.at)}
          </Text>
        )}
      </Group>

      <form onSubmit={submit}>
        <Stack gap="sm">
          <TextInput
            label="Pi-hole address"
            description={
              <>
                On Umbrel, Pi-hole is at <Code>http://localhost:8082</Code>.
              </>
            }
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <PasswordInput
            label="App password"
            description="In Pi-hole: Settings → Web interface / API → Configure app password. It works with two-factor sign-in, and you can revoke it there."
            placeholder={pihole.data?.passwordSet ? "Saved. Enter a new one to replace it" : undefined}
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
          {save.isError && (
            <Text size="sm" c="red">
              {save.error.message}
            </Text>
          )}
          {save.data && (
            <Text size="sm">
              Connected. Pi-hole knows {save.data.devices} devices, {save.data.named} of them by name. The next scan uses it.
            </Text>
          )}
          <Group>
            <Button type="submit" loading={save.isPending} disabled={!url || (!password && !pihole.data?.passwordSet)}>
              {pihole.data?.configured ? "Save and test" : "Connect"}
            </Button>
            {pihole.data?.configured && (
              <Button variant="subtle" color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
                Disconnect
              </Button>
            )}
          </Group>
        </Stack>
      </form>

      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Getting names from Pi-hole
        </Text>
        <Text size="sm" c="dimmed">
          Pi-hole knows names only if something tells it. Either:
        </Text>
        <List size="sm" c="dimmed">
          <List.Item>Pi-hole hands out addresses (its DHCP server is on), or</List.Item>
          <List.Item>
            under Settings → DNS, <b>conditional forwarding</b> points at your router, so Pi-hole asks it for the names it
            gave out.
          </List.Item>
        </List>
        <Text size="sm" c="dimmed">
          Without either, LANscape still gets activity and the online signal. See the{" "}
          <Anchor href="https://docs.pi-hole.net/" target="_blank" size="sm">
            Pi-hole docs
          </Anchor>
          .
        </Text>
      </Stack>
    </Stack>
  );
};

// navigator.clipboard only exists on https and localhost, and LANscape is usually opened over plain http on the LAN
const copyText = async (text: string) => {
  if (window.isSecureContext && navigator.clipboard) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy failed");
};

const Copy = ({ value }: { value: string }) => {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () =>
    copyText(value)
      .then(() => setState("copied"))
      .catch(() => setState("failed"))
      .finally(() => setTimeout(() => setState("idle"), 2000));
  return (
    <Button size="xs" variant="light" color={state === "failed" ? "red" : undefined} onClick={copy} style={{ flexShrink: 0 }}>
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy it instead" : "Copy"}
    </Button>
  );
};

const PROMPTS = [
  { prompt: "When was my internet slow this month, and was it my ISP or my home network?", hint: "compares router ping with internet ping" },
  { prompt: "Is there anything on my network I don't recognize?", hint: "devices you haven't marked as known" },
  { prompt: "When does the kids' tablet come online at night?", hint: "a device's online and offline history" },
  { prompt: "Which devices never go offline?", hint: "good candidates to mark as known" },
  { prompt: "Every Monday morning, send me a report on last week's network.", hint: "for agents that run on a schedule" },
];

const McpPanel = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const mcp = useQuery(trpc.integrations.mcp.queryOptions());
  const refresh = () => queryClient.invalidateQueries(trpc.integrations.mcp.queryFilter());
  const create = useMutation(trpc.integrations.createMcpToken.mutationOptions({ onSuccess: refresh }));
  const revoke = useMutation(
    trpc.integrations.revokeMcpToken.mutationOptions({
      onSuccess: () => {
        create.reset();
        return refresh();
      },
    }),
  );
  const endpoint = `${window.location.origin}/mcp`;
  const token = create.data;
  const claudeCommand = `claude mcp add --transport http --scope user lanscape ${endpoint} --header "Authorization: Bearer ${token ?? "<token>"}"`;
  const config = JSON.stringify(
    { mcpServers: { lanscape: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token ?? "<token>"}` } } } },
    null,
    2,
  );

  const replace = () => {
    if (!mcp.data?.enabled || window.confirm("Agents using the current token lose access until you give them the new one.")) create.mutate();
  };

  return (
    <Stack gap="md" maw={720}>
      <Text size="sm">
        Lets AI agents that speak MCP (OpenClaw, Claude, and others) read your speed tests, latency, devices and alerts, so
        you can ask them about your network. Access is read-only: an agent can't change settings, run scans or tests, or
        see Pi-hole activity.
      </Text>
      <Group gap="xs">
        <Text size="sm" fw={600}>
          Status
        </Text>
        {mcp.data?.enabled ? (
          <Badge color="teal" variant="light">
            On
          </Badge>
        ) : (
          <Badge color="gray" variant="light">
            Off
          </Badge>
        )}
        {mcp.data?.createdAt && (
          <Text size="sm" c="dimmed">
            Token created {when(mcp.data.createdAt)}
          </Text>
        )}
      </Group>
      <Group>
        <Button loading={create.isPending} onClick={replace}>
          {mcp.data?.enabled ? "Replace token" : "Create token"}
        </Button>
        {mcp.data?.enabled && (
          <Button variant="subtle" color="red" loading={revoke.isPending} onClick={() => revoke.mutate()}>
            Turn off
          </Button>
        )}
      </Group>
      {token && (
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Your token
          </Text>
          <Group gap="xs">
            <Code style={{ wordBreak: "break-all" }}>{token}</Code>
            <Copy value={token} />
          </Group>
          <Text size="sm" c="dimmed">
            Copy it now; LANscape keeps only a fingerprint and can't show it again. Anyone with it can read your network
            data, so treat it like a password.
          </Text>
        </Stack>
      )}

      <Stack gap={6}>
        <Text size="sm" fw={600}>
          Connecting an agent
        </Text>
        <Text size="sm" c="dimmed">
          Server address <Code>{endpoint}</Code> (Streamable HTTP), with the token in an{" "}
          <Code>Authorization: Bearer</Code> header. Agents running on this Umbrel use the Umbrel's network address, not{" "}
          <Code>localhost</Code>. Claude Code (for every folder, not just the one you run it in):
        </Text>
        <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {claudeCommand}
        </Code>
        <Group>
          <Copy value={claudeCommand} />
        </Group>
        <Text size="sm" c="dimmed">
          Most other clients take a JSON config like this:
        </Text>
        <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {config}
        </Code>
      </Stack>

      <Stack gap={6}>
        <Text size="sm" fw={600}>
          Things to ask
        </Text>
        {PROMPTS.map(({ prompt, hint }) => (
          <Group key={prompt} gap="xs" wrap="nowrap" justify="space-between">
            <div>
              <Text size="sm">“{prompt}”</Text>
              <Text size="xs" c="dimmed">
                {hint}
              </Text>
            </div>
            <Copy value={prompt} />
          </Group>
        ))}
      </Stack>

      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Recent requests
        </Text>
        {mcp.data?.calls.length ? (
          <Table.ScrollContainer minWidth={420}>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>When</Table.Th>
                  <Table.Th>Tool</Table.Th>
                  <Table.Th>From</Table.Th>
                  <Table.Th>Result</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {mcp.data.calls.map((call) => (
                  <Table.Tr key={call.id}>
                    <Table.Td>{when(call.at)}</Table.Td>
                    <Table.Td>
                      <Code>{call.tool}</Code>
                    </Table.Td>
                    <Table.Td>{call.ip}</Table.Td>
                    <Table.Td c={call.ok ? undefined : "red"}>{call.ok ? "OK" : "Error"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text size="sm" c="dimmed">
            None yet. Each tool call an agent makes shows here, kept for 30 days.
          </Text>
        )}
      </Stack>
    </Stack>
  );
};

export const IntegrationsPage = () => (
  <Card withBorder padding="md" radius="md">
    <Stack gap="md">
      <Title order={3}>Integrations</Title>
      <Tabs defaultValue="pihole" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="pihole">Pi-hole</Tabs.Tab>
          <Tabs.Tab value="mcp">AI agents (MCP)</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="pihole" pt="md">
          <PiholePanel />
        </Tabs.Panel>
        <Tabs.Panel value="mcp" pt="md">
          <McpPanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  </Card>
);
