import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { preparePassword, readSessionCookie, sessionValid } from "./auth";
import { BackupError, createBackup, inspectBackup, restoreBackup } from "./backup";
import { EXPORTS, isExportName } from "./export";
import { startRetention } from "./jobs/retention";
import { startScheduler } from "./jobs/scheduler";
import { startTelegramReplies } from "./jobs/telegram";
import { appRouter, type Context } from "./router";

const port = Number(process.env.PORT ?? 4545);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT must be a positive integer, got "${process.env.PORT}"`);
}

const app = Fastify({ logger: true });

await preparePassword();

await app.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: {
    router: appRouter,
    createContext: ({ req, res }: { req: FastifyRequest; res: FastifyReply }): Context => ({
      token: readSessionCookie(req.headers.cookie),
      ip: req.ip,
      setCookie: (cookie) => res.header("set-cookie", cookie),
    }),
  },
});

const signedIn = (request: FastifyRequest) => sessionValid(readSessionCookie(request.headers.cookie));

// Plain downloads, outside tRPC, behind the same session check
app.get<{ Params: { name: string } }>("/export/:name", async (request, reply) => {
  if (!(await signedIn(request))) return reply.code(401).send("Sign in first");
  const { name } = request.params;
  if (!isExportName(name)) return reply.code(404).send("Not found");
  const stamp = new Date().toISOString().slice(0, 10);
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="lanscape-${name.replace(".csv", "")}-${stamp}.csv"`)
    .send(await EXPORTS[name]());
});

// Backups: the file goes up as the raw body, the passphrase (URI-encoded, optional) in a header
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 1024 ** 3 }, (_request, body, done) => done(null, body));
const passphrase = (request: FastifyRequest) => {
  const header = request.headers["x-backup-passphrase"];
  return typeof header === "string" && header ? decodeURIComponent(header) : undefined;
};
const backupRoute =
  (handler: (request: FastifyRequest, reply: FastifyReply) => unknown) => async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await signedIn(request))) return reply.code(401).send({ error: "Sign in first" });
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof BackupError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  };

app.post(
  "/backup/export",
  backupRoute((request, reply) =>
    reply
      .header("content-type", "application/octet-stream")
      .header("content-disposition", `attachment; filename="lanscape-${new Date().toISOString().slice(0, 10)}.lanscape"`)
      .send(createBackup(passphrase(request))),
  ),
);
app.post("/backup/inspect", backupRoute((request) => inspectBackup(request.body as Buffer, passphrase(request))));
app.post("/backup/restore", backupRoute((request) => restoreBackup(request.body as Buffer, passphrase(request))));

// In dev, Vite serves the page and web/dist may not exist yet
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  // Client-side routes like /speedtests load the app shell; unknown API paths still 404
  app.setNotFoundHandler((request, reply) =>
    request.method === "GET" && !request.url.startsWith("/trpc") && !request.url.startsWith("/export") && !request.url.startsWith("/backup")
      ? reply.sendFile("index.html")
      : reply.code(404).send({ error: "Not found" }),
  );
}

await app.listen({ host: "0.0.0.0", port });
startScheduler();
startRetention();
void startTelegramReplies();
