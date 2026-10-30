import { AppShell, Badge, Burger, Group, NavLink, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { navigate, usePath } from "./route";
import { SpeedTestCard } from "./SpeedTestCard";
import { useTRPC } from "./trpc";

const PAGES = [{ path: "/speedtests", label: "Speed tests", element: <SpeedTestCard /> }] as const;
const [HOME] = PAGES;

export const App = () => {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.queryOptions());
  const [navOpen, nav] = useDisclosure();
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
      padding="lg"
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between">
          <Group gap="sm">
            <Burger opened={navOpen} onClick={nav.toggle} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <Title order={2}>Lanscape</Title>
          </Group>
          <Badge color={color}>{status}</Badge>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
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
      </AppShell.Navbar>

      <AppShell.Main>{(page ?? HOME).element}</AppShell.Main>
    </AppShell>
  );
};
