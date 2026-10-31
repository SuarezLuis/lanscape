import { expect, test } from "vitest";
import { summarizeQueries, toClients } from "./pihole";

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
