import { expect, test } from "vitest";
import { inSubnet, matchNewAddresses, onlineAlertDue, recentlyActive, newDeviceAlert, offlineStep, parseArpScan, selfOn, unknownBackAlert, vendorFor } from "./devices";

test("keeps one row per MAC from arp-scan output", () => {
  const stdout = [
    "192.168.0.1\t00:11:22:33:44:55\tSome Router Co.",
    "192.168.0.20\tB8:27:EB:00:00:01\tRaspberry Pi Foundation",
    "192.168.0.20\tb8:27:eb:00:00:01\tRaspberry Pi Foundation (DUP: 2)",
    "",
  ].join("\n");
  expect(parseArpScan(stdout)).toEqual([
    { ip: "192.168.0.1", mac: "00:11:22:33:44:55" },
    { ip: "192.168.0.20", mac: "b8:27:eb:00:00:01" },
  ]);
});

test("names makers from the OUI list, and flags private MACs", () => {
  expect(vendorFor("24:dc:c3:00:00:01")).toBe("Espressif Inc.");
  expect(vendorFor("da:a1:19:00:00:01")).toBe("Private address");
});

test("drops ID-like mDNS names and trailing MACs", async () => {
  const { cleanName } = await import("./mdns");
  expect(cleanName("pi2 [d8:3a:dd:31:a5:46]")).toBe("pi2");
  expect(cleanName("96e837ebcc9c8cd8")).toBeNull();
  expect(cleanName("IzVRNzj8n14AAA")).toBeNull();
  expect(cleanName("Rachio-958438")).toBe("Rachio-958438");
  expect(cleanName("Play Room TV")).toBe("Play Room TV");
});

test("finds this machine on the scanned interface", () => {
  const interfaces = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true, mac: "00:00:00:00:00:00", netmask: "255.0.0.0", cidr: null }],
    eno1: [
      { address: "fe80::1", family: "IPv6", internal: false, mac: "AA:BB:CC:00:00:01", netmask: "ffff::", cidr: null, scopeid: 2 },
      { address: "192.168.0.50", family: "IPv4", internal: false, mac: "AA:BB:CC:00:00:01", netmask: "255.255.255.0", cidr: null },
    ],
  } as const;
  expect(selfOn("eno1", interfaces as never)).toEqual({ ip: "192.168.0.50", mac: "aa:bb:cc:00:00:01" });
  expect(selfOn("wlan0", interfaces as never)).toBeNull();
});

test("offline alerts wait for the chosen time, then report the return once", () => {
  const lastSeen = new Date("2026-10-30T12:00:00Z");
  const at = (minutes: number) => new Date(lastSeen.getTime() + minutes * 60_000);
  const watched = { alertOfflineMinutes: 10, offlineAlerted: false, lastSeen };
  expect(offlineStep(watched, false, at(5))).toBeNull();
  expect(offlineStep(watched, false, at(10))).toBe("offline");
  expect(offlineStep({ ...watched, offlineAlerted: true }, false, at(15))).toBeNull();
  expect(offlineStep({ ...watched, offlineAlerted: true }, true, at(20))).toBe("back");
  expect(offlineStep({ ...watched, alertOfflineMinutes: null }, false, at(60))).toBeNull();
});

test("one alert per scan, however many devices joined", () => {
  const laptop = { ip: "192.168.0.74", mac: "aa:bb:cc:dd:ee:ff", label: "Intel Corporate" };
  expect(newDeviceAlert([laptop])).toEqual({ title: "New device", message: "Intel Corporate at 192.168.0.74 (aa:bb:cc:dd:ee:ff) joined your network." });
  const { title, message } = newDeviceAlert([laptop, { ...laptop, ip: "192.168.0.75", label: "Phone" }]);
  expect(title).toBe("2 new devices");
  expect(message.split("\n")).toHaveLength(3);
});

test("a phone on a new private address is the same phone when its name matches exactly one missing device", () => {
  const existing = [
    { mac: "fa:16:92:00:00:01", hostname: "Luis’s MacBook Pro", traits: {} },
    { mac: "8e:19:91:00:00:02", hostname: "Android", traits: {} },
    { mac: "92:00:00:00:00:03", hostname: "Android", traits: {} },
    { mac: "b8:27:eb:00:00:04", hostname: "pi2", traits: {} },
  ];
  const found = (mac: string, name: string | undefined) => ({ mac, name, traits: {} });
  expect(matchNewAddresses([found("a2:00:00:00:00:09", "Luis’s MacBook Pro")], existing)).toEqual(new Map([["a2:00:00:00:00:09", "fa:16:92:00:00:01"]]));
  // Two devices with that name: can't tell which
  expect(matchNewAddresses([found("a2:00:00:00:00:09", "Android")], existing).size).toBe(0);
  // The old address is answering too, so it's a second device
  expect(matchNewAddresses([found("a2:00:00:00:00:09", "Luis’s MacBook Pro"), found("fa:16:92:00:00:01", "Luis’s MacBook Pro")], existing).size).toBe(0);
  // No name, a maker-assigned MAC, or a maker-assigned old device: no guessing
  expect(matchNewAddresses([found("a2:00:00:00:00:09", undefined)], existing).size).toBe(0);
  expect(matchNewAddresses([found("b8:27:eb:00:00:09", "pi2")], existing).size).toBe(0);
});

test("stable IDs and DHCP fingerprints tell devices apart that names can't", () => {
  const android = { "dhcp-host": "Android", "dhcp-fp": "1,3,6,15,26,28,51,58,59,43,114" };
  const existing = [
    { mac: "8e:19:91:00:00:02", hostname: "Android", traits: { ...android, "dhcp-fp": "1,3,6,15,26,28,51,58,59,43" } },
    { mac: "92:00:00:00:00:03", hostname: "Android", traits: android },
    { mac: "da:00:00:00:00:04", hostname: null, traits: { cast: "4f2e9a" } },
    { mac: "de:00:00:00:00:05", hostname: "Living Room", traits: { cast: "77aa01" } },
  ];
  // Same name as two phones, but only one has this phone's DHCP fingerprint
  expect(matchNewAddresses([{ mac: "a2:00:00:00:00:09", name: "Android", traits: android }], existing)).toEqual(new Map([["a2:00:00:00:00:09", "92:00:00:00:00:03"]]));
  // A Cast id finds the device even with no name at all
  expect(matchNewAddresses([{ mac: "a6:00:00:00:00:0a", name: undefined, traits: { cast: "4f2e9a" } }], existing)).toEqual(new Map([["a6:00:00:00:00:0a", "da:00:00:00:00:04"]]));
  // Same name, different Cast id: a different speaker, never a match
  expect(matchNewAddresses([{ mac: "aa:00:00:00:00:0b", name: "Living Room", traits: { cast: "99ff00" } }], existing).size).toBe(0);
});

test("unknown devices back after a while come as one alert", () => {
  const phone = { ip: "192.168.0.80", mac: "aa:bb:cc:dd:ee:01", label: "Galaxy" };
  expect(unknownBackAlert([phone]).title).toBe("Unknown device is back");
  expect(unknownBackAlert([phone]).message).toContain("Mark it as known");
  expect(unknownBackAlert([phone, { ...phone, label: "Tablet" }]).title).toBe("2 unknown devices are back");
});

test("alerts on arrival only for watched devices back after the chosen time away", () => {
  const now = new Date("2026-10-31T18:00:00Z");
  const previousScan = new Date("2026-10-31T17:55:00Z");
  const phone = { mac: "aa", ip: "192.168.0.80", vendor: null, hostname: null, name: "Alex's phone", firstSeen: now, known: true, alertOfflineMinutes: null, offlineAlerted: false, alertOnlineMinutes: 30, portsScannedAt: null };
  const awayFor = (minutes: number) => ({ ...phone, lastSeen: new Date(now.getTime() - minutes * 60_000) });
  expect(onlineAlertDue(awayFor(45), previousScan, now)).toBe(true);
  expect(onlineAlertDue(awayFor(10), previousScan, now)).toBe(false); // dozed for a couple of scans
  expect(onlineAlertDue({ ...awayFor(45), alertOnlineMinutes: null }, previousScan, now)).toBe(false);
  expect(onlineAlertDue({ ...phone, lastSeen: previousScan }, previousScan, now)).toBe(false); // was already online
});

test("counts recent Pi-hole requests from LAN addresses as a sign of life", () => {
  expect(inSubnet("192.168.0.74", "192.168.0.101/24")).toBe(true);
  expect(inSubnet("192.168.1.74", "192.168.0.101/24")).toBe(false);
  expect(inSubnet("172.17.0.5", "192.168.0.101/24")).toBe(false);
  expect(inSubnet("10.0.200.1", "10.0.0.5/16")).toBe(true);

  const now = new Date("2026-10-31T18:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const client = (mac: string, ip: string, lastQuery: Date | null) => ({ mac, ip, name: null, lastQuery, queries: 1 });
  const active = recentlyActive(
    [
      client("aa:00:00:00:00:01", "192.168.0.50", ago(2)), // dozed through the sweep
      client("aa:00:00:00:00:02", "192.168.0.51", ago(2)), // answered the sweep already
      client("aa:00:00:00:00:03", "192.168.0.52", ago(30)), // quiet for a while
      client("aa:00:00:00:00:04", "172.17.0.5", ago(1)), // a Docker container
      client("aa:00:00:00:00:05", "192.168.0.53", null),
    ],
    new Set(["aa:00:00:00:00:02"]),
    "192.168.0.101/24",
    now,
  );
  expect(active).toEqual([{ ip: "192.168.0.50", mac: "aa:00:00:00:00:01" }]);
});
