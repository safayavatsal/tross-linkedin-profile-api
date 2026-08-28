import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fastify, { FastifyInstance } from "fastify";
import { registerErrorHandler } from "../../src/errors/errorHandler.js";
import { ProfileNotFoundError, InvalidUrlError } from "../../src/errors/errorTypes.js";

describe("registerErrorHandler", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = fastify();
    registerErrorHandler(app);

    app.get("/throw/profile-not-found", () => {
      throw new ProfileNotFoundError();
    });
    app.get("/throw/invalid-url", () => {
      throw new InvalidUrlError();
    });
    app.get("/throw/plain-error", () => {
      throw new Error("something broke unexpectedly");
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("maps ProfileNotFoundError to a 404 with the contract error shape", async () => {
    const res = await app.inject({ method: "GET", url: "/throw/profile-not-found" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      status: "error",
      error: {
        code: "PROFILE_NOT_FOUND",
        message: "Profile could not be located",
        http_status: 404,
      },
    });
  });

  it("maps InvalidUrlError to a 400 with the contract error shape", async () => {
    const res = await app.inject({ method: "GET", url: "/throw/invalid-url" });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      status: "error",
      error: {
        code: "INVALID_URL",
        message: "URL is not a valid LinkedIn profile URL",
        http_status: 400,
      },
    });
  });

  it("falls back to a 500 INTERNAL_ERROR for a plain Error, without leaking a stack trace", async () => {
    const res = await app.inject({ method: "GET", url: "/throw/plain-error" });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body).toEqual({
      status: "error",
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected error occurred",
        http_status: 500,
      },
    });
    expect(res.body).not.toContain("at ");
    expect(res.body).not.toContain(".ts:");
  });

  it("maps an unmatched route to a 404 with the contract error shape", async () => {
    const res = await app.inject({ method: "GET", url: "/no-such-route" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      status: "error",
      error: {
        code: "NOT_FOUND",
        message: "Route GET:/no-such-route not found",
        http_status: 404,
      },
    });
  });
});
