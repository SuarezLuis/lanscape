import { Button, Card, Code, Group, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTRPC } from "./trpc";

export const SettingsPage = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const signedOut = () => queryClient.invalidateQueries();
  const change = useMutation(trpc.auth.changePassword.mutationOptions());
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
        <Stack gap="xs">
          <Title order={3}>Forgot your password?</Title>
          <Text size="sm">
            Create an empty file named <Code>reset-password</Code> in LANscape's data folder and restart the app. On Umbrel that
            folder is <Code>~/umbrel/app-data/sz-lanscape/data</Code>. The password is cleared, and the next visit asks for a new
            one.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
};
