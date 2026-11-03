import { expect, test } from "vitest";
import { createSession } from "./auth";
import { prisma } from "./db";
import { appRouter } from "./router";

const caller = (token: string | null = null) => appRouter.createCaller({ token, ip: "test", setCookie: () => {} });
const signedIn = async () => caller(await createSession());

test("health reaches the database", async () => {
  await expect(caller().health()).resolves.toEqual({ ok: true, version: "dev" });
});

test("first visit sets the password, then sign-in needs it and the rest needs a session", async () => {
  const cookies: string[] = [];
  const browser = appRouter.createCaller({ token: null, ip: "test", setCookie: (cookie) => cookies.push(cookie) });
  await browser.auth.setup({ password: "correct horse" });
  await expect(browser.auth.setup({ password: "someone else" })).rejects.toThrow("already set");
  await expect(browser.auth.login({ password: "wrong password" })).rejects.toThrow("Wrong password");
  await browser.auth.login({ password: " correct horse\n" });
  expect(cookies.at(-1)).toMatch(/^lanscape_session=[\w-]+;/);
  await expect(caller().devices.list()).rejects.toThrow("Sign in first");
});

test("deleting a device takes its history with it", async () => {
  await prisma.device.create({
    data: { mac: "aa:bb:cc:dd:ee:ff", ip: "192.168.0.50", lastSeen: new Date(), events: { create: [{ at: new Date(), online: true }] } },
  });
  await (await signedIn()).devices.delete({ mac: "aa:bb:cc:dd:ee:ff" });
  expect(await prisma.deviceEvent.count()).toBe(0);
});

test("editing a rule starts its alert state over", async () => {
  const api = await signedIn();
  const input = { metric: "download", direction: "below", mode: "fixed", value: 100, sustainMinutes: 0, enabled: true } as const;
  const rule = await api.notifications.saveRule(input);
  await prisma.notificationRule.update({ where: { id: rule.id }, data: { alerting: true, pendingSince: new Date() } });
  const edited = await api.notifications.saveRule({ ...input, id: rule.id, value: 200 });
  expect(edited).toMatchObject({ value: 200, alerting: false, pendingSince: null });
});

test("alert switches: new devices, outages and new ports on by default, each can be switched", async () => {
  const api = await signedIn();
  expect(await api.notifications.deviceAlerts()).toEqual({ newDevice: true, unknownBack: false, outage: true, portOpened: true, portClosed: false });
  await api.notifications.setDeviceAlert({ alert: "outage", on: false });
  await api.notifications.setDeviceAlert({ alert: "unknownBack", on: true });
  await api.notifications.setDeviceAlert({ alert: "portClosed", on: true });
  expect(await api.notifications.deviceAlerts()).toEqual({ newDevice: true, unknownBack: true, outage: false, portOpened: true, portClosed: true });
});

test("tells Umbrel apart from plain Docker with a preset password", async () => {
  process.env.APP_PASSWORD = "from-compose-file";
  expect(await caller().auth.status()).toMatchObject({ onUmbrel: false, presetPassword: true });
  process.env.UMBREL = "true";
  expect(await caller().auth.status()).toMatchObject({ onUmbrel: true, presetPassword: true });
  delete process.env.APP_PASSWORD;
  delete process.env.UMBREL;
  expect(await caller().auth.status()).toMatchObject({ onUmbrel: false, presetPassword: false });
});
