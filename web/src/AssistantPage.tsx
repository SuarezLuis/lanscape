import { Accordion, Alert, Anchor, Badge, Box, Button, Card, Code, Group, Loader, Paper, Stack, Text, Textarea, Title, Typography } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AiChanges, PROMPTS } from "./IntegrationsPage";
import { useTRPC } from "./trpc";

type ToolUse = { name: string; input: unknown; ok: boolean; result: string };
// A change the assistant wants to make; it happens only when the owner approves it
type Proposal = { name: string; input: unknown; summary: string; state?: "approved" | "dismissed" };
type Turn = { role: "user"; content: string } | { role: "assistant"; content: string; tools: ToolUse[]; proposals?: Proposal[] };
type Live = { text: string; tools: { name: string; input: unknown; ok: boolean | null }[] };
type Event =
  | { type: "text"; text: string }
  | { type: "round" }
  | { type: "tool"; name: string; input: unknown }
  | { type: "tool_done"; name: string; ok: boolean }
  | { type: "proposal" }
  | { type: "done"; reply: string; tools: ToolUse[]; proposals: Proposal[] }
  | { type: "error"; message: string };

// The server streams JSON lines; each one goes to onEvent as it arrives
const streamChat = async (messages: { role: string; content: string }[], onEvent: (event: Event) => void) => {
  const response = await fetch("/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The server answered ${response.status}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as Event);
  }
};

// The conversation lives in this tab only; nothing is stored on the server
const STORAGE = "lanscape.assistant";
const load = (): Turn[] => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE) ?? "[]") as Turn[];
  } catch {
    return [];
  }
};
const store = (turns: Turn[]) => {
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(turns));
  } catch {
    // Private windows can refuse storage; the chat still works until the tab closes
  }
};

const ToolsUsed = ({ tools }: { tools: ToolUse[] }) =>
  tools.length === 0 ? null : (
    <Accordion variant="contained" chevronPosition="left" styles={{ control: { paddingBlock: 2 }, label: { paddingBlock: 6 } }}>
      <Accordion.Item value="tools">
        <Accordion.Control>
          <Text size="xs" c="dimmed">
            Looked at: {[...new Set(tools.map((tool) => tool.name))].join(", ")}
          </Text>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            {tools.map((tool, i) => (
              <Stack key={i} gap={2}>
                <Text size="xs" fw={600} c={tool.ok ? undefined : "red"}>
                  {tool.name}({JSON.stringify(tool.input)}){tool.ok ? "" : " failed"}
                </Text>
                <Code block style={{ maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {tool.result}
                </Code>
              </Stack>
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );

const Proposals = ({ proposals, onChange }: { proposals: Proposal[]; onChange: (index: number, state: Proposal["state"]) => void }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const approve = useMutation(trpc.ai.approve.mutationOptions({ onSuccess: () => queryClient.invalidateQueries() }));
  return (
    <Stack gap={6}>
      {proposals.map((proposal, i) => (
        <Paper key={i} withBorder p="xs" radius="md">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm" td={proposal.state === "dismissed" ? "line-through" : undefined} c={proposal.state === "dismissed" ? "dimmed" : undefined}>
              {proposal.summary}
            </Text>
            {proposal.state === "approved" ? (
              <Badge color="teal" variant="light" style={{ flexShrink: 0 }}>
                Done
              </Badge>
            ) : proposal.state === "dismissed" ? null : (
              <Group gap={6} wrap="nowrap">
                <Button
                  size="compact-sm"
                  loading={approve.isPending && approve.variables?.name === proposal.name && approve.variables.input === proposal.input}
                  onClick={() =>
                    approve.mutate({ name: proposal.name, input: proposal.input as Record<string, unknown> }, { onSuccess: () => onChange(i, "approved") })
                  }
                >
                  Approve
                </Button>
                <Button size="compact-sm" variant="default" onClick={() => onChange(i, "dismissed")}>
                  Dismiss
                </Button>
              </Group>
            )}
          </Group>
        </Paper>
      ))}
      {approve.error && (
        <Text size="sm" c="red">
          {approve.error.message}
        </Text>
      )}
    </Stack>
  );
};

export const AssistantPage = () => {
  const trpc = useTRPC();
  const settings = useQuery(trpc.ai.settings.queryOptions());
  const saved = settings.data?.saved;
  const [turns, setTurns] = useState<Turn[]>(load);
  const [draft, setDraft] = useState("");
  // The answer being written: null when idle
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const pending = live !== null;

  useEffect(() => {
    store(turns);
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, live?.text.length, live?.tools.length]);

  const onEvent = (event: Event) => {
    if (event.type === "text") setLive((current) => current && { ...current, text: current.text + event.text });
    if (event.type === "round") setLive((current) => current && { ...current, text: "" });
    if (event.type === "tool") setLive((current) => current && { ...current, tools: [...current.tools, { name: event.name, input: event.input, ok: null }] });
    if (event.type === "tool_done") {
      setLive((current) => {
        if (!current) return current;
        const index = current.tools.findIndex((tool) => tool.name === event.name && tool.ok === null);
        return { ...current, tools: current.tools.map((tool, i) => (i === index ? { ...tool, ok: event.ok } : tool)) };
      });
    }
    if (event.type === "done") setTurns((current) => [...current, { role: "assistant", content: event.reply, tools: event.tools, proposals: event.proposals }]);
    if (event.type === "error") setError(event.message);
  };

  const send = (question: string) => {
    const content = question.trim();
    if (!content || pending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    setError(null);
    setLive({ text: "", tools: [] });
    streamChat(next.map(({ role, content }) => ({ role, content })), onEvent)
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => setLive(null));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  if (settings.isPending) return null;
  if (!saved) {
    return (
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm" maw={560}>
          <Title order={3}>Assistant</Title>
          <Text size="sm">
            Ask about your network in plain language: when the internet was slow, what's new on the network, whether a
            service has been flaky. Connect Claude, OpenAI, or a model on your own network such as Ollama first.
          </Text>
          <Group>
            <Button component="a" href="/integrations?tab=ai">
              Set up the assistant
            </Button>
          </Group>
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={3}>Assistant</Title>
            <Badge variant="light">{saved.model}</Badge>
          </Group>
          <Group gap="xs">
            <Button size="xs" variant="subtle" component="a" href="/integrations?tab=ai">
              Settings
            </Button>
            <Button size="xs" variant="default" disabled={turns.length === 0 || pending} onClick={() => (setTurns([]), setError(null))}>
              New chat
            </Button>
          </Group>
        </Group>
        {saved.local ? (
          <Alert color="teal" variant="light" p="xs">
            <Text size="sm">Answers come from {saved.name} on your network. Nothing you ask leaves your network.</Text>
          </Alert>
        ) : (
          <Alert color="yellow" variant="light" p="xs">
            <Text size="sm">
              Your questions, and the network data the assistant reads to answer them (speeds, outages, device names, IP and
              MAC addresses, service names and alerts), are sent to {saved.name}.
            </Text>
          </Alert>
        )}

        {turns.length === 0 && (
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Try one of these, or ask your own:
            </Text>
            <Group gap="xs">
              {PROMPTS.filter((entry) => !entry.prompt.startsWith("Every")).map(({ prompt }) => (
                <Button key={prompt} size="xs" variant="light" onClick={() => send(prompt)} style={{ height: "auto", whiteSpace: "normal", paddingBlock: 6 }}>
                  {prompt}
                </Button>
              ))}
            </Group>
          </Stack>
        )}

        <Stack gap="sm">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <Group key={i} justify="flex-end">
                <Paper bg="var(--mantine-primary-color-light)" px="sm" py={6} radius="md" maw="85%">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {turn.content}
                  </Text>
                </Paper>
              </Group>
            ) : (
              <Stack key={i} gap={6} maw="95%">
                <Typography fz="sm">
                  <Markdown remarkPlugins={[remarkGfm]}>{turn.content}</Markdown>
                </Typography>
                {turn.proposals?.length ? (
                  <Proposals
                    proposals={turn.proposals}
                    onChange={(index, state) =>
                      setTurns((current) =>
                        current.map((entry, j) =>
                          j === i && entry.role === "assistant" ? { ...entry, proposals: entry.proposals?.map((proposal, k) => (k === index ? { ...proposal, state } : proposal)) } : entry,
                        ),
                      )
                    }
                  />
                ) : null}
                <ToolsUsed tools={turn.tools} />
              </Stack>
            ),
          )}
          {live && (
            <Stack gap={6} maw="95%">
              {live.tools.length > 0 && (
                <Group gap={6}>
                  {live.tools.map((tool, i) => (
                    <Badge key={i} variant="light" color={tool.ok === false ? "red" : tool.ok ? "teal" : "gray"} leftSection={tool.ok === null ? <Loader size={10} /> : undefined}>
                      {tool.name}
                    </Badge>
                  ))}
                </Group>
              )}
              {live.text ? (
                <Typography fz="sm">
                  <Markdown remarkPlugins={[remarkGfm]}>{live.text}</Markdown>
                </Typography>
              ) : (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="sm" c="dimmed">
                    {live.tools.some((tool) => tool.ok === null) ? "Reading your network data…" : "Thinking…"}
                  </Text>
                </Group>
              )}
            </Stack>
          )}
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Box ref={end} />
        </Stack>

        <form onSubmit={submit}>
          <Group align="flex-end" gap="xs" wrap="nowrap">
            <Textarea
              style={{ flex: 1 }}
              autosize
              minRows={1}
              maxRows={6}
              placeholder="Ask about your network"
              aria-label="Your question"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
            />
            <Button type="submit" loading={pending} disabled={!draft.trim()}>
              Ask
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            The assistant reads LANscape's data. It can suggest changes, like naming a device or adding a service check, but
            nothing changes until you approve it, and every change can be undone. It can be wrong; check what it looked at
            below each answer.{" "}
            <Anchor size="xs" href="/help">
              Help
            </Anchor>
          </Text>
        </form>
        <AiChanges />
      </Stack>
    </Card>
  );
};
