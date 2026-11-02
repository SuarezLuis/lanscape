import { Accordion, Alert, Anchor, Badge, Box, Button, Card, Code, Group, Loader, Paper, Stack, Text, Textarea, Title, Typography } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@lanscape/server/router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PROMPTS } from "./IntegrationsPage";
import { useTRPC } from "./trpc";

type Answer = inferRouterOutputs<AppRouter>["ai"]["chat"];
type Turn = { role: "user"; content: string } | { role: "assistant"; content: string; tools: Answer["tools"] };

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

const ToolsUsed = ({ tools }: { tools: Answer["tools"] }) =>
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

export const AssistantPage = () => {
  const trpc = useTRPC();
  const settings = useQuery(trpc.ai.settings.queryOptions());
  const saved = settings.data?.saved;
  const [turns, setTurns] = useState<Turn[]>(load);
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation(
    trpc.ai.chat.mutationOptions({
      onSuccess: (answer) => setTurns((current) => [...current, { role: "assistant", content: answer.reply, tools: answer.tools }]),
    }),
  );

  useEffect(() => {
    store(turns);
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, ask.isPending]);

  const send = (question: string) => {
    const content = question.trim();
    if (!content || ask.isPending) return;
    const next: Turn[] = [...turns, { role: "user", content }];
    setTurns(next);
    setDraft("");
    ask.mutate({ messages: next.map(({ role, content }) => ({ role, content })) });
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
            <Button size="xs" variant="default" disabled={turns.length === 0 || ask.isPending} onClick={() => (setTurns([]), ask.reset())}>
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
                <ToolsUsed tools={turn.tools} />
              </Stack>
            ),
          )}
          {ask.isPending && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Looking at your network…
              </Text>
            </Group>
          )}
          {ask.isError && (
            <Text size="sm" c="red">
              {ask.error.message}
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
            <Button type="submit" loading={ask.isPending} disabled={!draft.trim()}>
              Ask
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            The assistant reads LANscape's data and can't change anything. It can be wrong; check what it looked at below each
            answer.{" "}
            <Anchor size="xs" href="/help">
              Help
            </Anchor>
          </Text>
        </form>
      </Stack>
    </Card>
  );
};
