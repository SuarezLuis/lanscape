import { createSocket } from "node:dgram";

const GROUP = { address: "239.255.255.250", port: 1900 };
const LISTEN_MS = 3000;

// One reply to M-SEARCH: "USN: uuid:4d696e69-...::upnp:rootdevice", "LOCATION: http://192.168.0.20:8060/"
export const parseSsdpReply = (text: string) => {
  const header = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(text)?.[1]?.trim();
  const uuid = /uuid:([\da-f-]{8,})/i.exec(header("USN") ?? "")?.[1]?.toLowerCase();
  return uuid ? { uuid, location: header("LOCATION") ?? null } : null;
};

// The device description's <friendlyName>, <modelName> and <manufacturer>
export const parseDescription = (xml: string) => {
  const tag = (name: string) => new RegExp(`<${name}>([^<]{1,100})</${name}>`, "i").exec(xml)?.[1]?.trim() || null;
  const manufacturer = tag("manufacturer");
  const model = tag("modelName");
  return { name: tag("friendlyName"), model: model ? (manufacturer && !model.startsWith(manufacturer) ? `${manufacturer} ${model}` : model) : null };
};

/**
 * Asks UPnP devices (TVs, consoles, speakers, printers, routers) to announce themselves. Their UUID stays the same
 * across MAC changes, and their description has a friendly name and model.
 */
export const discoverSsdp = () =>
  new Promise<Map<string, { uuid: string; name: string | null; model: string | null }>>((resolve) => {
    const replies = new Map<string, { uuid: string; location: string | null }>();
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", () => {});
    socket.on("message", (message, from) => {
      const reply = parseSsdpReply(message.toString());
      // One per device; the root device's reply is as good as any
      if (reply && !replies.has(from.address)) replies.set(from.address, reply);
    });
    socket.bind(0, () => {
      const search = ["M-SEARCH * HTTP/1.1", `HOST: ${GROUP.address}:${GROUP.port}`, 'MAN: "ssdp:discover"', "MX: 2", "ST: ssdp:all", "", ""].join("\r\n");
      socket.send(search, GROUP.port, GROUP.address);
    });
    setTimeout(async () => {
      socket.close();
      const found = new Map<string, { uuid: string; name: string | null; model: string | null }>();
      await Promise.all(
        [...replies].slice(0, 40).map(async ([ip, { uuid, location }]) => {
          let described = { name: null as string | null, model: null as string | null };
          // Only from the device that answered, so a reply can't point the scan anywhere else
          if (location && URL.parse(location)?.hostname === ip) {
            described = await fetch(location, { signal: AbortSignal.timeout(2000) })
              .then(async (response) => parseDescription(await response.text()))
              .catch(() => described);
          }
          found.set(ip, { uuid, ...described });
        }),
      );
      resolve(found);
    }, LISTEN_MS);
  });
