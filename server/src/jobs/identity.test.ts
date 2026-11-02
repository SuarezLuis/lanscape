import { expect, test } from "vitest";
import { prisma } from "../db";
import { parseDhcpRequest } from "./dhcp";
import { txtTraits } from "./mdns";
import { parseDescription, parseSsdpReply } from "./ssdp";
import { readTraits, saveTraits } from "./traits";

// A DHCPDISCOVER as a phone sends it: hostname, vendor class, and the options it asks for
const discover = () => {
  const packet = Buffer.alloc(300);
  packet[0] = 1; // request
  packet[1] = 1; // Ethernet
  packet[2] = 6; // MAC length
  Buffer.from([0xda, 0x12, 0x34, 0x56, 0x78, 0x9a]).copy(packet, 28);
  packet.writeUInt32BE(0x63825363, 236);
  const options = [53, 1, 1, 12, 9, ...Buffer.from("Pixel-8-a"), 60, 15, ...Buffer.from("android-dhcp-14"), 55, 4, 1, 3, 6, 15, 255];
  Buffer.from(options).copy(packet, 240);
  return packet;
};

test("reads a DHCP request: MAC, hostname, vendor class and fingerprint", () => {
  expect(parseDhcpRequest(discover())).toEqual({ mac: "da:12:34:56:78:9a", hostname: "Pixel-8-a", vendor: "android-dhcp-14", fingerprint: "1,3,6,15" });
  const reply = discover();
  reply[0] = 2;
  expect(parseDhcpRequest(reply)).toBeNull();
  expect(parseDhcpRequest(Buffer.alloc(100))).toBeNull();
});

test("reads stable IDs and models from mDNS TXT records", () => {
  expect(txtTraits("Living Room._googlecast._tcp.local", ["id=4f2e9a1b", "fn=Living Room", "md=Google Nest Mini"])).toEqual({ cast: "4f2e9a1b" });
  expect(txtTraits("Den._airplay._tcp.local", ["deviceid=AA:BB:CC:DD:EE:FF", "model=AudioAccessory5,1"])).toEqual({ airplay: "aa:bb:cc:dd:ee:ff", model: "AudioAccessory5,1" });
  expect(txtTraits("Studio._device-info._tcp.local", ["model=MacBookPro18,3"])).toEqual({ model: "MacBookPro18,3" });
  expect(txtTraits("Lamp._hap._tcp.local", ["id=1A:2B:3C:4D:5E:6F", "md=Lamp"])).toEqual({ hap: "1a:2b:3c:4d:5e:6f" });
});

test("reads SSDP replies and device descriptions", () => {
  const reply = "HTTP/1.1 200 OK\r\nUSN: uuid:4d696e69-444c-164e-9d41-001e06ff3b45::upnp:rootdevice\r\nLOCATION: http://192.168.0.20:8060/\r\n\r\n";
  expect(parseSsdpReply(reply)).toEqual({ uuid: "4d696e69-444c-164e-9d41-001e06ff3b45", location: "http://192.168.0.20:8060/" });
  expect(parseSsdpReply("HTTP/1.1 200 OK\r\n\r\n")).toBeNull();
  const xml = "<root><device><friendlyName>Living Room TV</friendlyName><manufacturer>Roku</manufacturer><modelName>Ultra</modelName></device></root>";
  expect(parseDescription(xml)).toEqual({ name: "Living Room TV", model: "Roku Ultra" });
});

test("traits are kept per MAC, the latest value per kind", async () => {
  await saveTraits("da:00:00:00:00:01", { cast: "abc", model: "Nest Mini" });
  await saveTraits("da:00:00:00:00:01", { model: "Nest Mini (2nd gen)", "dhcp-host": undefined });
  expect((await readTraits(["da:00:00:00:00:01", "da:00:00:00:00:02"])).get("da:00:00:00:00:01")).toEqual({ cast: "abc", model: "Nest Mini (2nd gen)" });
  expect(await prisma.macTrait.count()).toBe(2);
});
