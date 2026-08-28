import type { FastifyInstance, FastifyError } from "fastify";
import { AppError } from "./errorTypes.js";

// docs/07_API_Contract.md §3 — one JSON error shape for every endpoint.
function errorEnvelope(code: string, message: string, httpStatus: number) {
  return {
    status: "error" as const,
    error: { code, message, http_status: httpStatus },
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.httpStatus).send(errorEnvelope(error.code, error.message, error.httpStatus));
      return;
    }

    // @fastify/rate-limit sets statusCode 429; reuse the client-facing envelope
    // rather than the plugin's own shape, so every endpoint returns one format.
    if (error.statusCode === 429) {
      reply
        .code(429)
        .send(errorEnvelope("UPSTREAM_RATE_LIMITED", error.message || "Too many requests, retry later", 429));
      return;
    }

    // Fastify's built-in JSON-schema body validation (missing/wrong-typed linkedin_url).
    if (error.validation) {
      reply.code(400).send(errorEnvelope("INVALID_URL", "URL is not a valid LinkedIn profile URL", 400));
      return;
    }

    request.log.error(error);
    reply.code(500).send(errorEnvelope("INTERNAL_ERROR", "Unexpected error occurred", 500));
  });

  // Unmatched routes (e.g. GET /) bypass setErrorHandler entirely — Fastify
  // routes them here instead, so they need the same envelope applied separately.
  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(errorEnvelope("NOT_FOUND", `Route ${request.method}:${request.url} not found`, 404));
  });
}
