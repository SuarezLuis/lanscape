import makeMdns from "multicast-dns";

const LISTEN_MS = 5000;
const SERVICES = "_services._dns-sd._udp.local";
// Asked for directly too: some devices never answer the "list your services" query
const COMMON_SERVICES = [
  "_googlecast._tcp.local",
  "_airplay._tcp.local",
  "_raop._tcp.local",
  "_companion-link._tcp.local",
  "_hap._tcp.local",
  "_ipp._tcp.local",
  "_printer._tcp.local",
  "_sonos._tcp.local",
  "_spotify-connect._tcp.local",
  "_workstation._tcp.local",
  "_smb._tcp.local",
  "_device-info._tcp.local",
];

const GROUP = { port: 5353, address: "224.0.0.251" };

const stripLocal = (name: string) => name.replace(/\.local\.?$/, "");
const reverseName = (ip: string) => `${ip.split(".").reverse().join(".")}.in-addr.arpa`;

// Cast devices put a friendly name ("Kitchen speaker") in their TXT record as fn=
const friendlyName = (txt: unknown) => {
  const entries = (Array.isArray(txt) ? txt : [txt]).map((entry) => String(entry));
  return entries.find((entry) => entry.startsWith("fn="))?.slice(3) || null;
};

// Instance names are sometimes IDs ("96e837ebcc9c8cd8") or carry the MAC ("pi2 [d8:3a:dd:..]")
export const cleanName = (raw: string) => {
  const name = raw.replace(/\s*\[([\da-f]{2}:){5}[\da-f]{2}\]$/i, "").trim();
  const looksLikeId = /^[\da-f]{12,}$/i.test(name) || (/^[A-Za-z\d]{12,}$/.test(name) && /\d/.test(name) && /[A-Z]/.test(name) && /[a-z]/.test(name));
  return name && !looksLikeId ? name : null;
};

// A display name beats a service instance name, which beats a bare hostname
const RANK = { friendly: 3, instance: 2, hostname: 1 };

/**
 * Asks the LAN over mDNS for names: advertised services (speakers, TVs, printers) and a reverse lookup per IP.
 */
export const discoverNames = (ips: string[]) =>
  new Promise<Map<string, string>>((resolve) => {
    // Two sockets: the shared 5353 one hears answers sent to the group, but the host's own mDNS daemon (avahi on
    // Umbrel) also holds 5353; querying from a random port makes devices answer us directly instead
    const sockets = [makeMdns({ reuseAddr: true }), makeMdns({ port: 0, multicast: false })] as const;
    const ask = (questions: { name: string; type: "PTR" | "A" }[]) => {
      sockets[0].query({ questions });
      sockets[1].query({ questions }, GROUP);
    };
    const askedTypes = new Set<string>(COMMON_SERVICES);
    const hostIp = new Map<string, string>();
    const instanceHost = new Map<string, string>();
    const friendly = new Map<string, string>();
    const instances = new Set<string>();
    const hostnames = new Map<string, string>();

    const onResponse = (packet: makeMdns.ResponsePacket) => {
      for (const record of [...packet.answers, ...(packet.additionals ?? [])]) {
        if (record.type === "A") hostIp.set(record.name, record.data);
        if (record.type === "SRV") instanceHost.set(record.name, record.data.target);
        if (record.type === "TXT") {
          const fn = friendlyName(record.data);
          if (fn) friendly.set(record.name, fn);
        }
        if (record.type !== "PTR") continue;
        if (record.name === SERVICES) {
          if (askedTypes.has(record.data)) continue;
          askedTypes.add(record.data);
          ask([{ name: record.data, type: "PTR" }]);
        } else if (record.name.endsWith(".in-addr.arpa")) {
          const ip = record.name.replace(".in-addr.arpa", "").split(".").reverse().join(".");
          hostnames.set(ip, stripLocal(record.data));
        } else {
          instances.add(record.data);
        }
      }
    };
    for (const socket of sockets) {
      socket.on("response", onResponse);
      socket.on("error", () => {});
    }

    ask([{ name: SERVICES, type: "PTR" }, ...COMMON_SERVICES.map((name) => ({ name, type: "PTR" as const }))]);
    ask(ips.map((ip) => ({ name: reverseName(ip), type: "PTR" as const })));
    // Some devices answer a service without its address; ask for those hosts once more
    setTimeout(() => {
      const missing = [...new Set(instanceHost.values())].filter((host) => !hostIp.has(host));
      if (missing.length) ask(missing.map((name) => ({ name, type: "A" as const })));
    }, LISTEN_MS / 2);

    setTimeout(() => {
      for (const socket of sockets) socket.destroy();
      const best = new Map<string, { name: string; rank: number }>();
      const offer = (ip: string | undefined, raw: string | undefined, rank: number) => {
        const name = raw && cleanName(raw);
        if (ip && name && rank > (best.get(ip)?.rank ?? 0)) best.set(ip, { name, rank });
      };
      for (const [ip, hostname] of hostnames) offer(ip, hostname, RANK.hostname);
      for (const instance of new Set([...instances, ...instanceHost.keys()])) {
        const host = instanceHost.get(instance);
        const ip = host ? hostIp.get(host) : undefined;
        offer(ip, instance.split("._")[0], RANK.instance);
        offer(ip, friendly.get(instance), RANK.friendly);
        if (host) offer(ip, stripLocal(host), RANK.hostname);
      }
      resolve(new Map([...best].map(([ip, { name }]) => [ip, name])));
    }, LISTEN_MS);
  });
