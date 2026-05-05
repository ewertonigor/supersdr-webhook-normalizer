import type { Result } from "../lib/result.js";

/**
 * Internal canonical message shape.
 * Every adapter MUST produce this regardless of the provider format.
 *
 * Design notes:
 *  - `providerId` + `externalId` form the natural key (idempotency).
 *  - `rawPayload` is preserved for audit + future schema changes.
 *  - Optional fields are truly optional — keep them undefined, do not coerce
 *    to empty strings (the LLM serializer skips undefined keys cleanly).
 */
export type MessageDirection = "inbound" | "outbound";

export type MessageType = "text" | "image" | "audio" | "video" | "document" | "location";

export type NormalizedContact = {
  externalId: string;
  displayName?: string;
  phoneNumber?: string;
};

export type NormalizedMessage = {
  providerId: string;
  externalId: string;
  contact: NormalizedContact;
  direction: MessageDirection;
  messageType: MessageType;
  content?: string;
  occurredAt: Date;
  rawPayload: unknown;
};

/**
 * Errors an adapter can produce while normalizing.
 * `code` enables structured handling upstream (e.g. unsupported types are
 * acknowledged but not retried; malformed payloads are stored for replay).
 */
export type AdapterErrorCode =
  | "schema_invalid"
  | "unsupported_message_type"
  | "missing_message"
  | "outbound_message_ignored"
  | "unknown_event";

export class AdapterError extends Error {
  constructor(
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/**
 * Provider adapters implement this contract.
 *
 * `canHandle` is used in addition to URL routing as a defense-in-depth check —
 * if the URL says /webhooks/meta but the body is clearly an Evolution payload,
 * the registry can detect that and 422 instead of corrupting data.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  /**
   * Cheap structural check — should NOT throw, should NOT do heavy work.
   * Used to confirm the URL provider matches the payload.
   */
  canHandle(payload: unknown): boolean;
  /**
   * Full schema validation + normalization. Returns Result<NormalizedMessage>.
   * Implementations should NEVER throw — wrap any library that does.
   */
  normalize(payload: unknown): Result<NormalizedMessage, AdapterError>;
}
