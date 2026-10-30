import { expect, test } from "vitest";
import { defaultRoute, parsePingOutput } from "./ping";

test("reads the default gateway from /proc/net/route", () => {
  const routes = [
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
    "eno1\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
    "wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0",
    "eno1\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
  ].join("\n");
  expect(defaultRoute(routes)).toEqual({ iface: "eno1", gateway: "192.168.0.1" });
  expect(defaultRoute(routes.split("\n").slice(0, 1).join("\n"))).toBeNull();
});

test("parses Linux ping summaries, including total loss", () => {
  expect(
    parsePingOutput(
      "5 packets transmitted, 4 received, 20% packet loss, time 803ms\nrtt min/avg/max/mdev = 11.892/12.231/12.610/0.264 ms\n",
    ),
  ).toEqual({ sent: 5, received: 4, avgMs: 12.231, jitterMs: 0.264 });
  expect(parsePingOutput("5 packets transmitted, 0 received, 100% packet loss, time 4ms\n")).toEqual({
    sent: 5,
    received: 0,
    avgMs: null,
    jitterMs: null,
  });
});

test("parses macOS ping summaries", () => {
  expect(
    parsePingOutput(
      "5 packets transmitted, 5 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 9.1/10.5/12.0/1.1 ms\n",
    ),
  ).toMatchObject({ sent: 5, received: 5, avgMs: 10.5 });
});
