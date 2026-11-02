import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma } from "../db";
import { advanceService, probe, runServiceCheck, serviceInput, splitHostPort } from "./services";

let server: Server;
let port = 0;
let status = 200;
beforeAll(async () => {
  server = createServer((_request, response) => response.writeHead(status).end("hi"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

test("probes HTTP and TCP for real", async () => {
  expect(await probe({ kind: "http", target: `http://127.0.0.1:${port}/`, query: null })).toMatchObject({ ok: true, detail: "HTTP 200" });
  status = 503;
  expect(await probe({ kind: "http", target: `http://127.0.0.1:${port}/`, query: null })).toMatchObject({ ok: false, ms: null, detail: "HTTP 503" });
  status = 200;
  expect(await probe({ kind: "tcp", target: `127.0.0.1:${port}`, query: null })).toMatchObject({ ok: true, detail: `Port ${port} open` });
  expect((await probe({ kind: "tcp", target: "127.0.0.1:1", query: null })).ok).toBe(false);
});

test("down after two failures in a row, up once it answers, alerting only if asked", () => {
  const start = { failures: 0, failingSince: null, alerted: false, alert: true };
  const now = new Date();
  const once = advanceService(start, false, now);
  const twice = advanceService({ ...start, ...once }, false, now);
  const back = advanceService({ ...start, ...twice }, true, now);
  expect([once.fire, twice.fire, back.fire]).toEqual([null, "down", "up"]);
  expect(advanceService({ ...start, failures: 1, alert: false }, false, now).fire).toBeNull();
});

test("checks the address for each kind", () => {
  const base = { name: "NAS", everyMinutes: 1, enabled: true, alert: true } as const;
  expect(serviceInput.safeParse({ ...base, kind: "http", target: "http://192.168.0.10:5000" }).success).toBe(true);
  expect(serviceInput.safeParse({ ...base, kind: "http", target: "192.168.0.10" }).success).toBe(false);
  expect(serviceInput.safeParse({ ...base, kind: "tcp", target: "nas.local:22" }).success).toBe(true);
  expect(serviceInput.safeParse({ ...base, kind: "tcp", target: "nas.local:99999" }).success).toBe(false);
  expect(serviceInput.safeParse({ ...base, kind: "dns", target: "192.168.0.2", query: "example.com" }).success).toBe(true);
  expect(serviceInput.safeParse({ ...base, kind: "dns", target: "pihole", query: "example.com" }).success).toBe(false);
  expect(splitHostPort("[fe80::1]:8080")).toEqual({ host: "fe80::1", port: 8080 });
});

test("a service that stops answering alerts once, then again when it's back", async () => {
  const check = await prisma.serviceCheck.create({ data: { name: "Web app", kind: "http", target: `http://127.0.0.1:${port}/` } });
  const fresh = () => prisma.serviceCheck.findUniqueOrThrow({ where: { id: check.id } });
  status = 500;
  await runServiceCheck(await fresh());
  await runServiceCheck(await fresh());
  await runServiceCheck(await fresh());
  status = 200;
  await runServiceCheck(await fresh());
  expect(await prisma.notification.findMany({ orderBy: { id: "asc" }, select: { kind: true, message: true } })).toEqual([
    { kind: "problem", message: "Web app isn't answering: HTTP 500." },
    { kind: "resolved", message: expect.stringMatching(/^Web app is answering again after 1 minute down\.$/) },
  ]);
  expect(await prisma.serviceResult.count({ where: { checkId: check.id } })).toBe(4);
});

test("an empty address gets the hint for its kind", () => {
  const result = serviceInput.safeParse({ name: "NAS", kind: "tcp", target: "", everyMinutes: 1, enabled: true, alert: true });
  expect(result.error?.issues.map((issue) => issue.message)).toEqual(["Enter host:port, like 192.168.0.10:22"]);
});
