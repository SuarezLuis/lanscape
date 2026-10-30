import { expect, test } from "vitest";
import { parseArpScan, selfOn, vendorFor } from "./devices";

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
