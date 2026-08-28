import type { FastifyReply, FastifyRequest } from "fastify";
import { normalizeLinkedInUrl } from "../../validation/linkedinUrl.validator.js";
import { getProfile } from "../../services/profileService.js";
import type { ProfileSuccessResponse } from "../../types/profile.types.js";

export async function handleGetProfile(
  request: FastifyRequest<{ Body: { linkedin_url: string } }>,
  reply: FastifyReply,
): Promise<ProfileSuccessResponse> {
  const normalizedUrl = normalizeLinkedInUrl(request.body.linkedin_url);
  const { data, source } = await getProfile(normalizedUrl);

  reply.code(200);
  return {
    status: "success",
    data,
    meta: {
      source,
      fetched_at: new Date().toISOString(),
    },
  };
}
