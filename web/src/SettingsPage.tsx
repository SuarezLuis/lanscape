import { Button, Card, Code, Group, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { BackupCard } from "./BackupCard";
import { useTRPC } from "./trpc";

export const SettingsPage = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const signedOut = () => queryClient.invalidateQueries();
  const status = useQuery(trpc.auth.status.queryOptions());
  const onUmbrel = status.data?.onUmbrel ?? false;
  const change = useMutation(trpc.auth.changePassword.mutationOptions());
  const resetToUmbrel = useMutation(trpc.auth.resetToUmbrel.mutationOptions());
  const logout = useMutation(trpc.auth.logout.mutationOptions({ onSuccess: signedOut }));
  const logoutEverywhere = useMutation(trpc.auth.logoutEverywhere.mutationOptions({ onSuccess: signedOut }));
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate(
      { current, next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirm("");
        },
      },
    );
  };

  return (
    <Stack gap="lg">
      <Card withBorder padding="md" radius="md">
        <form onSubmit={submit}>
          <Stack gap="sm" maw={420}>
            <Title order={3}>Change password</Title>
            <PasswordInput
              label="Current password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.currentTarget.value)}
            />
            <PasswordInput
              label="New password"
              description="At least 8 characters."
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.currentTarget.value)}
            />
            <PasswordInput
              label="Confirm new password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.currentTarget.value)}
              error={mismatch ? "Passwords don't match" : null}
            />
            {change.isError && (
              <Text size="sm" c="red">
                {change.error.message}
              </Text>
            )}
            {change.isSuccess && <Text size="sm">Password changed. Other browsers have been signed out.</Text>}
            <Group>
              <Button type="submit" loading={change.isPending} disabled={!current || !next || next !== confirm}>
                Change password
              </Button>
            </Group>
          </Stack>
        </form>
      </Card>

      {onUmbrel && (
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm" maw={560}>
            <Title order={3}>Umbrel password</Title>
            <Text size="sm" c="dimmed">
              LANscape starts with the password Umbrel shows for it in the app's menu on the Umbrel home screen. If you
              changed it here, this switches back so the two match again. Other browsers are signed out.
            </Text>
            {resetToUmbrel.isSuccess && <Text size="sm">Done. Your password is now the one Umbrel shows.</Text>}
            <Group>
              <Button variant="default" loading={resetToUmbrel.isPending} onClick={() => resetToUmbrel.mutate()}>
                Reset to the Umbrel password
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Sessions</Title>
          <Text size="sm" c="dimmed">
            Browsers stay signed in for 30 days after their last visit.
          </Text>
          <Group>
            <Button variant="default" loading={logout.isPending} onClick={() => logout.mutate()}>
              Sign out
            </Button>
            <Button variant="light" color="red" loading={logoutEverywhere.isPending} onClick={() => logoutEverywhere.mutate()}>
              Sign out everywhere
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={3}>Export data</Title>
          <Text size="sm" c="dimmed">
            Everything LANscape has recorded, as CSV files for a spreadsheet.
          </Text>
          <Group>
            <Button component="a" href="/export/speedtests.csv" variant="default">
              Speed tests
            </Button>
            <Button component="a" href="/export/pings.csv" variant="default">
              Ping checks
            </Button>
            <Button component="a" href="/export/devices.csv" variant="default">
              Devices
            </Button>
          </Group>
        </Stack>
      </Card>

      <BackupCard />

      <Card withBorder padding="md" radius="md">
        <Stack gap="xs">
          <Title order={3}>Forgot your password?</Title>
          {onUmbrel ? (
            <Text size="sm">
              In Umbrel, open LANscape's settings, set <Code>RESET_PASSWORD</Code> to <Code>yes</Code> and restart the app. The
              password goes back to the one Umbrel shows. Set it back to empty afterwards, or each restart resets it again.
            </Text>
          ) : (
            <Text size="sm">
              Create an empty file named <Code>reset-password</Code> in LANscape's data folder and restart. The password is
              cleared, and the next visit asks for a new one.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
};
