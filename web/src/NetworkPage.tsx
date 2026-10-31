import {
  Badge,
  Button,
  Card,
  Drawer,
  Group,
  Modal,
  Select,
  Stack,
  Stepper,
  Switch,
  Table,
  Text,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRouter } from "@lanscape/server/router";
import type { inferRouterOutputs } from "@trpc/server";
import { type ReactNode, useState } from "react";
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
        onClick={(event) => {
          event.stopPropagation(); // the row opens details; the name renames
          setDraft(device.name ?? "");
        }}
      >
        {shown ?? "Unnamed"}
      </Text>
    </Tooltip>
  );
};

const deviceLabel = (device: Device) => device.name ?? device.hostname ?? device.vendor ?? "Unknown device";

const STEPS = [
  { label: "On", text: "Make sure the device is on and connected, then scan." },
  { label: "Off", text: "Turn the device off or disconnect it from the network, wait about 10 seconds, then scan." },
  {
    label: "Back on",
    text: "A few devices went quiet at once. Turn it back on and wait until it's connected again (Wi-Fi devices can take a minute), then scan. Only the one that comes back is it.",
  },
];

const DeviceDetails = ({ device }: { device: Device }) => {
  const rows: [string, ReactNode][] = [
    ["Your name", device.name ?? <Text span c="dimmed" fz="sm">None yet</Text>],
    ["Discovered name", device.hostname ?? <Text span c="dimmed" fz="sm">None (the device doesn't announce one)</Text>],
    [
      "Manufacturer",
      device.vendor === "Private address" ? (
        <>
          Hidden <Text span c="dimmed" fz="sm">(it uses a private MAC address, common on phones and laptops)</Text>
        </>
      ) : (
        device.vendor ?? <Text span c="dimmed" fz="sm">Unknown</Text>
      ),
    ],
    ["IP address", <Text span ff="monospace" fz="sm">{device.ip}</Text>],
    ["MAC address", <Text span ff="monospace" fz="sm">{device.mac}</Text>],
    ["First seen", when(device.firstSeen)],
    ["Last seen", device.online ? "Now" : when(device.lastSeen)],
  ];
  return (
    <Table withRowBorders={false} verticalSpacing={4} fz="sm">
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td c="dimmed" w={150} pl={0}>
              {label}
            </Table.Td>
            <Table.Td>{value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

// Off-then-on narrows it down: dozing phones and plugs can drop out of one scan, but rarely in step with you
const IdentifyDevice = ({ opened, onClose, devices }: { opened: boolean; onClose: () => void; devices: Device[] }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const scan = useMutation(trpc.devices.scan.mutationOptions());
  const rename = useMutation(
    trpc.devices.rename.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.devices.list.queryFilter()) }),
  );
  const [step, setStep] = useState(0);
  const [baseline, setBaseline] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState("");

  const reset = () => {
    setStep(0);
    setBaseline([]);
    setCandidates(null);
    setNote(null);
    setChosen(null);
    setName("");
  };
  const close = () => {
    reset();
    onClose();
  };
  const choose = (mac: string) => {
    setChosen(mac);
    setName(devices.find((device) => device.mac === mac)?.name ?? "");
    setStep(3);
  };

  const runStep = () =>
    scan.mutate(
      { thorough: true },
      {
        onSuccess: ({ online }) => {
          setNote(null);
          if (step === 0) {
            setBaseline(online);
            setStep(1);
          } else if (step === 1) {
            const gone = baseline.filter((mac) => !online.includes(mac));
            if (gone.length === 0) setNote("Nothing went offline. Give it a few more seconds after turning it off, then scan again.");
            else if (gone.length === 1 && gone[0]) choose(gone[0]);
            else {
              setCandidates(gone);
              setStep(2);
            }
          } else {
            const back = (candidates ?? []).filter((mac) => online.includes(mac));
            if (back.length === 0) setNote("None of them are back yet. Wait a bit longer, then scan again.");
            else if (back.length === 1 && back[0]) choose(back[0]);
            else setCandidates(back);
          }
        },
      },
    );

  const byMac = (mac: string) => devices.find((device) => device.mac === mac);
  const found = chosen ? byMac(chosen) : undefined;

  return (
    <Modal opened={opened} onClose={close} title="Identify a device" size="lg">
      <Stepper active={step} size="sm" allowNextStepsSelect={false}>
        {STEPS.map((item) => (
          <Stepper.Step key={item.label} label={item.label}>
            <Stack gap="sm" mt="md">
              <Text size="sm">{item.text}</Text>
              {note && (
                <Text size="sm" c="orange">
                  {note}
                </Text>
              )}
              {step === 2 && candidates && candidates.length > 1 && (
                <Text size="sm" c="dimmed">
                  Still possible: {candidates.map((mac) => byMac(mac)).filter(Boolean).map((device) => deviceLabel(device as Device)).join(", ")}.
                  You can also pick one: {" "}
                  {candidates.map((mac) => (
                    <Button key={mac} size="compact-xs" variant="default" mr={4} mb={4} onClick={() => choose(mac)}>
                      {byMac(mac) ? `${deviceLabel(byMac(mac) as Device)} · ${byMac(mac)?.ip}` : mac}
                    </Button>
                  ))}
                </Text>
              )}
              <Group>
                <Button onClick={runStep} loading={scan.isPending}>
                  Scan
                </Button>
                {scan.isPending && (
                  <Text size="sm" c="dimmed">
                    Scanning twice to be sure, about 20 seconds.
                  </Text>
                )}
              </Group>
              {scan.isError && (
                <Text size="sm" c="red">
                  {scan.error.message}
                </Text>
              )}
            </Stack>
          </Stepper.Step>
        ))}
        <Stepper.Completed>
          {found && (
            <Stack gap="sm" mt="md">
              <Text size="sm" fw={500}>
                Found it:
              </Text>
              <DeviceDetails device={found} />
              <TextInput
                label="Name it"
                placeholder={found.hostname ?? "Living room lamp"}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                autoFocus
              />
              <Group>
                <Button
                  loading={rename.isPending}
                  onClick={() => rename.mutate({ mac: found.mac, name }, { onSuccess: close })}
                >
                  Save name
                </Button>
                <Button variant="default" onClick={reset}>
                  Identify another
                </Button>
              </Group>
            </Stack>
          )}
        </Stepper.Completed>
      </Stepper>
    </Modal>
  );
};

const OFFLINE_ALERT = [
  { value: "off", label: "Off" },
  { value: "5", label: "Offline 5 minutes" },
  { value: "10", label: "Offline 10 minutes" },
  { value: "30", label: "Offline 30 minutes" },
  { value: "60", label: "Offline 1 hour" },
];

// What the device asks DNS for, when Pi-hole is connected (Integrations page)
const PiholeActivity = ({ mac }: { mac: string }) => {
  const trpc = useTRPC();
  const activity = useQuery(trpc.integrations.piholeActivity.queryOptions({ mac }));
  const data = activity.data;
  if (activity.isPending || data === null || data === undefined) return null;

  return (
    <Stack gap={6}>
      <Title order={5}>DNS activity (Pi-hole)</Title>
      {!data.found ? (
        <Text size="sm" c="dimmed">
          {"error" in data ? data.error : "Pi-hole hasn't seen requests from this device."}
        </Text>
      ) : (
        <>
          <Text size="sm">
            {data.total.toLocaleString()} requests in Pi-hole's history
            {data.lastQuery ? `, the latest ${when(data.lastQuery)}` : ""}. Of its last {data.sampled.toLocaleString()},{" "}
            {data.blocked.toLocaleString()} were blocked.
          </Text>
          {data.topDomains.length > 0 && (
            <Table fz="sm" verticalSpacing={2}>
              <Table.Tbody>
                {data.topDomains.map((row) => (
                  <Table.Tr key={row.domain}>
                    <Table.Td style={{ wordBreak: "break-all" }}>{row.domain}</Table.Td>
                    <Table.Td ta="right" c="dimmed">
                      {row.count}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}
    </Stack>
  );
};

const ONLINE_ALERT = [
  { value: "off", label: "Off" },
  { value: "15", label: "After 15 minutes away" },
  { value: "30", label: "After 30 minutes away" },
  { value: "60", label: "After 1 hour away" },
  { value: "240", label: "After 4 hours away" },
];

const DeviceDrawer = ({ device, onClose }: { device: Device | null; onClose: () => void }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const history = useQuery({ ...trpc.devices.history.queryOptions({ mac: device?.mac ?? "" }), enabled: device !== null });
  const refresh = () => queryClient.invalidateQueries(trpc.devices.list.queryFilter());
  const update = useMutation(trpc.devices.update.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(
    trpc.devices.delete.mutationOptions({
      onSuccess: () => {
        onClose();
        return refresh();
      },
    }),
  );

  return (
    <Drawer opened={device !== null} onClose={onClose} position="right" title={device ? deviceLabel(device) : ""}>
      {device && (
        <Stack gap="md">
          <DeviceDetails device={device} />
          <Switch
            label="Known device"
            description="Mark devices you recognize. Unknown ones show a New badge."
            checked={device.known}
            onChange={(event) => update.mutate({ mac: device.mac, known: event.currentTarget.checked })}
          />
          <Select
            label="Alert when offline"
            description="Sends one alert when it goes quiet and one when it's back, through your alert channels."
            data={OFFLINE_ALERT}
            value={device.alertOfflineMinutes ? String(device.alertOfflineMinutes) : "off"}
            onChange={(value) =>
              update.mutate({
                mac: device.mac,
                alertOfflineMinutes: value && value !== "off" ? (Number(value) as 5 | 10 | 30 | 60) : null,
              })
            }
            allowDeselect={false}
          />
          <Select
            label="Alert when online"
            description="Alerts each time it comes online after being away, like a phone arriving home. Short absences, like a dozing phone, don't count."
            data={ONLINE_ALERT}
            value={device.alertOnlineMinutes ? String(device.alertOnlineMinutes) : "off"}
            onChange={(value) =>
              update.mutate({
                mac: device.mac,
                alertOnlineMinutes: value && value !== "off" ? (Number(value) as 15 | 30 | 60 | 240) : null,
              })
            }
            allowDeselect={false}
          />
          <PiholeActivity mac={device.mac} />
          <Title order={5}>History</Title>
          {history.data?.length === 0 && (
            <Text size="sm" c="dimmed">
              No changes recorded yet.
            </Text>
          )}
          <Timeline bulletSize={12} lineWidth={2}>
            {history.data?.map((event) => (
              <Timeline.Item key={event.id} color={event.online ? "teal" : "gray"} title={event.online ? "Came online" : "Went offline"}>
                <Text size="xs" c="dimmed">
                  {when(event.at)}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
          <Stack gap={4}>
            <Group>
              <Button
                variant="light"
                color="red"
                loading={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${deviceLabel(device)} and its history? If it shows up again, it's a new device.`)) {
                    remove.mutate({ mac: device.mac });
                  }
                }}
              >
                Delete device
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Removes its name, settings and history. The next time it joins, LANscape lists it again and sends a new-device
              alert.
            </Text>
          </Stack>
        </Stack>
      )}
    </Drawer>
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
  const [identifying, setIdentifying] = useState(false);
  const scanIcon = useIconHover();

  const devices = list.data?.devices ?? [];
  const needle = filter.trim().toLowerCase();
  const rows = devices
    .filter((device) =>
      [device.name, device.hostname, device.vendor, device.ip, device.mac].some((value) => value?.toLowerCase().includes(needle)),
    )
    .toSorted((a, b) => Number(b.online) - Number(a.online) || ipOrder(a.ip) - ipOrder(b.ip));
  const online = devices.filter((device) => device.online).length;
  const unknown = devices.filter((device) => !device.known).length;
  const [openMac, setOpenMac] = useState<string | null>(null);
  const markAllKnown = useMutation(
    trpc.devices.markAllKnown.mutationOptions({ onSuccess: () => queryClient.invalidateQueries(trpc.devices.list.queryFilter()) }),
  );

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
          <Group gap="xs">
          {unknown > 0 && (
            <Button variant="subtle" loading={markAllKnown.isPending} onClick={() => markAllKnown.mutate()}>
              Mark all {unknown} known
            </Button>
          )}
          <Button component="a" href="/export/devices.csv" variant="subtle">
            Export CSV
          </Button>
          <Button variant="default" onClick={() => setIdentifying(true)} disabled={devices.length === 0}>
            Identify a device
          </Button>
          <Button
            onClick={() => scan.mutate(undefined)}
            loading={scan.isPending}
            leftSection={<RouterIcon ref={scanIcon.ref} size={16} />}
            {...scanIcon.hover}
          >
            Scan now
          </Button>
          </Group>
        </Group>
        <IdentifyDevice opened={identifying} onClose={() => setIdentifying(false)} devices={devices} />
        <DeviceDrawer device={devices.find((device) => device.mac === openMac) ?? null} onClose={() => setOpenMac(null)} />
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
                  <Table.Th>Status</Table.Th>
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
                  <Table.Tr key={device.mac} onClick={() => setOpenMac(device.mac)} style={{ cursor: "pointer" }}>
                    <Table.Td>
                      <Badge variant="dot" color={device.online ? "teal" : "gray"}>
                        {device.online ? "Online" : "Away"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <NameCell device={device} />
                        {!device.known && (
                          <Badge size="xs" color="blue" variant="light">
                            New
                          </Badge>
                        )}
                        {(device.alertOfflineMinutes || device.alertOnlineMinutes) && (
                          <Tooltip
                            label={[
                              device.alertOfflineMinutes && `Alerts after ${device.alertOfflineMinutes} minutes offline`,
                              device.alertOnlineMinutes && `Alerts when it comes online`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          >
                            <Badge size="xs" color="orange" variant="light">
                              Watched
                            </Badge>
                          </Tooltip>
                        )}
                      </Group>
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
