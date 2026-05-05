import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { contacts, type Contact } from "../db/schema.js";
import type { NormalizedContact } from "../providers/types.js";

/**
 * Idempotent upsert by (provider_id, external_id). If the row exists we just
 * refresh display_name / phone_number with the latest webhook payload.
 *
 * Returns the persisted row (id is needed by the messages repository).
 */
export async function upsertContact(
  db: Db,
  args: { providerId: string; contact: NormalizedContact },
): Promise<Contact> {
  const { providerId, contact } = args;

  const [row] = await db
    .insert(contacts)
    .values({
      providerId,
      externalId: contact.externalId,
      displayName: contact.displayName,
      phoneNumber: contact.phoneNumber,
    })
    .onConflictDoUpdate({
      target: [contacts.providerId, contacts.externalId],
      set: {
        // Only overwrite when we received a non-null value — keep older data otherwise.
        displayName: sql`COALESCE(EXCLUDED.display_name, ${contacts.displayName})`,
        phoneNumber: sql`COALESCE(EXCLUDED.phone_number, ${contacts.phoneNumber})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!row) throw new Error("upsertContact failed");
  return row;
}
