import { eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { messages, type Message } from "../db/schema.js";
import type { NormalizedMessage } from "../providers/types.js";

/**
 * Insert a normalized message. UNIQUE(provider_id, external_id) gives us
 * DB-level idempotency — a duplicate webhook returns the existing row.
 *
 * Returns { row, inserted } so callers know whether to skip downstream work
 * like LLM classification.
 */
export async function insertIdempotent(
  db: Db,
  args: { contactId: string; normalized: NormalizedMessage },
): Promise<{ row: Message; inserted: boolean }> {
  const { contactId, normalized: m } = args;

  const inserted = await db
    .insert(messages)
    .values({
      providerId: m.providerId,
      externalId: m.externalId,
      contactId,
      direction: m.direction,
      messageType: m.messageType,
      content: m.content,
      rawPayload: m.rawPayload as object,
      occurredAt: m.occurredAt,
    })
    .onConflictDoNothing({ target: [messages.providerId, messages.externalId] })
    .returning();

  if (inserted[0]) return { row: inserted[0], inserted: true };

  // Conflict — fetch the existing row.
  const [existing] = await db
    .select()
    .from(messages)
    .where(sql`provider_id = ${m.providerId} AND external_id = ${m.externalId}`)
    .limit(1);
  if (!existing) throw new Error("insert returned no row and lookup found nothing");
  return { row: existing, inserted: false };
}

export async function setIntent(
  db: Db,
  args: { id: string; intent: string; confidence: number },
): Promise<void> {
  await db
    .update(messages)
    .set({
      intent: args.intent,
      intentConfidence: String(args.confidence),
      intentClassifiedAt: new Date(),
    })
    .where(eq(messages.id, args.id));
}

export async function findUnclassified(db: Db, limit = 20): Promise<Message[]> {
  return db.select().from(messages).where(isNull(messages.intentClassifiedAt)).limit(limit);
}
