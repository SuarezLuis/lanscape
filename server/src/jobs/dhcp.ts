import { createSocket } from "node:dgram";
import { recordFailure, recordStatus } from "./status";
import { saveTraits } from "./traits";

const MAGIC = 0x63825363;

/**
 * A DHCP request from a client (op 1): its MAC, hostname (option 12), vendor class (60, like "android-dhcp-14"),
 * and the options it asks for (55), whose order fingerprints the operating system. Null for anything else.
 */
export const parseDhcpRequest = (packet: Buffer) => {
  if (packet.length < 240 || packet[0] !== 1 || packet.readUInt32BE(236) !== MAGIC) return null;
  const length = packet[2] ?? 0;
  if (length !== 6) return null;
  const mac = [...packet.subarray(28, 34)].map((byte) => byte.toString(16).padStart(2, "0")).join(":");
  const options = new Map<number, Buffer>();
  for (let at = 240; at < packet.length; ) {
    const code = packet[at]!;
    if (code === 255) break;
    if (code === 0) {
      at += 1;
      continue;
    }
    const size = packet[at + 1] ?? 0;
    options.set(code, packet.subarray(at + 2, at + 2 + size));
    at += 2 + size;
  }
  const text = (code: number) => options.get(code)?.toString("utf8").replace(/\0+$/, "").trim() || undefined;
  return {
    mac,
    hostname: text(12),
    vendor: text(60),
    fingerprint: options.has(55) ? [...options.get(55)!].join(",") : undefined,
  };
};

const STATUS = "integration.dhcp";

/**
 * Listens for DHCP requests, which clients broadcast when they join, and keeps what they say about themselves.
 * LANscape doesn't answer them; the router's DHCP server does. Needs UDP port 67, so it stays off where another
 * DHCP server runs on this machine (like Pi-hole's, when turned on) or without the rights to bind it.
 */
export const startDhcpListener = () => {
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", (message) => {
    const request = parseDhcpRequest(message);
    if (!request) return;
    void saveTraits(request.mac, { "dhcp-host": request.hostname, "dhcp-vendor": request.vendor, "dhcp-fp": request.fingerprint }).catch(
      (error: unknown) => console.error("Saving DHCP details failed:", error instanceof Error ? error.message : error),
    );
  });
  socket.on("error", (error) => {
    void recordFailure(STATUS, new Error(`Not listening for DHCP: ${error.message}`));
    socket.close();
  });
  socket.bind(67, () => void recordStatus(STATUS, { ok: true, summary: "Listening for devices joining (DHCP)" }));
};
