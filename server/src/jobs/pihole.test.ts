import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { prisma } from "../db";
import { pauseDevice, pausedUntil, resumeDevice, resumeDuePauses, summarizeQueries, toClients } from "./pihole";

test("reads Pi-hole's device list: real MACs only, IPv4, short names", () => {
  // Shapes as Pi-hole 2026.10 returns them from /api/network/devices
  const clients = toClients([
    { hwaddr: "00:00:00:00:00:00", lastQuery: 1793422686, numQueries: 4, ips: [{ ip: "127.0.0.1", name: "localhost", lastSeen: 1793422740 }] },
    { hwaddr: "ip-192.168.0.9", lastQuery: 0, numQueries: 0, ips: [{ ip: "192.168.0.9", name: null, lastSeen: 1793422740 }] },
    {
      hwaddr: "F6:05:92:59:47:7E",
      lastQuery: 1793422686,
      numQueries: 120,
      ips: [
        { ip: "fe80::1", name: "xps.lan", lastSeen: 1793422750 },
        { ip: "192.168.0.20", name: null, lastSeen: 1793420000 },
        { ip: "192.168.0.74", name: "xps.lan", lastSeen: 1793422740 },
      ],
    },
    { hwaddr: "aa:bb:cc:dd:ee:01", lastQuery: 0, numQueries: 0, ips: [{ ip: "192.168.0.30", name: null, lastSeen: 1 }] },
  ]);
  expect(clients).toEqual([
    { mac: "f6:05:92:59:47:7e", ip: "192.168.0.74", name: "xps", lastQuery: new Date(1793422686 * 1000), queries: 120 },
    { mac: "aa:bb:cc:dd:ee:01", ip: "192.168.0.30", name: null, lastQuery: null, queries: 0 },
  ]);
});

test("summarizes a device's DNS requests: blocked share and top domains", () => {
  const query = (domain: string, status: string) => ({ domain, status, time: 0 });
  const summary = summarizeQueries([
    query("a2.tuyaus.com", "FORWARDED"),
    query("a2.tuyaus.com", "CACHE"),
    query("ads.example", "GRAVITY"),
    query("track.example", "REGEX_CNAME"),
    query("a2.tuyaus.com", "CACHE"),
  ]);
  expect(summary.sampled).toBe(5);
  expect(summary.blocked).toBe(2);
  expect(summary.topDomains[0]).toEqual({ domain: "a2.tuyaus.com", count: 3 });
});

// A stand-in for the parts of Pi-hole's API that pausing uses, holding its groups, regex rules and clients in memory
const fakePihole = async () => {
  const state = {
    groups: [{ id: 0, name: "Default" }] as { id: number; name: string }[],
    regex: [] as { domain: string; groups: number[] }[],
    clients: new Map<string, { client: string; groups: number[]; comment: string | null }>(),
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (status: number, json?: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(json === undefined ? "" : JSON.stringify(json));
      const url = decodeURIComponent(request.url ?? "");
      if (url === "/api/auth") return send(200, { session: { valid: true, sid: "sid", validity: 300 } });
      if (url === "/api/groups" && request.method === "GET") return send(200, { groups: state.groups });
      if (url === "/api/groups") return state.groups.push({ id: state.groups.length, name: body.name }), send(201, {});
      if (url === "/api/domains/deny/regex" && request.method === "GET") return send(200, { domains: state.regex });
      if (url === "/api/domains/deny/regex") return state.regex.push({ domain: body.domain, groups: body.groups }), send(201, {});
      if (url === "/api/clients") return state.clients.set(body.client, { client: body.client, groups: body.groups, comment: body.comment }), send(201, {});
      const client = url.match(/^\/api\/clients\/(.+)$/)?.[1];
      if (client && request.method === "GET") return state.clients.has(client) ? send(200, { clients: [state.clients.get(client)] }) : send(404, { error: { message: "Not found" } });
      if (client && request.method === "PUT") return state.clients.set(client, { client, groups: body.groups, comment: body.comment }), send(200, {});
      if (client && request.method === "DELETE") return state.clients.delete(client), send(204);
      send(404);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await prisma.setting.createMany({ data: [{ key: "pihole.url", value: url }, { key: "pihole.password", value: "app-password" }] });
  return { state, close: () => new Promise<void>((done) => server.close(() => done())) };
};

test("pausing puts the device in a block-everything group, and resuming puts it back as it was", async () => {
  const pihole = await fakePihole();
  await prisma.device.createMany({
    data: [
      { mac: "aa:bb:cc:dd:ee:10", ip: "192.168.0.10", lastSeen: new Date() },
      { mac: "aa:bb:cc:dd:ee:11", ip: "192.168.0.11", lastSeen: new Date() },
    ],
  });
  // .11 was already a Pi-hole client in the Default group, with the owner's comment
  pihole.state.clients.set("192.168.0.11", { client: "192.168.0.11", groups: [0], comment: "Kid's tablet" });

  await pauseDevice("aa:bb:cc:dd:ee:10", 2);
  await pauseDevice("aa:bb:cc:dd:ee:11", 2);
  const group = pihole.state.groups.find((entry) => entry.name === "LANscape pause")!.id;
  expect(pihole.state.regex).toEqual([{ domain: ".*", groups: [group] }]);
  expect(pihole.state.clients.get("192.168.0.10")?.groups).toEqual([group]);
  expect(pihole.state.clients.get("192.168.0.11")).toMatchObject({ groups: [group], comment: "Kid's tablet" });
  await expect(pauseDevice("aa:bb:cc:dd:ee:10", 1)).rejects.toThrow("already paused");

  await resumeDevice("aa:bb:cc:dd:ee:10");
  expect(pihole.state.clients.has("192.168.0.10")).toBe(false);
  // Overdue pauses resume on the next tick
  await resumeDuePauses(new Date(Date.now() + 3 * 60_000));
  expect(pihole.state.clients.get("192.168.0.11")).toEqual({ client: "192.168.0.11", groups: [0], comment: "Kid's tablet" });
  expect(await pausedUntil("aa:bb:cc:dd:ee:11")).toBeNull();
  await pihole.close();
});
