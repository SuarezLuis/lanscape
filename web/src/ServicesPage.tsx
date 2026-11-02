import { Badge, Box, Button, Card, Group, Modal, SegmentedControl, Select, Stack, Switch, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@lanscape/server/router";
import { type FormEvent, useState } from "react";
import { useTRPC } from "./trpc";

type Service = inferRouterOutputs<AppRouter>["services"]["list"][number];
type Input = inferRouterInputs<AppRouter>["services"]["save"];
type Kind = Input["kind"];

const KINDS: { value: Kind; label: string; target: string; placeholder: string; help: string }[] = [
  { value: "http", label: "Web (HTTP)", target: "Address", placeholder: "http://192.168.0.10:8080", help: "Up when it answers with a status below 400. Self-signed certificates are fine." },
  { value: "tcp", label: "Port (TCP)", target: "Host and port", placeholder: "192.168.0.10:22", help: "Up when the port accepts a connection." },
  { value: "dns", label: "DNS", target: "DNS server", placeholder: "192.168.0.2", help: "Up when this DNS server, like your Pi-hole, can look up the name below." },
];

const STATUS: Record<string, { label: string; color: string }> = {
  up: { label: "Up", color: "teal" },
  failing: { label: "Failing", color: "yellow" },
  down: { label: "Down", color: "red" },
  waiting: { label: "Waiting", color: "gray" },
};

const EMPTY: Input = { name: "", kind: "http", target: "", query: null, everyMinutes: 1, enabled: true, alert: true };

const when = (date: Date) => date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const ServiceForm = ({ initial, onDone }: { initial: Input; onDone: () => void }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const save = useMutation(
    trpc.services.save.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.services.list.queryFilter());
        onDone();
      },
    }),
  );
  const kind = KINDS.find((option) => option.value === form.kind)!;
  // zod's field errors come back in the message as JSON
  const errors: Record<string, string> = {};
  try {
    for (const issue of JSON.parse(save.error?.message ?? "[]") as { path: string[]; message: string }[]) errors[issue.path[0] ?? ""] ??= issue.message;
  } catch {
    errors[""] = save.error?.message ?? "";
  }
  const set = (patch: Partial<Input>) => setForm((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(form);
  };

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <TextInput label="Name" placeholder="Home Assistant" value={form.name} error={errors.name} onChange={(event) => set({ name: event.currentTarget.value })} />
        <SegmentedControl value={form.kind} onChange={(value) => set({ kind: value as Kind })} data={KINDS.map(({ value, label }) => ({ value, label }))} />
        <TextInput
          label={kind.target}
          description={kind.help}
          placeholder={kind.placeholder}
          value={form.target}
          error={errors.target}
          onChange={(event) => set({ target: event.currentTarget.value })}
        />
        {form.kind === "dns" && (
          <TextInput label="Name to look up" placeholder="example.com" value={form.query ?? ""} error={errors.query} onChange={(event) => set({ query: event.currentTarget.value })} />
        )}
        <Select
          label="Check every"
          value={String(form.everyMinutes)}
          onChange={(value) => set({ everyMinutes: Number(value) as Input["everyMinutes"] })}
          data={[
            { value: "1", label: "Minute" },
            { value: "5", label: "5 minutes" },
            { value: "15", label: "15 minutes" },
          ]}
          allowDeselect={false}
        />
        <Switch label="Alert when it goes down and when it's back" checked={form.alert} onChange={(event) => set({ alert: event.currentTarget.checked })} />
        <Switch label="Checking on" checked={form.enabled} onChange={(event) => set({ enabled: event.currentTarget.checked })} />
        {errors[""] && (
          <Text size="sm" c="red">
            {errors[""]}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

const ServiceRow = ({ service, edit }: { service: Service; edit: () => void }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries(trpc.services.list.queryFilter());
  const checkNow = useMutation(trpc.services.checkNow.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.services.delete.mutationOptions({ onSuccess: refresh }));
  const status = service.enabled ? STATUS[service.status]! : { label: "Paused", color: "gray" };

  return (
    <Card withBorder padding="sm" radius="md">
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: "1 1 220px" }}>
            <Badge color={status.color} variant="light" style={{ flexShrink: 0 }}>
              {status.label}
            </Badge>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text fw={600} truncate>
                {service.name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {KINDS.find((kind) => kind.value === service.kind)?.label} · {service.target}
                {service.query ? ` · ${service.query}` : ""}
              </Text>
            </Stack>
          </Group>
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Button size="compact-xs" variant="subtle" loading={checkNow.isPending} onClick={() => checkNow.mutate({ id: service.id })}>
              Check now
            </Button>
            <Button size="compact-xs" variant="subtle" onClick={edit}>
              Edit
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              loading={remove.isPending}
              onClick={() => window.confirm(`Delete ${service.name} and its history?`) && remove.mutate({ id: service.id })}
            >
              Delete
            </Button>
          </Group>
        </Group>
        <Group gap="lg">
          <Text size="xs" c="dimmed">
            {service.last ? `${service.last.ok ? "Answered" : "Failed"} ${when(service.last.at)}: ${service.last.detail}` : "Not checked yet"}
          </Text>
          {service.avgMs24h !== null && (
            <Text size="xs" c="dimmed">
              {service.avgMs24h.toFixed(0)} ms average
            </Text>
          )}
          {service.uptime24h !== null && (
            <Text size="xs" c="dimmed">
              {Number(service.uptime24h.toFixed(1))}% up in 24 h
            </Text>
          )}
        </Group>
        {service.recent.length > 0 && (
          <Group gap={2} wrap="nowrap" aria-label="Latest checks, oldest first">
            {service.recent.map((result) => (
              <Tooltip key={result.at.toISOString()} label={`${when(result.at)}: ${result.detail}`}>
                <Box w={6} h={16} bg={result.ok ? "teal.6" : "red.6"} style={{ borderRadius: 2, flexShrink: 0 }} />
              </Tooltip>
            ))}
          </Group>
        )}
      </Stack>
    </Card>
  );
};

export const ServicesPage = () => {
  const trpc = useTRPC();
  const services = useQuery({ ...trpc.services.list.queryOptions(), refetchInterval: 30_000 });
  const [editing, setEditing] = useState<Input | null>(null);

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Title order={3}>Services</Title>
          <Button size="xs" variant="light" onClick={() => setEditing(EMPTY)}>
            Add service
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          Watch the services on your network: a web app answering, a port accepting connections, or a DNS server resolving
          names. A service is down after two failed checks in a row, and you're alerted when it goes down and when it's back.
        </Text>
        {services.data?.length === 0 && <Text size="sm">No services yet. Add your NAS, Home Assistant, Pi-hole or anything else you rely on.</Text>}
        {services.data?.map((service) => (
          <ServiceRow
            key={service.id}
            service={service}
            edit={() => setEditing({ id: service.id, name: service.name, kind: service.kind as Kind, target: service.target, query: service.query, everyMinutes: service.everyMinutes as Input["everyMinutes"], enabled: service.enabled, alert: service.alert })}
          />
        ))}
      </Stack>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? "Edit service" : "Add service"}>
        {editing && <ServiceForm initial={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Card>
  );
};
