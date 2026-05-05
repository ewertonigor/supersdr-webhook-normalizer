import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Catalog of integrated providers. Seeded once.
 * The `id` here matches the URL slug (POST /webhooks/:provider).
 */
export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A WhatsApp contact, scoped per provider.
 * Same person on Meta vs Z-API is two rows — they use different external ids.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    phoneNumber: text("phone_number"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerExternalIdx: uniqueIndex("contacts_provider_external_id_idx").on(t.providerId, t.externalId),
    phoneIdx: index("contacts_phone_idx").on(t.phoneNumber),
  }),
);

/**
 * Source of truth for normalized inbound/outbound messages.
 * Idempotency: UNIQUE(provider_id, external_id).
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(), // 'inbound' | 'outbound'
    messageType: text("message_type").notNull(), // 'text' | 'image' | 'audio' | 'video' | 'document' | 'location'
    content: text("content"),
    rawPayload: jsonb("raw_payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    intent: text("intent"),
    intentConfidence: numeric("intent_confidence"),
    intentClassifiedAt: timestamp("intent_classified_at", { withTimezone: true }),
  },
  (t) => ({
    providerExternalIdx: uniqueIndex("messages_provider_external_id_idx").on(t.providerId, t.externalId),
    contactOccurredIdx: index("messages_contact_occurred_at_idx").on(t.contactId, t.occurredAt),
  }),
);

/**
 * Inbox of every webhook ever received — even malformed ones.
 *
 * Why we keep this:
 *  - audit trail (regulatory + debugging)
 *  - replay (if a bug hides in an adapter, we can re-process)
 *  - DLQ (status='dead_letter' after 3 failures)
 *
 * Status lifecycle: received → processing → normalized | failed → dead_letter
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: text("provider_id"), // null when provider is unknown
    status: text("status").notNull().default("received"),
    rawPayload: jsonb("raw_payload").notNull(),
    headers: jsonb("headers").notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    // Partial index used by the worker to fetch the next pending batch.
    pendingIdx: index("webhook_events_status_received_idx").on(t.status, t.receivedAt),
  }),
);

// ----- inferred types (single source of truth) -----
export type Provider = typeof providers.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
