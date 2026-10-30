import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { appRouter } from "./router";

const port = Number(process.env.PORT ?? 4545);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT must be a positive integer, got "${process.env.PORT}"`);
}

const app = Fastify({ logger: true });

await app.register(fastifyTRPCPlugin, { prefix: "/trpc", trpcOptions: { router: appRouter } });

// In dev, Vite serves the page and web/dist may not exist yet
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // Client-side routes like /speedtests load the app shell; unknown API paths still 404
  app.setNotFoundHandler((request, reply) =>
    request.method === "GET" && !request.url.startsWith("/trpc")
      ? reply.sendFile("index.html")
      : reply.code(404).send({ error: "Not found" }),
  );
}

await app.listen({ host: "0.0.0.0", port });
