import { Anchor, Badge, Button, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { navigate } from "./route";
import { useTRPC } from "./trpc";

// When this browser last looked at the overview, for "new since your last visit"; per viewer, so browser storage
const VISIT = "lanscape.lastVisit";
const readVisit = () => {
  try {
    const value = localStorage.getItem(VISIT);
    return value ? new Date(value) : undefined;
  } catch {
    return undefined;
  }
};
const saveVisit = () => {
  try {
    localStorage.setItem(VISIT, new Date().toISOString());
  } catch {
    // Storage can be off in a private window; the page then shows the last day
  }
};

const when = (date: Date) => date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ago = (date: Date) => {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
};
const lasted = (minutes: number) => (minutes < 60 ? `${Math.max(1, Math.round(minutes))} min` : `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`);

const Tile = ({ title, to, children }: { title: string; to: string; children: ReactNode }) => (
  <Card withBorder padding="md" radius="md">
    <Stack gap="xs" h="100%">
      <Group justify="space-between">
        <Title order={4}>{title}</Title>
        <Anchor
          size="sm"
          href={to}
          onClick={(event) => {
            event.preventDefault();
            navigate(to);
          }}
        >
          Details
        </Anchor>
      </Group>
      {children}
    </Stack>
  </Card>
);

const Big = ({ children }: { children: ReactNode }) => (
  <Text fz={32} fw={700} lh={1.1}>
    {children}
  </Text>
);

export const OverviewPage = () => {
  const trpc = useTRPC();
  const [since] = useState(readVisit);
  useEffect(() => {
    // The visit is recorded on leaving, so a reload doesn't empty "new since your last visit"
    const leave = () => document.visibilityState === "hidden" && saveVisit();
    document.addEventListener("visibilitychange", leave);
    return () => {
      document.removeEventListener("visibilitychange", leave);
      saveVisit();
    };
  }, []);
  const data = useQuery({ ...trpc.overview.queryOptions({ since }), refetchInterval: 30_000, placeholderData: keepPreviousData }).data;
  if (!data) return null;
  const { internet, speed, outages, services, devices, alerts } = data;

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
      <Tile title="Internet" to="/speedtests">
        <Group gap="sm" align="baseline">
          <Big>{internet.status === "down" ? "Down" : internet.status === "up" ? "Up" : "Waiting"}</Big>
          <Badge color={internet.status === "down" ? "red" : internet.status === "up" ? "teal" : "gray"} variant="light">
            {internet.status === "down" && internet.downSince ? `since ${ago(internet.downSince)}` : internet.pingMs !== null ? `${internet.pingMs.toFixed(0)} ms ping` : "no checks yet"}
          </Badge>
        </Group>
        <Text size="sm" c="dimmed">
          {internet.health ? `Health ${internet.health.score}/100 (${internet.health.grade}) over the last 24 hours` : "The health score needs half an hour of ping checks."}
        </Text>
      </Tile>

      <Tile title="Speed" to="/speedtests">
        {speed ? (
          <>
            <Group gap="lg">
              <div>
                <Big>{speed.downloadMbps.toFixed(0)}</Big>
                <Text size="xs" c="dimmed">
                  Mbps down{speed.planDownloadMbps ? ` · ${Math.round((100 * speed.downloadMbps) / speed.planDownloadMbps)}% of plan` : ""}
                </Text>
              </div>
              <div>
                <Big>{speed.uploadMbps.toFixed(0)}</Big>
                <Text size="xs" c="dimmed">
                  Mbps up{speed.planUploadMbps ? ` · ${Math.round((100 * speed.uploadMbps) / speed.planUploadMbps)}% of plan` : ""}
                </Text>
              </div>
            </Group>
            <Text size="sm" c="dimmed">
              Last test {ago(speed.at)}, {speed.pingMs.toFixed(0)} ms ping
            </Text>
          </>
        ) : (
          <Text size="sm">No speed tests yet. Run one, or schedule them on the Automations page.</Text>
        )}
      </Tile>

      <Tile title="Outages" to="/speedtests">
        <Big>{outages.thisWeek}</Big>
        <Text size="sm" c="dimmed">
          {outages.thisWeek === 0 ? "No outages in the last week." : `in the last week, ${lasted(outages.minutesThisWeek)} in total.`}
        </Text>
        {outages.last && (
          <Text size="sm">
            Last: {when(outages.last.start)}, {lasted(outages.last.minutes)},{" "}
            {outages.last.cause === "internet" ? "past your router" : outages.last.cause === "home" ? "in your home network" : "cause unknown"}.
          </Text>
        )}
      </Tile>

      <Tile title="Services" to="/services">
        {services.total === 0 ? (
          <Text size="sm">Not watching any services yet. Add your NAS, Home Assistant or Pi-hole on the Services page.</Text>
        ) : (
          <>
            <Group gap="sm" align="baseline">
              <Big>
                {services.up}/{services.total}
              </Big>
              <Badge color={services.trouble.length ? "red" : "teal"} variant="light">
                {services.trouble.length ? `${services.trouble.length} with trouble` : "all up"}
              </Badge>
            </Group>
            {services.trouble.map((service) => (
              <Text key={service.id} size="sm">
                <Text span fw={600}>
                  {service.name}
                </Text>{" "}
                {service.status === "down" ? "is down" : "failed its last check"}
                {service.since ? ` since ${ago(service.since)}` : ""}
              </Text>
            ))}
          </>
        )}
      </Tile>

      <Tile title="Devices" to="/network">
        <Group gap="sm" align="baseline">
          <Big>{devices.online}</Big>
          <Text size="sm" c="dimmed">
            online of {devices.total}
            {devices.unknownOnline ? ` · ${devices.unknownOnline} not marked known` : ""}
          </Text>
        </Group>
        <Text size="sm" fw={600}>
          New since {since ? "your last visit" : "yesterday"}
        </Text>
        {devices.new.length === 0 ? (
          <Text size="sm" c="dimmed">
            None.
          </Text>
        ) : (
          devices.new.map((device) => (
            <Text key={device.mac} size="sm">
              {device.name} <Text span c="dimmed">({device.ip}, {ago(device.firstSeen)})</Text>
            </Text>
          ))
        )}
      </Tile>

      <Tile title="Alerts" to="/notifications">
        {alerts.latest.length === 0 ? (
          <Text size="sm" c="dimmed">
            No alerts yet.
          </Text>
        ) : (
          <>
            {alerts.unread > 0 && (
              <Badge color="red" variant="light">
                {alerts.unread} unread
              </Badge>
            )}
            {alerts.latest.map((alert) => (
              <Text key={alert.id} size="sm" lineClamp={2} style={{ whiteSpace: "pre-line" }}>
                <Text span c="dimmed">
                  {ago(alert.createdAt)}:
                </Text>{" "}
                {alert.message}
              </Text>
            ))}
          </>
        )}
        {data.assistant && (
          <Group mt="auto" pt="xs">
            <Button size="xs" variant="light" onClick={() => navigate("/assistant")}>
              Ask the assistant
            </Button>
          </Group>
        )}
      </Tile>
    </SimpleGrid>
  );
};
