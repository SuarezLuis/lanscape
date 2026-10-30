import {
  AppShell,
  Badge,
  Burger,
  Card,
  Group,
  type MantineColorScheme,
  NavLink,
  SegmentedControl,
  Stack,
  Text,
  Title,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { navigate, usePath } from "./route";
import { SpeedHistory } from "./SpeedHistory";
import { SpeedTestCard } from "./SpeedTestCard";
import { useTRPC } from "./trpc";

const Placeholder = ({ title, text }: { title: string; text: string }) => (
  <Card withBorder padding="md" radius="md">
    <Title order={3} mb="sm">
      {title}
    </Title>
    <Text c="dimmed">{text}</Text>
  </Card>
);

const PAGES = [
  {
    path: "/speedtests",
    label: "Speed tests",
    element: (
      <Stack gap="lg">
        <SpeedTestCard />
        <SpeedHistory />
      </Stack>
    ),
  },
  {
    path: "/network",
    label: "Network",
    element: <Placeholder title="Network" text="Devices on your network will show up here." />,
  },
  {
    path: "/automations",
    label: "Automations",
    element: <Placeholder title="Automations" text="Scheduled speed tests and other automations will live here." />,
  },
  {
    path: "/notifications",
    label: "Notifications",
    element: <Placeholder title="Notifications" text="Alerts about your network will show up here." />,
  },
] as const;
const [HOME] = PAGES;

export const App = () => {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.queryOptions());
  const [navOpen, nav] = useDisclosure();
  // Auto follows the system; Mantine keeps the choice in localStorage
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const path = usePath();
  const page = PAGES.find((candidate) => candidate.path === path);

  useEffect(() => {
    if (!page) navigate(HOME.path, { replace: true });
  }, [page]);

  const status = health.isPending ? "checking" : health.isError ? "server unreachable" : `ok · ${health.data.version}`;
  const color = health.isPending ? "gray" : health.isError ? "red" : "teal";

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !navOpen } }}
      padding={{ base: "sm", sm: "lg" }}
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between">
          <Group gap="sm">
            <Burger opened={navOpen} onClick={nav.toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Title order={2} size="h3">
              LANscape
            </Title>
          </Group>
          <Badge color={color} maw="50%">
            {status}
          </Badge>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section grow>
          {PAGES.map((item) => (
            <NavLink
              key={item.path}
              href={item.path}
              label={item.label}
              active={item.path === page?.path}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
                nav.close();
              }}
            />
          ))}
        </AppShell.Section>
        <AppShell.Section>
          <SegmentedControl
            fullWidth
            size="xs"
            value={colorScheme}
            onChange={(value) => setColorScheme(value as MantineColorScheme)}
            data={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "auto", label: "Auto" },
            ]}
            aria-label="Color scheme"
          />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{(page ?? HOME).element}</AppShell.Main>
    </AppShell>
  );
};
