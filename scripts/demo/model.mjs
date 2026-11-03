// A stand-in OpenAI-compatible model for the Assistant screenshot: it looks up speed tests and outages, then answers
// from what LANscape returns, so the answer matches the demo data. Nothing is sent to a real model.
//   node scripts/demo/model.mjs   ->  http://127.0.0.1:4602/v1, model "demo-model"
import { createServer } from "node:http";

const TIME_ZONE = "America/New_York";
const day = (at) => new Date(at).toLocaleDateString("en-US", { timeZone: TIME_ZONE, weekday: "long", month: "short", day: "numeric" });
const time = (at) => new Date(at).toLocaleTimeString("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
const hour = (at) => Number(new Date(at).toLocaleString("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }));
const average = (values) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

const answer = (tests, outages) => {
  const usual = average(tests.map((test) => test.downloadMbps));
  const slowest = tests.toSorted((a, b) => a.downloadMbps - b.downloadMbps)[0];
  const evening = average(tests.filter((test) => hour(test.at) >= 19).map((test) => test.downloadMbps));
  const lines = [
    `Your download averaged **${usual} Mbps** this month. Two things stood out:`,
    "",
    `- **Slowest test:** ${day(slowest.at)} at ${time(slowest.at)}, **${slowest.downloadMbps} Mbps**, about a third of normal. The tests before and after were fine, so it was a short dip.`,
    ...outages.map(
      (outage) =>
        `- **Outage:** ${day(outage.start)}, ${time(outage.start)}, for ${outage.minutes} minutes. ${
          outage.cause === "internet"
            ? "Your router kept answering, so it was **your internet provider**, not your home network."
            : "Your router stopped answering too, so it was **inside your home network**: the router or the Umbrel's connection to it."
        }`,
    ),
    "",
    `Evenings run a little slower (${evening} Mbps after 7 pm), which is normal when everyone's streaming. If the provider outages keep happening, the ISP report on the Notifications page has the dates to send them.`,
  ];
  return lines.join("\n");
};

createServer((request, response) => {
  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    if (request.url?.startsWith("/v1/models")) return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "demo-model" }] }));
    const stream = (deltas) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [delta, finish_reason] of deltas) response.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`);
      response.end("data: [DONE]\n\n");
    };
    const results = Object.fromEntries(JSON.parse(raw).messages.filter((message) => message.role === "tool").map((message) => [message.tool_call_id, JSON.parse(message.content)]));
    if (results.speed && results.outages) {
      const words = answer(results.speed, results.outages).split(/(?<= )/);
      return stream([...words.map((word) => [{ content: word }, null]), [{}, "stop"]]);
    }
    const call = (index, id, name) => ({ index, id, type: "function", function: { name, arguments: JSON.stringify({ range: "month" }) } });
    stream([[{ tool_calls: [call(0, "speed", "get_speed_history"), call(1, "outages", "get_outages")] }, null], [{}, "tool_calls"]]);
  });
}).listen(4602, "127.0.0.1");
console.log("Demo model on http://127.0.0.1:4602/v1");
