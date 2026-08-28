import fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "../config/index.js";
import { registerErrorHandler } from "../errors/errorHandler.js";
import { healthRoutes } from "./routes/health.routes.js";
import { profileRoutes } from "./routes/profile.routes.js";
import { uiRoutes } from "./routes/ui.routes.js";
// Side-effect import: starts the BullMQ worker in-process alongside the API
// (docs/03_Architecture.md §3 — single container runs API + worker together).
import "../queue/worker.js";

export async function buildServer() {
  const app = fastify({ logger: { level: config.logLevel } });

  registerErrorHandler(app);

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
  });

  await app.register(healthRoutes);
  await app.register(profileRoutes);
  await app.register(uiRoutes);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  app.listen({ port: config.port, host: config.host }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`Server listening at ${address}`);
  });
}
