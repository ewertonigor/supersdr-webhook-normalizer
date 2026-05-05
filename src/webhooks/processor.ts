import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import { type WebhookEvent } from "../db/schema.js";
import { classifyIntent } from "../llm/intent-classifier.js";
import { registry } from "../providers/index.js";
import type { NormalizedMessage } from "../providers/types.js";
import { upsertContact } from "../repositories/contacts.js";
import { insertIdempotent, setIntent } from "../repositories/messages.js";
import {
  claimPendingBatch,
  markFailed,
  markNormalized,
} from "../repositories/webhook-events.js";
import { sleep } from "../lib/retry.js";

/**
 * Background worker that drains webhook_events.
 *
 * Loop: every `pollIntervalMs`, claim up to `batchSize` rows in a single
 * SELECT ... FOR UPDATE SKIP LOCKED transaction (so we'd be safe even if we
 * scaled this to N workers later).
 *
 * For each event:
 *  1. Resolve the adapter from the URL slug (provider_id) — defense-in-depth
 *     check against registry.detect() if the slug is missing.
 *  2. Adapter normalizes (Result<>) — schema_invalid / unknown_event errors
 *     are NOT retried (they're permanent). They go straight to dead_letter.
 *  3. Persist contact + message idempotently.
 *  4. Mark event as 'normalized'.
 *  5. Best-effort intent classification (LLM) — failure here doesn't roll back
 *     the message; intent_classified_at stays null and a separate batch can
 *     retry later if needed.
 *
 * Transient infra errors (DB blip, LLM timeout) flow into markFailed which
 * promotes to 'dead_letter' once attempts >= deadLetterAfter.
 */
export type ProcessorConfig = {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
};

export class WebhookProcessor {
  private running = false;
  private cancellation: { cancelled: boolean } = { cancelled: false };

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
    private readonly config: ProcessorConfig,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.cancellation = { cancelled: false };
    this.log.info({ ...this.config }, "webhook processor started");
    void this.loop();
  }

  async stop(): Promise<void> {
    this.cancellation.cancelled = true;
    this.running = false;
    this.log.info("webhook processor stopped");
  }

  private async loop(): Promise<void> {
    while (!this.cancellation.cancelled) {
      try {
        const events = await claimPendingBatch(this.db, this.config.batchSize);
        if (events.length === 0) {
          await sleep(this.config.pollIntervalMs);
          continue;
        }
        await Promise.all(events.map((e) => this.processOne(e)));
      } catch (err) {
        this.log.error({ err }, "processor loop error — backing off");
        await sleep(this.config.pollIntervalMs);
      }
    }
  }

  private async processOne(event: WebhookEvent): Promise<void> {
    const log = this.log.child({ eventId: event.id, providerId: event.providerId });

    // Resolve adapter — slug first, then payload sniffing.
    const adapter =
      (event.providerId ? registry.resolve(event.providerId) : undefined) ??
      registry.detect(event.rawPayload);

    if (!adapter) {
      log.warn("no adapter could handle event — dead_letter");
      await markFailed(this.db, {
        id: event.id,
        error: "no adapter could handle the event",
        deadLetterAfter: 1, // permanent failure, dead-letter on first attempt
      });
      return;
    }

    const normalized = adapter.normalize(event.rawPayload);
    if (!normalized.ok) {
      const isPermanent =
        normalized.error.code === "schema_invalid" ||
        normalized.error.code === "unsupported_message_type" ||
        normalized.error.code === "unknown_event" ||
        normalized.error.code === "outbound_message_ignored";

      log[isPermanent ? "warn" : "error"](
        { code: normalized.error.code, msg: normalized.error.message },
        "normalization failed",
      );
      await markFailed(this.db, {
        id: event.id,
        error: `${normalized.error.code}: ${normalized.error.message}`,
        deadLetterAfter: isPermanent ? 1 : this.config.maxAttempts,
      });
      return;
    }

    try {
      const msg = await this.persistAndClassify(normalized.value, log);
      await markNormalized(this.db, { id: event.id, messageId: msg.id });
      log.info({ messageId: msg.id }, "event normalized");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = await markFailed(this.db, {
        id: event.id,
        error: message,
        deadLetterAfter: this.config.maxAttempts,
      });
      log.error({ err, status }, "transient failure, will retry");
    }
  }

  private async persistAndClassify(
    n: NormalizedMessage,
    log: FastifyBaseLogger,
  ): Promise<{ id: string }> {
    const contact = await upsertContact(this.db, { providerId: n.providerId, contact: n.contact });
    const { row, inserted } = await insertIdempotent(this.db, { contactId: contact.id, normalized: n });

    // Skip duplicate intent classification if we already had this message.
    if (!inserted || n.direction === "outbound" || !n.content) {
      return row;
    }

    // Classification is best-effort — never fails the whole pipeline.
    try {
      const intent = await classifyIntent({ content: n.content });
      await setIntent(this.db, { id: row.id, intent: intent.label, confidence: intent.confidence });
    } catch (err) {
      log.warn({ err }, "intent classification failed (will leave intent null)");
    }

    return row;
  }
}
