import { expect, test } from "vitest";
import { parseTraceroute, type Step, verdict } from "./diagnostics";

test("reads traceroute hops, including silent ones", () => {
  const stdout = `traceroute to 1.1.1.1 (1.1.1.1), 15 hops max, 60 byte packets
 1  192.168.0.1  0.512 ms
 2  *
 3  1.1.1.1  9.870 ms`;
  expect(parseTraceroute(stdout)).toEqual([
    { hop: 1, address: "192.168.0.1", ms: 0.512 },
    { hop: 2, address: null, ms: null },
    { hop: 3, address: "1.1.1.1", ms: 9.87 },
  ]);
});

test("the verdict names the first broken link", () => {
  const steps = (results: Record<string, boolean | null>): Step[] => Object.entries(results).map(([key, ok]) => ({ key, label: key, ok, summary: "" }));
  const all = { network: true, router: true, internet: true, dns: true, "dns-public": true, https: true, route: true };
  expect(verdict(steps(all))).toMatch(/^Everything looks fine/);
  expect(verdict(steps({ ...all, router: false, internet: false }))).toMatch(/inside your home network/);
  expect(verdict(steps({ ...all, internet: false }))).toMatch(/past your router/);
  expect(verdict(steps({ ...all, dns: false }))).toMatch(/your DNS server isn't answering/);
  expect(verdict(steps({ ...all, https: false }))).toMatch(/secure web pages don't load/);
  // A route that stops answering midway is common and not a problem on its own
  expect(verdict(steps({ ...all, route: null }))).toMatch(/^Everything looks fine/);
});
