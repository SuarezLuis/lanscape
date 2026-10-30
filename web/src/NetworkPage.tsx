import { ActionIcon, Badge, Button, Card, Group, Stack, Table, Text, TextInput, Title, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@lanscape/server/router";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { useIconHover } from "./icons/animate";
import { RouterIcon } from "./icons/router";
import { useTRPC } from "./trpc";

type Device = inferRouterOutputs<AppRouter>["devices"]["list"]["devices"][number];

const when = (date: Date) => date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ipOrder = (ip: string) => ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);

const NameCell = ({ device }: { device: Device }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const rename = useMutation(
    trpc.devices.rename.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.devices.list.queryFilter()) }),
  );
  const [draft, setDraft] = useState<string | null>(null);
  const shown = device.name ?? device.hostname;

  if (draft !== null) {
    const save = () => {
      if (draft !== (device.name ?? "")) rename.mutate({ mac: device.mac, name: draft });
      setDraft(null);
    };
    return (
      <TextInput
        size="xs"
        autoFocus
        value={draft}
        placeholder={device.hostname ?? "Name this device"}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") setDraft(null);
        }}
        aria-label="Device name"
      />
    );
  }
  return (
    <Tooltip label="Click to rename" openDelay={500}>
      <Text
        size="sm"
        fw={shown ? 500 : undefined}
        c={shown ? undefined : "dimmed"}
        style={{ cursor: "text" }}
        onClick={() => setDraft(device.name ?? "")}
      >
        {shown ?? "Unnamed"}
      </Text>
    </Tooltip>
  );
};

export const NetworkPage = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const list = useQuery({ ...trpc.devices.list.queryOptions(), refetchInterval: 60_000 });
  const scan = useMutation(
    trpc.devices.scan.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.devices.list.queryFilter()) }),
  );
  const [filter, setFilter] = useState("");
  const scanIcon = useIconHover();

  const devices = list.data?.devices ?? [];
  const needle = filter.trim().toLowerCase();
  const rows = devices
    .filter((device) =>
      [device.name, device.hostname, device.vendor, device.ip, device.mac].some((value) => value?.toLowerCase().includes(needle)),
    )
    .toSorted((a, b) => Number(b.online) - Number(a.online) || ipOrder(a.ip) - ipOrder(b.ip));
  const online = devices.filter((device) => device.online).length;

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={3}>Devices</Title>
            <Text size="sm" c="dimmed">
              {list.data?.lastScan
                ? `${online} online of ${devices.length} seen · last scan ${when(list.data.lastScan)}`
                : "Not scanned yet"}
            </Text>
          </div>
          <Button
            onClick={() => scan.mutate()}
            loading={scan.isPending}
            leftSection={<RouterIcon ref={scanIcon.ref} size={16} />}
            {...scanIcon.hover}
          >
            Scan now
          </Button>
        </Group>
        {scan.isError && (
          <Text size="sm" c="red">
            The scan failed: {scan.error.message}
          </Text>
        )}

        {devices.length > 0 && (
          <TextInput placeholder="Filter by name, maker, IP or MAC" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} />
        )}

        {devices.length > 0 && (
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={90}>Status</Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>IP</Table.Th>
                  <Table.Th>Maker</Table.Th>
                  <Table.Th>MAC</Table.Th>
                  <Table.Th>First seen</Table.Th>
                  <Table.Th>Last seen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((device) => (
                  <Table.Tr key={device.mac}>
                    <Table.Td>
                      <Badge variant="dot" color={device.online ? "teal" : "gray"}>
                        {device.online ? "Online" : "Away"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <NameCell device={device} />
                    </Table.Td>
                    <Table.Td ff="monospace" fz="sm">
                      {device.ip}
                    </Table.Td>
                    <Table.Td fz="sm">{device.vendor ?? <Text span c="dimmed" fz="sm">Unknown</Text>}</Table.Td>
                    <Table.Td ff="monospace" fz="sm">
                      {device.mac}
                    </Table.Td>
                    <Table.Td fz="sm">{when(device.firstSeen)}</Table.Td>
                    <Table.Td fz="sm">{device.online ? "Now" : when(device.lastSeen)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {list.data && devices.length === 0 && !scan.isPending && (
          <Text c="dimmed">No devices yet. Run a scan, or wait for the next scheduled one.</Text>
        )}
      </Stack>
    </Card>
  );
};
