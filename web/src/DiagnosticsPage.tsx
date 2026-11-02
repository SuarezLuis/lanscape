import { Alert, Badge, Button, Card, Code, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@lanscape/server/router";
import { useState } from "react";
import { copyText } from "./IntegrationsPage";
import { useTRPC } from "./trpc";

type Result = inferRouterOutputs<AppRouter>["diagnostics"]["run"];

const STATUS = (ok: boolean | null) => (ok === true ? { label: "OK", color: "teal" } : ok === false ? { label: "Problem", color: "red" } : { label: "Note", color: "gray" });

// Plain text, so it pastes into an email or a support chat with an internet provider
const reportText = (result: Result, version: string) =>
  [
    `LANscape network check, ${new Date(result.at).toLocaleString()} (LANscape ${version})`,
    "",
    result.verdict,
    "",
    ...result.steps.flatMap((step) => [`[${STATUS(step.ok).label}] ${step.label}: ${step.summary}`, ...(step.detail ? [step.detail, ""] : [])]),
  ].join("\n");

export const DiagnosticsPage = () => {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.queryOptions());
  const run = useMutation(trpc.diagnostics.run.mutationOptions());
  const [copied, setCopied] = useState(false);
  const result = run.data;
  const report = result ? reportText(result, health.data?.version ?? "") : "";
  const trouble = result?.steps.some((step) => step.ok === false);

  const download = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([report], { type: "text/plain" }));
    link.download = `lanscape-check-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md" maw={760}>
        <Group justify="space-between">
          <Title order={3}>Diagnostics</Title>
          <Button loading={run.isPending} onClick={() => run.mutate()}>
            {result ? "Run again" : "Run a check"}
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Checks the path from this machine to the internet, one link at a time: its network connection, your router, the
          internet, DNS name lookups and secure web pages, then traces the route. It takes up to half a minute. Nothing is
          saved; copy or download the result to send to your internet provider.
        </Text>
        {run.isPending && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Checking your router, DNS and the route to the internet…
            </Text>
          </Group>
        )}
        {run.isError && (
          <Text size="sm" c="red">
            {run.error.message}
          </Text>
        )}
        {result && !run.isPending && (
          <>
            <Alert color={trouble ? "red" : "teal"} variant="light">
              <Text size="sm" fw={500}>
                {result.verdict}
              </Text>
            </Alert>
            <Stack gap="sm">
              {result.steps.map((step) => (
                <Stack key={step.key} gap={4}>
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <Badge color={STATUS(step.ok).color} variant="light" miw={76} style={{ flexShrink: 0 }}>
                      {STATUS(step.ok).label}
                    </Badge>
                    <div>
                      <Text size="sm" fw={600}>
                        {step.label}
                      </Text>
                      <Text size="sm" c="dimmed" style={{ wordBreak: "break-word" }}>
                        {step.summary}
                      </Text>
                    </div>
                  </Group>
                  {step.detail && <Code block>{step.detail}</Code>}
                </Stack>
              ))}
            </Stack>
            <Group>
              <Button variant="default" onClick={() => copyText(report).then(() => setCopied(true), () => setCopied(false))}>
                {copied ? "Copied" : "Copy report"}
              </Button>
              <Button variant="default" onClick={download}>
                Download report
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
};
