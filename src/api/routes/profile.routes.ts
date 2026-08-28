import type { FastifyInstance } from "fastify";
import { handleGetProfile } from "../controllers/profile.controller.js";

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/profile",
    {
      schema: {
        body: {
          type: "object",
          required: ["linkedin_url"],
          properties: {
            linkedin_url: { type: "string" },
          },
        },
      },
    },
    handleGetProfile,
  );
}
