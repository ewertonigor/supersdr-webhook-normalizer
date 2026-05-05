import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { findById, listRecent, stats } from "../repositories/messages.js";

/**
 * Read endpoints for normalized messages.
 *
 * These are NOT part of the webhook ingestion pipeline. Their purpose is to
 * give visibility into the result of the pipeline:
 *  - Inspecting normalized messages from any provider in a single canonical shape
 *  - Showing the LLM intent + confidence classified asynchronously
 *  - Powering the demo / video walkthrough without needing psql access
 *
 * In a real product, downstream consumers (CRM UI, analytics jobs, ML training)
 * would read directly from the database. These routes mirror what those queries
 * would look like.
 */

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  provider: z.enum(["meta", "evolution", "zapi"]).optional(),
  intent: z.string().optional(),
});

const IdParams = z.object({
  id: z.string().uuid(),
});

export async function messageRoutes(app: FastifyInstance) {
  const db = getDb();

  // List recent normalized messages (with the contact info joined in).
  app.get("/messages", async (request, reply) => {
    const parsed = ListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", issues: parsed.error.flatten() });
    }

    const rows = await listRecent(db, {
      limit: parsed.data.limit,
      providerId: parsed.data.provider,
      intent: parsed.data.intent,
    });

    // Trim raw_payload from the list response — it can be large. /messages/:id
    // returns the full payload for callers that need it.
    return {
      count: rows.length,
      items: rows.map((row) => ({
        id: row.id,
        provider_id: row.providerId,
        external_id: row.externalId,
        contact: {
          id: row.contactId,
          display_name: row.contactDisplayName,
          phone_number: row.contactPhoneNumber,
        },
        direction: row.direction,
        message_type: row.messageType,
        content: row.content,
        intent: row.intent,
        intent_confidence: row.intentConfidence !== null ? Number(row.intentConfidence) : null,
        intent_classified_at: row.intentClassifiedAt,
        occurred_at: row.occurredAt,
        received_at: row.receivedAt,
      })),
    };
  });

  // Aggregated stats — useful for /metrics-style dashboards.
  app.get("/messages/stats", async () => {
    return stats(db);
  });

  // Single message detail (includes raw_payload for debugging).
  app.get("/messages/:id", async (request, reply) => {
    const parsed = IdParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "id must be a valid UUID" });
    }

    const row = await findById(db, parsed.data.id);
    if (!row) return reply.code(404).send({ error: "Message not found" });

    return {
      id: row.id,
      provider_id: row.providerId,
      external_id: row.externalId,
      contact: {
        id: row.contactId,
        display_name: row.contactDisplayName,
        phone_number: row.contactPhoneNumber,
      },
      direction: row.direction,
      message_type: row.messageType,
      content: row.content,
      intent: row.intent,
      intent_confidence: row.intentConfidence !== null ? Number(row.intentConfidence) : null,
      intent_classified_at: row.intentClassifiedAt,
      occurred_at: row.occurredAt,
      received_at: row.receivedAt,
      raw_payload: row.rawPayload,
    };
  });
}
