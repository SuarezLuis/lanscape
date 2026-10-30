import { expect, test } from "vitest";
import { parseSpeedtestOutput } from "./speedtest";

const realRun = JSON.stringify({
  timestamp: "2026-10-30 17:02:40.743",
  user_info: { IP: "192.0.2.1", Lat: "0", Lon: "0", Isp: "Example ISP", Country: "US" },
  servers: [
    {
      url: "https://server-68863.prod.hosts.ooklaserver.net:8080/speedtest/upload.php",
      name: "San Antonio, TX",
      country: "United States",
      sponsor: "AT&T",
      id: "68863",
      distance: 141.45940721423543,
      latency: 19358460,
      max_latency: 22336774,
      min_latency: 18660696,
      jitter: 1083398,
      dl_speed: 82129190.93628523,
      ul_speed: 109613647.65883735,
      cc: "US",
    },
  ],
});

test("converts speedtest-go units to Mbps and ms", () => {
  const result = parseSpeedtestOutput(realRun);

  expect(result.downloadMbps).toBeCloseTo(657.03, 2);
  expect(result.uploadMbps).toBeCloseTo(876.91, 2);
  expect(result.pingMs).toBeCloseTo(19.36, 2);
  expect(result.jitterMs).toBeCloseTo(1.08, 2);
  expect(result).toMatchObject({
    serverId: "68863",
    serverName: "San Antonio, TX",
    serverSponsor: "AT&T",
    serverDistanceKm: 141.45940721423543,
  });
});

test("rejects output with no server results", () => {
  expect(() => parseSpeedtestOutput('{"servers":[]}')).toThrow("no server results");
});

test("rejects output missing a measurement", () => {
  expect(() => parseSpeedtestOutput('{"servers":[{"id":"1","name":"x","sponsor":"y","distance":1}]}')).toThrow();
});
