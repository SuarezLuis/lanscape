import { execFile } from "node:child_process";
import { getServers, lookup, Resolver } from "node:dns/promises";
import { promisify } from "node:util";
import { selfOn } from "./devices";
import { findDefaultRoute, internetHost, ping } from "./ping";

const execFileAsync = promisify(execFile);

/**
 * A guided check of the path from this machine to the internet, run on demand: interface, router, DNS, internet,
 * HTTPS, then a traceroute. Nothing is stored; the page can copy or download the result as a report.
 */

export type Step = { key: string; label: string; ok: boolean | null; summary: string; detail?: string };

const NAME = "example.com";
// A page that answers 204 and nothing else, used by browsers and phones for the same check
const HTTPS_CHECK = "https://www.gstatic.com/generate_204";

const timed = async <T>(run: () => Promise<T>) => {
  const start = performance.now();
  const value = await run();
  return { value, ms: Math.round(performance.now() - start) };
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const pingStep = async (key: string, label: string, host: string): Promise<Step> => {
  try {
    const result = await ping(host);
    const loss = result.sent ? Math.round((100 * (result.sent - result.received)) / result.sent) : 100;
    if (result.received === 0) return { key, label, ok: false, summary: `${host} didn't answer (${result.sent} pings lost)` };
    return { key, label, ok: loss < 20, summary: `${host}: ${result.avgMs?.toFixed(1)} ms average, ${loss}% lost` };
  } catch (error) {
    return { key, label, ok: false, summary: `Couldn't ping ${host}: ${message(error)}` };
  }
};

// " 3  108.90.4.1  5.044 ms" or " 4  *" from traceroute -n -q 1
export const parseTraceroute = (stdout: string) =>
  stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\S+)(?:\s+([\d.]+) ms)?/.exec(line))
    .filter((match) => match !== null)
    .map(([, hop = "", address = "", ms]) => ({ hop: Number(hop), address: address === "*" ? null : address, ms: ms ? Number(ms) : null }));

const traceroute = async (host: string): Promise<Step> => {
  const label = "Route to the internet";
  try {
    // -n: no name lookups; one probe a hop, 1 s each, at most 15 hops
    const { stdout } = await execFileAsync("traceroute", ["-n", "-q", "1", "-w", "1", "-m", "15", host], { timeout: 30_000 }).catch(
      (error: { stdout?: string }) => (error.stdout ? { stdout: error.stdout } : Promise.reject(error)),
    );
    const hops = parseTraceroute(stdout);
    const reached = hops.some((hop) => hop.address === host);
    const detail = hops.map((hop) => `${String(hop.hop).padStart(2)}  ${hop.address ?? "*"}${hop.ms === null ? "" : `  ${hop.ms} ms`}`).join("\n");
    const firstSilent = hops.find((hop) => hop.address === null);
    return {
      key: "route",
      label,
      ok: reached ? true : null,
      summary: reached
        ? `${host} reached in ${hops.length} hops`
        : `${host} not reached within ${hops.length} hops${firstSilent ? `; hop ${firstSilent.hop} onward didn't answer (often just routers that ignore traceroute)` : ""}`,
      detail,
    };
  } catch (error) {
    return { key: "route", label, ok: null, summary: `Traceroute didn't run: ${message(error)}` };
  }
};

const resolveWith = async (server: string | null) => {
  if (!server) return (await lookup(NAME)).address;
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  resolver.setServers([server]);
  const [address] = await resolver.resolve4(NAME);
  return address;
};

const dnsStep = async (key: string, label: string, server: string | null): Promise<Step> => {
  try {
    const { value, ms } = await timed(() => resolveWith(server));
    return { key, label, ok: true, summary: `${NAME} → ${value} in ${ms} ms` };
  } catch (error) {
    return { key, label, ok: false, summary: `Couldn't look up ${NAME}: ${message(error)}` };
  }
};

const httpsStep = async (): Promise<Step> => {
  const label = "Secure web (HTTPS)";
  try {
    const { value: response, ms } = await timed(() => fetch(HTTPS_CHECK, { signal: AbortSignal.timeout(8000) }));
    return { key: "https", label, ok: response.status === 204, summary: `${new URL(HTTPS_CHECK).host} answered ${response.status} in ${ms} ms` };
  } catch (error) {
    return { key: "https", label, ok: false, summary: `Couldn't load ${new URL(HTTPS_CHECK).host}: ${message(error)}` };
  }
};

// One plain-language line from the steps: the first broken link in the chain is where to look
export const verdict = (steps: Step[]) => {
  const ok = (key: string) => steps.find((step) => step.key === key)?.ok;
  if (ok("network") === false) return "This machine has no network route. Check its cable or Wi-Fi.";
  if (ok("router") === false) return "Your router isn't answering. The problem is inside your home network: the router, or this machine's connection to it.";
  if (ok("internet") === false && ok("router")) return "Your router answers but the internet doesn't. The problem is past your router: the modem or your internet provider.";
  if (ok("dns") === false && ok("dns-public")) return "The internet works, but your DNS server isn't answering. Names fail to load while addresses work; check the DNS server your router or Pi-hole uses.";
  if (ok("dns") === false || ok("dns-public") === false) return "Name lookups are failing. Check your DNS settings.";
  if (ok("https") === false) return "The internet answers, but secure web pages don't load. A firewall or filter may be blocking them.";
  if (steps.some((step) => step.ok === false)) return "Mostly fine, but one check had trouble; see below.";
  return "Everything looks fine from here: router, internet, DNS and secure web all work.";
};

export const runDiagnostics = async () => {
  const steps: Step[] = [];
  const route = await findDefaultRoute();
  const self = route ? selfOn(route.iface) : null;
  steps.push(
    route
      ? { key: "network", label: "This machine", ok: true, summary: `${self?.ip ?? "no IPv4 address"} on ${route.iface}, router ${route.gateway}` }
      : { key: "network", label: "This machine", ok: process.platform === "linux" ? false : null, summary: process.platform === "linux" ? "No default route" : "Only checked on Linux" },
  );
  if (route) steps.push(await pingStep("router", "Router", route.gateway));
  const host = await internetHost();
  steps.push(await pingStep("internet", "Internet (by address)", host));
  const servers = getServers();
  steps.push(await dnsStep("dns", `DNS (your server${servers.length ? `: ${servers.join(", ")}` : ""})`, null));
  steps.push(await dnsStep("dns-public", "DNS (1.1.1.1, for comparison)", "1.1.1.1"));
  steps.push(await httpsStep());
  steps.push(await traceroute(host));
  return { at: new Date(), verdict: verdict(steps), steps };
};
