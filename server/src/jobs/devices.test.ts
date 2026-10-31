import { expect, test } from "vitest";
import { matchNewAddresses, newDeviceAlert, offlineStep, parseArpScan, selfOn, unknownBackAlert, vendorFor } from "./devices";

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
    { mac: "fa:16:92:00:00:01", hostname: "Luis’s MacBook Pro" },
    { mac: "8e:19:91:00:00:02", hostname: "Android" },
    { mac: "92:00:00:00:00:03", hostname: "Android" },
    { mac: "b8:27:eb:00:00:04", hostname: "pi2" },
  ];
  expect(matchNewAddresses([{ mac: "a2:00:00:00:00:09", name: "Luis’s MacBook Pro" }], existing)).toEqual(
    new Map([["a2:00:00:00:00:09", "fa:16:92:00:00:01"]]),
  );
  // Two devices with that name: can't tell which
  expect(matchNewAddresses([{ mac: "a2:00:00:00:00:09", name: "Android" }], existing).size).toBe(0);
  // The old address is answering too, so it's a second device
  expect(matchNewAddresses([{ mac: "a2:00:00:00:00:09", name: "Luis’s MacBook Pro" }, { mac: "fa:16:92:00:00:01", name: "Luis’s MacBook Pro" }], existing).size).toBe(0);
  // No name, a maker-assigned MAC, or a maker-assigned old device: no guessing
  expect(matchNewAddresses([{ mac: "a2:00:00:00:00:09", name: undefined }], existing).size).toBe(0);
  expect(matchNewAddresses([{ mac: "b8:27:eb:00:00:09", name: "pi2" }], existing).size).toBe(0);
});

test("unknown devices back after a while come as one alert", () => {
  const phone = { ip: "192.168.0.80", mac: "aa:bb:cc:dd:ee:01", label: "Galaxy" };
  expect(unknownBackAlert([phone]).title).toBe("Unknown device is back");
  expect(unknownBackAlert([phone]).message).toContain("Mark it as known");
  expect(unknownBackAlert([phone, { ...phone, label: "Tablet" }]).title).toBe("2 unknown devices are back");
});
