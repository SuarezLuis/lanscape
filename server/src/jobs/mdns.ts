import makeMdns from "multicast-dns";

const LISTEN_MS = 3000;
const SERVICES = "_services._dns-sd._udp.local";

const stripLocal = (name: string) => name.replace(/\.local\.?$/, "");
const reverseName = (ip: string) => `${ip.split(".").reverse().join(".")}.in-addr.arpa`;

// Cast devices put a friendly name ("Kitchen speaker") in their TXT record as fn=
const friendlyName = (txt: unknown) => {
  const entries = (Array.isArray(txt) ? txt : [txt]).map((entry) => String(entry));
  return entries.find((entry) => entry.startsWith("fn="))?.slice(3) || null;
};

/**
 * Asks the LAN over mDNS for names: every advertised service (printers, speakers, TVs) and a reverse
 * lookup per IP. Friendly service names win over hostnames.
 */
export const discoverNames = (ips: string[]) =>
  new Promise<Map<string, string>>((resolve) => {
    const mdns = makeMdns({ reuseAddr: true });
    const askedTypes = new Set<string>();
    const hostIp = new Map<string, string>();
    const instanceHost = new Map<string, string>();
    const instanceName = new Map<string, string>();
    const hostnames = new Map<string, string>();

    mdns.on("response", (packet) => {
      for (const record of [...packet.answers, ...(packet.additionals ?? [])]) {
        if (record.type === "A") hostIp.set(record.name, record.data);
        if (record.type === "SRV") instanceHost.set(record.name, record.data.target);
        if (record.type === "TXT") {
          const fn = friendlyName(record.data);
          if (fn) instanceName.set(record.name, fn);
        }
        if (record.type !== "PTR") continue;
        if (record.name === SERVICES && !askedTypes.has(record.data)) {
          askedTypes.add(record.data);
          mdns.query({ questions: [{ name: record.data, type: "PTR" }] });
        } else if (record.name.endsWith(".in-addr.arpa")) {
          const ip = record.name.replace(".in-addr.arpa", "").split(".").reverse().join(".");
          hostnames.set(ip, stripLocal(record.data));
        } else if (!instanceName.has(record.data)) {
          instanceName.set(record.data, record.data.split("._")[0] ?? record.data);
        }
      }
    });
    mdns.on("error", () => {});

    mdns.query({ questions: [{ name: SERVICES, type: "PTR" }] });
    mdns.query({ questions: ips.map((ip) => ({ name: reverseName(ip), type: "PTR" as const })) });
    // Some devices answer a service without its address; ask for those hosts once more
    setTimeout(() => {
      const missing = [...new Set(instanceHost.values())].filter((host) => !hostIp.has(host));
      if (missing.length) mdns.query({ questions: missing.map((name) => ({ name, type: "A" as const })) });
    }, LISTEN_MS / 2);

    setTimeout(() => {
      mdns.destroy();
      const names = new Map(hostnames);
      for (const [instance, host] of instanceHost) {
        const ip = hostIp.get(host);
        const name = instanceName.get(instance) ?? instance.split("._")[0];
        if (ip && name) names.set(ip, name);
      }
      resolve(names);
    }, LISTEN_MS);
  });
