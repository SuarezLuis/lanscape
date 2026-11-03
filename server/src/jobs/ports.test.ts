import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { prisma } from "../db";
import { devicePorts, recognize, scanDevicePorts, scanHost } from "./ports";

// A Pi-hole-like admin page behind a redirect, and an SSH server that greets first
const web = createHttpServer((request, response) => {
  if (request.url === "/") return response.writeHead(302, { location: "/admin/" }).end();
  response.writeHead(200, { server: "lighttpd/1.4.76", "content-type": "text/html" }).end("<html><head><title>Pi-hole - umbrel</title></head></html>");
});
// The scan hangs up abruptly, so the server side sees resets
const ssh = createServer((socket) => socket.on("error", () => {}).end("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13\r\n"));
const listen = async (server: Server | ReturnType<typeof createHttpServer>) => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return (server.address() as AddressInfo).port;
};
let webPort = 0;
let sshPort = 0;
beforeAll(async () => {
  webPort = await listen(web);
  sshPort = await listen(ssh);
});
afterAll(() => Promise.all([web, ssh].map((server) => new Promise<void>((done) => server.close(() => done())))));

test("recognizes services from titles, server headers and banners", () => {
  expect(recognize(["Pi-hole - umbrel", "lighttpd"], null).service).toBe("Pi-hole");
  expect(recognize(["SSH-2.0-OpenSSH_9.6p1 Ubuntu"], null).service).toBe("OpenSSH 9.6p1");
  expect(recognize([null, "nginx"], "a web server (HTTP), nginx")).toEqual({ service: "a web server (HTTP), nginx", detail: "nginx" });
  expect(recognize(["Unauthorized", null, "x-plex-protocol content-type"], null).service).toBe("Plex");
});

test("finds open ports and what answers on them, following a redirect on the same device", async () => {
  const found = await scanHost("127.0.0.1", [webPort, sshPort, 1]);
  expect(found).toEqual([
    { port: webPort, service: "Pi-hole", detail: "Pi-hole - umbrel" },
    { port: sshPort, service: "OpenSSH 9.6p1", detail: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13" },
  ]);
});

test("a device's scan replaces its previous one and goes with the device", async () => {
  const mac = "aa:bb:cc:dd:ee:01";
  await prisma.device.create({ data: { mac, ip: "127.0.0.1", lastSeen: new Date() } });
  await prisma.devicePort.create({ data: { mac, port: 1, service: "old" } });
  await scanDevicePorts(mac, [webPort]);
  const saved = await devicePorts(mac);
  expect(saved.scannedAt).toBeInstanceOf(Date);
  expect(saved.ports.map((entry) => entry.port)).toEqual([webPort]);
  await prisma.device.delete({ where: { mac } });
  expect(await prisma.devicePort.count()).toBe(0);
});

test("alerts on ports opened since the previous scan, not on the first one or an empty scan", async () => {
  const mac = "aa:bb:cc:dd:ee:02";
  await prisma.device.create({ data: { mac, ip: "127.0.0.1", name: "NAS", lastSeen: new Date() } });
  await scanDevicePorts(mac, [webPort]);
  expect(await prisma.notification.count()).toBe(0);
  await scanDevicePorts(mac, [webPort, sshPort]);
  const [opened] = await prisma.notification.findMany();
  expect(opened?.message).toBe(`NAS (127.0.0.1) has a new open port: ${sshPort}: OpenSSH 9.6p1. If you didn't change anything on it, check what it is.`);
  // Asleep mid-scan: nothing answers, the list stays and nothing is sent
  await scanDevicePorts(mac, [1]);
  expect((await devicePorts(mac)).ports).toHaveLength(2);
  expect(await prisma.notification.count()).toBe(1);
});
