import {
  AppShell,
  Badge,
  Burger,
  Card,
  Center,
  Group,
  type MantineColorScheme,
  type NavLinkProps,
  NavLink,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AutomationsPage } from "./AutomationsPage";
import { type AnimatedIcon, useIconHover } from "./icons/animate";
import { BellIcon } from "./icons/bell";
import { GaugeIcon } from "./icons/gauge";
import { MoonIcon } from "./icons/moon";
import { RouterIcon } from "./icons/router";
import { SunIcon } from "./icons/sun";
import { MonitorCogIcon } from "./icons/monitor-cog";
import { WorkflowIcon } from "./icons/workflow";
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
    icon: GaugeIcon,
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
    icon: RouterIcon,
    element: <Placeholder title="Network" text="Devices on your network will show up here." />,
  },
  {
    path: "/automations",
    label: "Automations",
    icon: WorkflowIcon,
    element: <AutomationsPage />,
  },
  {
    path: "/notifications",
    label: "Notifications",
    icon: BellIcon,
    element: <Placeholder title="Notifications" text="Alerts about your network will show up here." />,
  },
] as const;
const [HOME] = PAGES;

const NavItem = ({ icon: Icon, ...props }: NavLinkProps & { icon: AnimatedIcon; href: string; onClick: (event: React.MouseEvent) => void }) => {
  const { ref, hover } = useIconHover();
  return <NavLink {...props} {...hover} leftSection={<Icon ref={ref} size={18} />} />;
};

// Icon only, so it fits the header on phones; the label goes to the tooltip and screen readers
const SchemeLabel = ({ icon: Icon, label }: { icon: AnimatedIcon; label: string }) => {
  const { ref, hover } = useIconHover();
  return (
    <Tooltip label={label} withArrow>
      <Center {...hover} aria-label={label}>
        <Icon ref={ref} size={16} />
      </Center>
    </Tooltip>
  );
};

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
            <Group gap={8} wrap="nowrap">
              <img src="/favicon.svg" alt="" width={28} height={28} style={{ borderRadius: 6 }} />
              <Title order={2} size="h3">
                LANscape
              </Title>
            </Group>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <Badge color={color} visibleFrom="sm">
              {status}
            </Badge>
            <SegmentedControl
              size="xs"
              value={colorScheme}
              onChange={(value) => setColorScheme(value as MantineColorScheme)}
              data={[
                { value: "light", label: <SchemeLabel icon={SunIcon} label="Light" /> },
                { value: "dark", label: <SchemeLabel icon={MoonIcon} label="Dark" /> },
                { value: "auto", label: <SchemeLabel icon={MonitorCogIcon} label="System" /> },
              ]}
              aria-label="Color scheme"
            />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section grow>
          {PAGES.map((item) => (
            <NavItem
              key={item.path}
              icon={item.icon}
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
      </AppShell.Navbar>

      <AppShell.Main>{(page ?? HOME).element}</AppShell.Main>
    </AppShell>
  );
};
