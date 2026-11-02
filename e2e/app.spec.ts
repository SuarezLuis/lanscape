import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const signIn = async (page: Page, path = "/speedtests") => {
  await page.goto(path);
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("nav").getByRole("link", { name: "Speed tests" })).toBeVisible();
};

test("a wrong password is refused, the right one signs in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong password")).toBeVisible();
  await page.getByRole("textbox", { name: "Password" }).fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Internet health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outages" })).toBeVisible();
});

test("runs a speed test and shows the result", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Run speed test" }).click();
  await expect(page.getByText("640 Mbps").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("850 Mbps").first()).toBeVisible();
  await expect(page.getByText("Lakeview Fiber · Riverside").first()).toBeVisible();
});

test("renames a device", async ({ page }) => {
  await signIn(page, "/network");
  await page.getByText("Robot vacuum", { exact: true }).click();
  const name = page.getByLabel("Device name");
  await name.fill("Roomba");
  await name.press("Enter");
  await expect(page.getByText("Roomba", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Roomba", { exact: true })).toBeVisible();
  await expect(page.getByText("Robot vacuum", { exact: true })).toHaveCount(0);
});

test("a scan finds the devices that answer", async ({ page }) => {
  // The scan reads the default route from /proc, so it only runs on Linux (CI and Umbrel)
  test.skip(process.platform !== "linux", "Linux only");
  await signIn(page, "/network");
  await page.getByRole("button", { name: "Scan now" }).click();
  // A scan listens 5 seconds for mDNS names; the demo data's own last scan shows a different count until it's done
  await expect(page.getByText(/^[23] online of/)).toBeVisible({ timeout: 20_000 });
});

test("adds a notification rule and it survives a reload", async ({ page }) => {
  await signIn(page, "/notifications");
  // The demo data has rules; count them once they've loaded
  const rules = page.getByRole("switch", { name: "Rule on" });
  await expect(rules.first()).toBeAttached();
  const before = await rules.count();
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(rules).toHaveCount(before + 1);
  await page.reload();
  await expect(rules).toHaveCount(before + 1);
});

test("adds a service and checks it", async ({ page }) => {
  await signIn(page, "/services");
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Name").fill("LANscape itself");
  await page.getByLabel("Address").fill(`${new URL(page.url()).origin}/trpc/health`);
  await page.getByRole("button", { name: "Save" }).click();
  const row = page.locator(".mantine-Card-root", { hasText: "LANscape itself" }).last();
  await row.getByRole("button", { name: "Check now" }).click();
  await expect(row.getByText("Up", { exact: true })).toBeVisible();
  await expect(row.getByText(/Answered .*: HTTP 200/)).toBeVisible();
});

test("backs up, changes something, restores, and undoes the restore", async ({ page }) => {
  await signIn(page, "/settings");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download backup" }).click();
  const backup = await (await downloading).path();
  expect(readFileSync(backup).subarray(0, 40).toString()).toContain("lanscape-backup");

  // Change a device's name after the backup
  await page.goto("/network");
  await page.getByText("Desk lamp", { exact: true }).click();
  await page.getByLabel("Device name").fill("Changed after backup");
  await page.getByLabel("Device name").press("Enter");
  await expect(page.getByText("Changed after backup", { exact: true })).toBeVisible();

  await page.goto("/settings");
  // Mantine's FileInput is a button over a hidden file input
  await page.locator('input[type="file"]').setInputFiles(backup);
  await page.getByRole("button", { name: "Check backup" }).click();
  await page.getByRole("button", { name: "Replace current data with this backup" }).click();
  await expect(page.getByText("Restored. Everything on screen now comes from the backup.")).toBeVisible();
  await page.goto("/network");
  await expect(page.getByText("Desk lamp", { exact: true })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Undo last restore" }).click();
  await expect(page.getByText("Undone.")).toBeVisible();
  await page.goto("/network");
  await expect(page.getByText("Changed after backup", { exact: true })).toBeVisible();
});

test("sets up the assistant with a local model and answers from the network data", async ({ page }) => {
  await signIn(page, "/assistant");
  await page.getByRole("link", { name: "Set up the assistant" }).click();
  await page.getByText("Ollama or other").click();
  await page.getByLabel("Server address").fill("http://127.0.0.1:4601/v1");
  await page.getByRole("combobox", { name: "Model" }).fill("fake-model");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected. Ask away on the Assistant page.")).toBeVisible();

  await page.goto("/assistant");
  await expect(page.getByText("Nothing you ask leaves your network.")).toBeVisible();
  await page.getByLabel("Your question").fill("How many devices do I have?");
  await page.getByLabel("Your question").press("Enter");
  await expect(page.getByText(/You have \d+ devices on your network\./)).toBeVisible();
  await expect(page.getByText("Looked at: list_devices")).toBeVisible();
});
