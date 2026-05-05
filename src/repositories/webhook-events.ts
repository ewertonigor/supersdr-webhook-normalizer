import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { webhookEvents, type WebhookEvent } from "../db/schema.js";

/**
 * Inserts a raw webhook with status='received'. Always succeeds (no idempotency
 * key on this table — the webhook_events tracks every HTTP attempt for audit).
 */
export async function insertReceived(
  db: Db,
  args: { providerId: string | null; rawPayload: unknown; headers: Record<string, string> },
): Promise<WebhookEvent> {
  const [row] = await db
    .insert(webhookEvents)
    .values({
      providerId: args.providerId,
      rawPayload: args.rawPayload as object,
      headers: args.headers,
      status: "received",
    })
    .returning();
  if (!row) throw new Error("failed to insert webhook_event");
  return row;
}

/**
 * Atomically claim up to `batchSize` events for processing.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED so multiple workers wouldn't double-claim
 * (defensive — we currently run a single worker, but safe to scale up).
 */
export async function claimPendingBatch(db: Db, batchSize: number): Promise<WebhookEvent[]> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<WebhookEvent>(sql`
      SELECT * FROM webhook_events
      WHERE status IN ('received', 'failed')
      ORDER BY received_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);
    if (rows.rows.length === 0) return [];

    const ids = rows.rows.map((r) => r.id);
    await tx
      .update(webhookEvents)
      .set({ status: "processing", attempts: sql`${webhookEvents.attempts} + 1` })
      .where(sql`id = ANY(${ids})`);

    return rows.rows;
  });
}

export async function markNormalized(
  db: Db,
  args: { id: string; messageId: string },
): Promise<void> {
  await db
    .update(webhookEvents)
    .set({ status: "normalized", messageId: args.messageId, processedAt: new Date(), error: null })
    .where(eq(webhookEvents.id, args.id));
}

export async function markFailed(
  db: Db,
  args: { id: string; error: string; deadLetterAfter: number },
): Promise<"failed" | "dead_letter"> {
  // Promote to dead_letter if the next attempt would exceed the cap.
  const result = await db
    .update(webhookEvents)
    .set({
      status: sql`CASE WHEN attempts >= ${args.deadLetterAfter} THEN 'dead_letter' ELSE 'failed' END`,
      error: args.error,
      processedAt: new Date(),
    })
    .where(eq(webhookEvents.id, args.id))
    .returning({ status: webhookEvents.status });
  return (result[0]?.status as "failed" | "dead_letter") ?? "failed";
}

export async function countByStatus(db: Db): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: webhookEvents.status, count: sql<number>`count(*)::int` })
    .from(webhookEvents)
    .groupBy(webhookEvents.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}
