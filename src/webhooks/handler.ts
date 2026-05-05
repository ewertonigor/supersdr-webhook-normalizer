import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import { registry } from "../providers/index.js";
import { insertReceived } from "../repositories/webhook-events.js";

/**
 * Stage 1 of webhook handling: durable receipt.
 *
 * We DELIBERATELY do not normalize / classify here. The endpoint must:
 *   1. Validate the URL slug points to a known provider
 *   2. Persist the raw payload (audit + replay)
 *   3. Acknowledge with 200 in <50ms
 *
 * The async processor picks it up, validates the schema, normalizes via the
 * adapter, and persists the canonical message. This is the standard
 * "acknowledge first, process async" pattern (Stripe / Shopify / Slack).
 *
 * Why? Webhook senders retry aggressively on non-2xx; doing slow work in-band
 * causes timeouts and duplicate retries. Even our 8s OpenAI call would be
 * unacceptable here.
 */
export type ReceiveOutcome =
  | { ok: true; eventId: string }
  | { ok: false; status: number; error: string };

export async function receiveWebhook(args: {
  db: Db;
  log: FastifyBaseLogger;
  providerSlug: string;
  payload: unknown;
  headers: Record<string, string>;
}): Promise<ReceiveOutcome> {
  const { db, log, providerSlug, payload, headers } = args;

  if (!registry.has(providerSlug)) {
    log.warn({ providerSlug }, "unknown provider slug");
    return { ok: false, status: 404, error: `Unknown provider "${providerSlug}"` };
  }

  if (payload === null || typeof payload !== "object") {
    return { ok: false, status: 400, error: "Webhook body must be a JSON object" };
  }

  const event = await insertReceived(db, {
    providerId: providerSlug,
    rawPayload: payload,
    headers,
  });

  log.info({ eventId: event.id, providerSlug }, "webhook received");
  return { ok: true, eventId: event.id };
}
