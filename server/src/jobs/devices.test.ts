import { expect, test } from "vitest";
import { parseArpScan, vendorFor } from "./devices";

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
