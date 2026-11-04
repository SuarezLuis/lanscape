import type { TraitMap } from "./traits";

// A best guess at what a device is, from what LANscape already knows about it. Each clue votes for a kind of device
// with a weight; the kind with the most weight wins, and the clues behind it are shown so the guess can be checked
export type Clues = {
  vendor: string | null;
  hostname: string | null;
  traits: TraitMap | undefined;
  ports: number[];
  domains: string[];
};

type Vote = { kind: string; weight: number; reason: string };

const PORT_KINDS: [number[], string][] = [
  [[8009], "Google Cast device (Chromecast, Google TV or a Nest speaker)"],
  [[62078], "iPhone or iPad"],
  [[1400], "Sonos speaker"],
  [[9100, 631, 515], "Printer"],
  [[554, 8554], "Camera"],
  [[3389], "Windows PC"],
  [[548], "Mac or NAS"],
  [[5000, 5001], "NAS"],
  [[7000], "AirPlay device (Apple TV, HomePod or a Mac)"],
  [[8754, 30005, 30003, 8504], "Flight tracking receiver (ADS-B)"],
];

const HOSTNAME_KINDS: [RegExp, string][] = [
  [/iphone/i, "iPhone or iPad"],
  [/ipad/i, "iPhone or iPad"],
  [/android|galaxy|pixel/i, "Android phone or tablet"],
  [/^(desktop|laptop)-/i, "Windows PC"],
  [/macbook|imac|mac-?mini|mac-?studio/i, "Mac"],
  [/roku/i, "Roku"],
  [/umbrel|nas|server/i, "Home server"],
  [/echo|alexa|kindle|fire-?tv/i, "Amazon device (Echo, Fire TV or Kindle)"],
  [/xbox/i, "Xbox"],
  [/playstation|ps[45]/i, "PlayStation"],
  [/printer|epson|brother|canon/i, "Printer"],
];

const DHCP_KINDS: [RegExp, string][] = [
  [/^android-dhcp/i, "Android phone or tablet"],
  [/^MSFT/i, "Windows PC"],
];

const VENDOR_KINDS: [RegExp, string][] = [
  [/espressif/i, "Smart-home gadget (plug, bulb or sensor)"],
  [/tuya/i, "Smart-home gadget (plug, bulb or sensor)"],
  [/amazon/i, "Amazon device (Echo, Fire TV or Kindle)"],
  [/roku/i, "Roku"],
  [/sonos/i, "Sonos speaker"],
  [/nintendo/i, "Nintendo Switch"],
  [/sony interactive/i, "PlayStation"],
  [/raspberry pi/i, "Raspberry Pi"],
  [/ubiquiti/i, "UniFi network gear"],
  [/signify|philips lighting/i, "Philips Hue"],
  [/nest labs/i, "Nest thermostat, camera or speaker"],
  [/ecobee/i, "Ecobee thermostat"],
  [/ring llc/i, "Ring doorbell or camera"],
  [/wyze/i, "Camera"],
  [/seiko epson|brother industries|canon/i, "Printer"],
  [/synology|qnap/i, "NAS"],
  [/apple/i, "Apple device"],
  [/private address/i, "Phone, tablet or laptop using a private Wi-Fi address"],
];

const DOMAIN_KINDS: [RegExp, string][] = [
  [/(^|\.)roku\.com$/, "Roku"],
  [/alexa|device-metrics-us\.amazon\.com$/, "Amazon device (Echo, Fire TV or Kindle)"],
  [/xboxlive\.com$/, "Xbox"],
  [/playstation\.(net|com)$|sonyentertainmentnetwork\.com$/, "PlayStation"],
  [/nintendo\.net$/, "Nintendo Switch"],
  [/tuya(us|eu|cn)?\.com$/, "Smart-home gadget (plug, bulb or sensor)"],
  [/(^|\.)ring\.com$/, "Ring doorbell or camera"],
  [/meethue\.com$/, "Philips Hue"],
  [/nest\.com$/, "Nest thermostat, camera or speaker"],
  [/sonos\.com$/, "Sonos speaker"],
  [/samsungcloud(solution)?\.(com|net)$|samsungotn\.net$/, "Samsung TV or phone"],
  [/lgtvsdp\.com$|lgsmartad\.com$/, "LG TV"],
  [/hpeprint\.com$|smart\.hp\.com$/, "Printer"],
  [/ecobee\.com$/, "Ecobee thermostat"],
  [/wyze(cam)?\.com$/, "Camera"],
];

// Apps that mean the device is a home server (Umbrel, a NAS, a mini PC), named in the reason
const SERVER_APPS: [number, string][] = [
  [8123, "Home Assistant"],
  [32400, "Plex"],
  [4545, "LANscape"],
  [8096, "Jellyfin"],
  [9000, "Portainer"],
];

export const guessDevice = ({ vendor, hostname, traits, ports, domains }: Clues) => {
  // A device that names its own model needs no guess
  if (traits?.model) return null;
  const votes: Vote[] = [];
  for (const [list, kind] of PORT_KINDS) {
    const open = list.filter((port) => ports.includes(port));
    if (open.length) votes.push({ kind, weight: 3, reason: `port ${open.join(", ")} is open` });
  }
  const apps = SERVER_APPS.filter(([port]) => ports.includes(port));
  if (apps.length) votes.push({ kind: "Home server", weight: 3, reason: `it runs ${apps.map(([port, app]) => `${app} (port ${port})`).join(", ")}` });
  for (const [pattern, kind] of DOMAIN_KINDS) {
    const asked = domains.find((domain) => pattern.test(domain));
    if (asked) votes.push({ kind, weight: 3, reason: `it looks up ${asked}` });
  }
  for (const [pattern, kind] of HOSTNAME_KINDS) if (hostname && pattern.test(hostname)) votes.push({ kind, weight: 2, reason: `its name is ${hostname}` });
  const dhcp = traits?.["dhcp-vendor"];
  for (const [pattern, kind] of DHCP_KINDS) if (dhcp && pattern.test(dhcp)) votes.push({ kind, weight: 2, reason: `it joins as ${dhcp}` });
  for (const [pattern, kind] of VENDOR_KINDS) if (vendor && pattern.test(vendor)) votes.push({ kind, weight: 1, reason: `its maker is ${vendor}` });
  if (votes.length === 0) return null;
  const totals = new Map<string, number>();
  for (const vote of votes) totals.set(vote.kind, (totals.get(vote.kind) ?? 0) + vote.weight);
  const [kind] = [...totals].toSorted((a, b) => b[1] - a[1])[0]!;
  return { kind, reasons: votes.filter((vote) => vote.kind === kind).map((vote) => vote.reason) };
};
