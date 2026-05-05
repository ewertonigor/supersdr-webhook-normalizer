import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { contacts, messages, type Message } from "../db/schema.js";
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

// --- Read endpoints support ---

export type MessageWithContact = Message & {
  contactDisplayName: string | null;
  contactPhoneNumber: string | null;
};

export async function listRecent(
  db: Db,
  args: { limit: number; providerId?: string; intent?: string },
): Promise<MessageWithContact[]> {
  const conditions = [];
  if (args.providerId) conditions.push(eq(messages.providerId, args.providerId));
  if (args.intent) conditions.push(eq(messages.intent, args.intent));

  const rows = await db
    .select({
      id: messages.id,
      providerId: messages.providerId,
      externalId: messages.externalId,
      contactId: messages.contactId,
      direction: messages.direction,
      messageType: messages.messageType,
      content: messages.content,
      rawPayload: messages.rawPayload,
      occurredAt: messages.occurredAt,
      receivedAt: messages.receivedAt,
      intent: messages.intent,
      intentConfidence: messages.intentConfidence,
      intentClassifiedAt: messages.intentClassifiedAt,
      contactDisplayName: contacts.displayName,
      contactPhoneNumber: contacts.phoneNumber,
    })
    .from(messages)
    .leftJoin(contacts, eq(messages.contactId, contacts.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(messages.receivedAt))
    .limit(args.limit);

  return rows as MessageWithContact[];
}

export async function findById(db: Db, id: string): Promise<MessageWithContact | null> {
  const [row] = await db
    .select({
      id: messages.id,
      providerId: messages.providerId,
      externalId: messages.externalId,
      contactId: messages.contactId,
      direction: messages.direction,
      messageType: messages.messageType,
      content: messages.content,
      rawPayload: messages.rawPayload,
      occurredAt: messages.occurredAt,
      receivedAt: messages.receivedAt,
      intent: messages.intent,
      intentConfidence: messages.intentConfidence,
      intentClassifiedAt: messages.intentClassifiedAt,
      contactDisplayName: contacts.displayName,
      contactPhoneNumber: contacts.phoneNumber,
    })
    .from(messages)
    .leftJoin(contacts, eq(messages.contactId, contacts.id))
    .where(eq(messages.id, id))
    .limit(1);
  return (row as MessageWithContact | undefined) ?? null;
}

export type MessageStats = {
  total: number;
  classified: number;
  pending: number;
  byProvider: Array<{ providerId: string; count: number }>;
  byIntent: Array<{ intent: string; count: number; avgConfidence: number }>;
};

export async function stats(db: Db): Promise<MessageStats> {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      classified: sql<number>`count(${messages.intent})::int`,
    })
    .from(messages);

  const byProvider = await db
    .select({
      providerId: messages.providerId,
      count: sql<number>`count(*)::int`,
    })
    .from(messages)
    .groupBy(messages.providerId);

  const byIntent = await db
    .select({
      intent: sql<string>`coalesce(${messages.intent}, 'unclassified')`,
      count: sql<number>`count(*)::int`,
      avgConfidence: sql<number>`coalesce(avg(${messages.intentConfidence})::float, 0)`,
    })
    .from(messages)
    .groupBy(messages.intent);

  const total = totals?.total ?? 0;
  const classified = totals?.classified ?? 0;
  return {
    total,
    classified,
    pending: total - classified,
    byProvider,
    byIntent,
  };
}
