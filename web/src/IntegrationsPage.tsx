import { Alert, Anchor, Autocomplete, Badge, Button, Card, Code, Group, List, PasswordInput, SegmentedControl, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
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
export const copyText = async (text: string) => {
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

export const PROMPTS = [
  { prompt: "When was my internet slow this month, and was it my ISP or my home network?", hint: "compares router ping with internet ping" },
  { prompt: "Is there anything on my network I don't recognize?", hint: "devices you haven't marked as known" },
  { prompt: "When does the kids' tablet come online at night?", hint: "a device's online and offline history" },
  { prompt: "Which devices never go offline?", hint: "good candidates to mark as known" },
  { prompt: "Every Monday morning, send me a report on last week's network.", hint: "for agents that run on a schedule" },
];

// What the assistant and agents changed, newest first; each can be undone once
export const AiChanges = ({ empty }: { empty?: string }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const changes = useQuery(trpc.integrations.changes.queryOptions());
  const undo = useMutation(trpc.integrations.undoChange.mutationOptions({ onSettled: () => queryClient.invalidateQueries() }));
  if (!changes.data?.length && !empty) return null;
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>
        Changes made by AI
      </Text>
      {changes.data?.length ? (
        <Table.ScrollContainer minWidth={480}>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Change</Table.Th>
                <Table.Th>By</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {changes.data.map((change) => (
                <Table.Tr key={change.id}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{when(change.at)}</Table.Td>
                  <Table.Td td={change.undoneAt ? "line-through" : undefined}>{change.summary}</Table.Td>
                  <Table.Td>{change.by}</Table.Td>
                  <Table.Td>
                    {change.undoneAt ? (
                      <Text size="xs" c="dimmed">
                        Undone
                      </Text>
                    ) : (
                      change.undo !== "null" && (
                        <Button size="compact-xs" variant="light" loading={undo.isPending && undo.variables?.id === change.id} onClick={() => undo.mutate({ id: change.id })}>
                          Undo
                        </Button>
                      )
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      )}
      {undo.error && (
        <Text size="sm" c="red">
          {undo.error.message}
        </Text>
      )}
    </Stack>
  );
};

type Scope = "read" | "change";
const ACCESS: Record<Scope, { label: string; replaceWarning: string; warning: string }> = {
  read: {
    label: "Read access",
    replaceWarning: "Agents using the current read token lose access until you give them the new one.",
    warning: "Anyone with it can read your network data, so treat it like a password.",
  },
  change: {
    label: "Change access",
    replaceWarning: "Agents using the current change token lose access until you give them the new one.",
    warning: "Anyone with it can read your network data and change device names, alerts, service checks and alert rules, so treat it like a password.",
  },
};

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
  const tokenScope = create.variables?.scope ?? "read";
  const claudeCommand = `claude mcp add --transport http --scope user lanscape ${endpoint} --header "Authorization: Bearer ${token ?? "<token>"}"`;
  const config = JSON.stringify(
    { mcpServers: { lanscape: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token ?? "<token>"}` } } } },
    null,
    2,
  );
  const state = (scope: Scope) => (scope === "read" ? { on: mcp.data?.enabled, createdAt: mcp.data?.createdAt } : { on: mcp.data?.changeEnabled, createdAt: mcp.data?.changeCreatedAt });
  const replace = (scope: Scope) => {
    if (!state(scope).on || window.confirm(ACCESS[scope].replaceWarning)) create.mutate({ scope });
  };

  return (
    <Stack gap="md" maw={720}>
      <Text size="sm">
        Lets AI agents that speak MCP (OpenClaw, Claude, and others) read your speed tests, latency, devices and alerts, so
        you can ask them about your network. A read token only reads. A separate change token also lets an agent rename
        devices, mark them known, set per-device alerts, add service checks and turn alert rules on or off; each change is
        listed below and can be undone. No token lets an agent run scans or tests, see Pi-hole activity, or change anything
        on your network itself.
      </Text>
      {(["read", "change"] as const).map((scope) => (
        <Group key={scope} gap="xs">
          <Text size="sm" fw={600} w={120}>
            {ACCESS[scope].label}
          </Text>
          <Badge color={state(scope).on ? "teal" : "gray"} variant="light">
            {state(scope).on ? "On" : "Off"}
          </Badge>
          {state(scope).createdAt && (
            <Text size="sm" c="dimmed">
              Token created {when(state(scope).createdAt!)}
            </Text>
          )}
          <Button size="xs" variant={scope === "read" ? "filled" : "default"} loading={create.isPending && create.variables?.scope === scope} onClick={() => replace(scope)}>
            {state(scope).on ? "Replace token" : scope === "read" ? "Create token" : "Create change token"}
          </Button>
          {state(scope).on && (
            <Button size="xs" variant="subtle" color="red" loading={revoke.isPending && revoke.variables?.scope === scope} onClick={() => revoke.mutate({ scope })}>
              Turn off
            </Button>
          )}
        </Group>
      ))}
      {token && (
        <Stack gap={4}>
          <Text size="sm" fw={600}>
            Your {tokenScope === "change" ? "change" : "read"} token
          </Text>
          <Group gap="xs">
            <Code style={{ wordBreak: "break-all" }}>{token}</Code>
            <Copy value={token} />
          </Group>
          <Text size="sm" c="dimmed">
            Copy it now; LANscape keeps only a fingerprint and can't show it again. {ACCESS[tokenScope].warning}
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

      <AiChanges empty="None yet. Changes the assistant (after you approve them) or an agent with a change token makes show here, kept for 90 days." />

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

type Choice = "anthropic" | "openai" | "other";
const CHOICES: { value: Choice; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "other", label: "Ollama or other" },
];
const OPENAI_URL = "https://api.openai.com/v1";
// On Umbrel, apps share the host network, so an Ollama app on the same Umbrel answers on localhost
const OLLAMA_URL = "http://localhost:11434/v1";

const AiPanel = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ai = useQuery(trpc.ai.settings.queryOptions());
  const refresh = () => queryClient.invalidateQueries(trpc.ai.settings.queryFilter());
  const save = useMutation(trpc.ai.save.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.ai.remove.mutationOptions({ onSuccess: () => (save.reset(), refresh()) }));
  const saved = ai.data?.saved;
  const [choice, setChoice] = useState<Choice>("anthropic");
  const [url, setUrl] = useState(OLLAMA_URL);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!ai.data) return;
    const current = ai.data.saved;
    if (!current) return setModel(ai.data.defaultAnthropicModel);
    setChoice(current.provider === "anthropic" ? "anthropic" : current.url === OPENAI_URL ? "openai" : "other");
    if (current.provider === "openai" && current.url !== OPENAI_URL) setUrl(current.url);
    setModel(current.model);
  }, [ai.data]);

  const pick = (next: Choice) => {
    setChoice(next);
    setApiKey("");
    save.reset();
    setModel(next === "anthropic" ? (ai.data?.defaultAnthropicModel ?? "") : "");
  };
  const sameProvider = saved && (choice === "anthropic") === (saved.provider === "anthropic");
  const needsKey = choice !== "other" && !(sameProvider && saved?.keySet);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(
      {
        provider: choice === "anthropic" ? "anthropic" : "openai",
        url: choice === "anthropic" ? undefined : choice === "openai" ? OPENAI_URL : url,
        model,
        // Blank keeps the saved key; for Ollama, blank means none
        apiKey: apiKey || (choice === "other" && !sameProvider ? "" : undefined),
      },
      { onSuccess: () => setApiKey("") },
    );
  };

  return (
    <Stack gap="md" maw={620}>
      <Text size="sm">
        Ask questions about your network in plain language on the <Anchor href="/assistant">Assistant</Anchor> page. The
        assistant reads the same data the AI agents tab offers (speed tests, latency, outages, devices, services and alerts)
        and can't change anything.
      </Text>
      <Group gap="xs">
        <Text size="sm" fw={600}>
          Status
        </Text>
        {saved ? (
          <Badge color="teal" variant="light">
            {saved.model}
          </Badge>
        ) : (
          <Badge color="gray" variant="light">
            Not set up
          </Badge>
        )}
      </Group>
      <form onSubmit={submit}>
        <Stack gap="sm">
          <SegmentedControl value={choice} onChange={(value) => pick(value as Choice)} data={CHOICES} />
          {choice === "other" ? (
            <Alert color="teal" variant="light" p="xs">
              <Text size="sm">
                A model on your own network, like Ollama, keeps your questions and network data at home. Any server with an
                OpenAI-compatible API works; the model needs to support tool calling.
              </Text>
            </Alert>
          ) : (
            <Alert color="yellow" variant="light" p="xs">
              <Text size="sm">
                Your questions, and the network data the assistant reads to answer them (speeds, outages, device names, IP
                and MAC addresses, service names and alerts), are sent to {choice === "anthropic" ? "Anthropic" : "OpenAI"}{" "}
                and handled under their API terms. Nothing is sent until you ask a question.
              </Text>
            </Alert>
          )}
          {choice === "other" && (
            <TextInput
              label="Server address"
              description={
                <>
                  Its OpenAI-compatible endpoint. Ollama on this Umbrel is usually <Code>{OLLAMA_URL}</Code>.
                </>
              }
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
          )}
          <PasswordInput
            label={choice === "other" ? "API key (if it needs one)" : "API key"}
            description={choice === "anthropic" ? "From console.anthropic.com, under API keys." : choice === "openai" ? "From platform.openai.com, under API keys." : undefined}
            placeholder={sameProvider && saved?.keySet ? "Saved. Enter a new one to replace it" : undefined}
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.currentTarget.value)}
          />
          <Autocomplete
            label="Model"
            description={choice === "anthropic" ? "Claude Opus 5.5 is the default; any Claude model works." : "Its exact name, like llama3.1 for Ollama. It must support tool calling."}
            value={model}
            onChange={setModel}
            data={choice === "anthropic" ? ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] : []}
          />
          {save.isError && (
            <Text size="sm" c="red">
              {save.error.message}
            </Text>
          )}
          {save.data && (
            <Text size="sm">
              Connected.{" "}
              {save.data.modelFound ? "Ask away on the Assistant page." : `The provider didn't list ${model}; check the name if questions fail.`}
            </Text>
          )}
          <Group>
            <Button type="submit" loading={save.isPending} disabled={!model || (needsKey && !apiKey) || (choice === "other" && !url)}>
              {saved ? "Save and test" : "Connect"}
            </Button>
            {saved && (
              <Button variant="subtle" color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
                Disconnect
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </Stack>
  );
};

export const IntegrationsPage = () => (
  <Card withBorder padding="md" radius="md">
    <Stack gap="md">
      <Title order={3}>Integrations</Title>
      <Tabs defaultValue={new URLSearchParams(location.search).get("tab") ?? "pihole"} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="pihole">Pi-hole</Tabs.Tab>
          <Tabs.Tab value="ai">AI assistant</Tabs.Tab>
          <Tabs.Tab value="mcp">AI agents (MCP)</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ai" pt="md">
          <AiPanel />
        </Tabs.Panel>
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
