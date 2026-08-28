import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const html = readFileSync(join(process.cwd(), "public", "index.html"), "utf8");

export async function uiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    reply.type("text/html").send(html);
  });
}
