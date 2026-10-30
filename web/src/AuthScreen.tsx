import { Button, Card, Center, Group, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTRPC } from "./trpc";

// First run sets the password; after that it's a sign-in screen
export const AuthScreen = ({ mode }: { mode: "setup" | "login" }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries();
  const setup = useMutation(trpc.auth.setup.mutationOptions({ onSuccess }));
  const login = useMutation(trpc.auth.login.mutationOptions({ onSuccess }));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = mode === "setup" ? setup : login;
  const mismatch = mode === "setup" && confirm.length > 0 && confirm !== password;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "setup") {
      if (password === confirm) setup.mutate({ password });
    } else login.mutate({ password });
  };

  return (
    <Center mih="100dvh" p="md">
      <Card withBorder radius="md" padding="lg" w="100%" maw={380}>
        <form onSubmit={submit}>
          <Stack gap="md">
            <Group gap={8}>
              <img src="/favicon.svg" alt="" width={32} height={32} style={{ borderRadius: 6 }} />
              <Title order={2} size="h3">
                LANscape
              </Title>
            </Group>
            {mode === "setup" ? (
              <Text size="sm" c="dimmed">
                Anyone on your network can open LANscape, so it needs a password. Choose one now; you can change it later in
                Settings.
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                Sign in to continue.
              </Text>
            )}
            <PasswordInput
              label="Password"
              autoFocus
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            {mode === "setup" && (
              <PasswordInput
                label="Confirm password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.currentTarget.value)}
                error={mismatch ? "Passwords don't match" : null}
              />
            )}
            {action.isError && (
              <Text size="sm" c="red">
                {action.error.message}
              </Text>
            )}
            <Button type="submit" loading={action.isPending} disabled={!password || (mode === "setup" && password !== confirm)}>
              {mode === "setup" ? "Set password" : "Sign in"}
            </Button>
          </Stack>
        </form>
      </Card>
    </Center>
  );
};
