import { Anchor, Badge, Button, Card, Code, Group, List, PasswordInput, Stack, Tabs, Text, TextInput, Title } from "@mantine/core";
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

export const IntegrationsPage = () => (
  <Card withBorder padding="md" radius="md">
    <Stack gap="md">
      <Title order={3}>Integrations</Title>
      <Tabs defaultValue="pihole" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="pihole">Pi-hole</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="pihole" pt="md">
          <PiholePanel />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  </Card>
);
