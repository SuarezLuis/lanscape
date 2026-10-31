import { Alert, Button, Card, FileInput, Group, List, PasswordInput, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AppRouter } from "@lanscape/server/router";
import type { inferRouterOutputs } from "@trpc/server";
import { useTRPC } from "./trpc";

type BackupPreview = inferRouterOutputs<AppRouter>["backup"]["undo"];

const COUNT_LABELS: Record<string, [string, string]> = {
  devices: ["device", "devices"],
  namedDevices: ["device you named", "devices you named"],
  speedTests: ["speed test", "speed tests"],
  pingChecks: ["ping check", "ping checks"],
  rules: ["notification rule", "notification rules"],
  alerts: ["alert", "alerts"],
  schedules: ["custom schedule", "custom schedules"],
};

const headers = (passphrase: string): HeadersInit =>
  passphrase ? { "x-backup-passphrase": encodeURIComponent(passphrase) } : {};

const send = async (path: string, file: File | null, passphrase: string) => {
  const response = await fetch(path, {
    method: "POST",
    headers: { ...headers(passphrase), ...(file && { "content-type": "application/octet-stream" }) },
    body: file,
  });
  if (!response.ok) throw new Error(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? `Failed (${response.status})`);
  return response;
};

const download = async (passphrase: string) => {
  const blob = await (await send("/backup/export", null, passphrase)).blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `lanscape-${new Date().toISOString().slice(0, 10)}.lanscape`;
  link.click();
  URL.revokeObjectURL(link.href);
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const Preview = ({ preview }: { preview: BackupPreview }) => (
  <Stack gap={4}>
    <Text size="sm">
      Made {when(preview.createdAt)} by LANscape {preview.app}
      {preview.encrypted ? ", encrypted" : ""}. It has:
    </Text>
    <List size="sm">
      {Object.entries(preview.counts)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => (
          <List.Item key={key}>
            {count.toLocaleString()} {COUNT_LABELS[key]?.[count === 1 ? 0 : 1] ?? key}
          </List.Item>
        ))}
    </List>
    {preview.upgrades > 0 && (
      <Text size="sm" c="dimmed">
        It's from an older version and is brought up to date as it's restored.
      </Text>
    )}
  </Stack>
);

export const BackupCard = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canUndo = useQuery(trpc.backup.canUndo.queryOptions());
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");

  const backup = useMutation({ mutationFn: () => download(exportPassphrase) });
  const inspect = useMutation({
    mutationFn: async () => (await (await send("/backup/inspect", file, restorePassphrase)).json()) as BackupPreview,
  });
  // Everything on screen may have changed
  const restored = () => queryClient.invalidateQueries();
  const restore = useMutation({
    mutationFn: async () => (await (await send("/backup/restore", file, restorePassphrase)).json()) as BackupPreview,
    onSuccess: () => {
      setFile(null);
      inspect.reset();
      return restored();
    },
  });
  const undo = useMutation(trpc.backup.undo.mutationOptions({ onSuccess: restored }));

  const choose = (next: File | null) => {
    setFile(next);
    inspect.reset();
    restore.reset();
  };

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="lg" maw={560}>
        <Stack gap="sm">
          <Title order={3}>Back up</Title>
          <Text size="sm" c="dimmed">
            One file with everything: history, devices and their names, rules, schedules and settings. Use it to move
            LANscape to another Umbrel or to go back to it later.
          </Text>
          <Alert color="yellow" variant="light" p="xs">
            <Text size="sm">
              The file includes your alert channels' secrets (bot tokens, webhook addresses) and your Pi-hole app password. Set a passphrase to encrypt
              it, and keep the passphrase: without it the backup can't be restored.
            </Text>
          </Alert>
          <PasswordInput
            label="Passphrase (optional)"
            autoComplete="new-password"
            value={exportPassphrase}
            onChange={(event) => setExportPassphrase(event.currentTarget.value)}
          />
          {backup.isError && (
            <Text size="sm" c="red">
              {backup.error.message}
            </Text>
          )}
          <Group>
            <Button variant="default" loading={backup.isPending} onClick={() => backup.mutate()}>
              {exportPassphrase ? "Download encrypted backup" : "Download backup"}
            </Button>
          </Group>
        </Stack>

        <Stack gap="sm">
          <Title order={3}>Restore</Title>
          <Text size="sm" c="dimmed">
            Replaces everything LANscape has now with a backup. Your password and signed-in browsers stay as they are. The
            current data is saved first, so you can undo.
          </Text>
          <FileInput label="Backup file" placeholder="Choose a .lanscape file" accept=".lanscape" clearable value={file} onChange={choose} />
          <PasswordInput
            label="Passphrase"
            description="Only for an encrypted backup."
            autoComplete="off"
            value={restorePassphrase}
            onChange={(event) => {
              setRestorePassphrase(event.currentTarget.value);
              inspect.reset();
            }}
          />
          {(inspect.isError || restore.isError) && (
            <Text size="sm" c="red">
              {(inspect.error ?? restore.error)?.message}
            </Text>
          )}
          {inspect.data && !restore.isSuccess && <Preview preview={inspect.data} />}
          {restore.isSuccess && <Text size="sm">Restored. Everything on screen now comes from the backup.</Text>}
          <Group>
            {inspect.data ? (
              <Button color="red" loading={restore.isPending} onClick={() => restore.mutate()}>
                Replace current data with this backup
              </Button>
            ) : (
              <Button variant="default" disabled={!file} loading={inspect.isPending} onClick={() => inspect.mutate()}>
                Check backup
              </Button>
            )}
          </Group>
        </Stack>

        {canUndo.data && (
          <Stack gap="sm">
            <Title order={4}>Undo the last restore</Title>
            <Text size="sm" c="dimmed">
              Puts back the data as it was just before the last restore. LANscape keeps the last three of these copies in
              its data folder, under backups.
            </Text>
            {undo.isError && (
              <Text size="sm" c="red">
                {undo.error.message}
              </Text>
            )}
            {undo.isSuccess && <Text size="sm">Undone.</Text>}
            <Group>
              <Button variant="default" loading={undo.isPending} onClick={() => undo.mutate()}>
                Undo last restore
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Card>
  );
};
