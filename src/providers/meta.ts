import { z } from "zod";
import { err, ok } from "../lib/result.js";
import { registry } from "./registry.js";
import {
  AdapterError,
  type MessageType,
  type NormalizedMessage,
  type ProviderAdapter,
} from "./types.js";

/**
 * Meta WhatsApp Cloud API webhook adapter.
 *
 * Payload reference:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 *
 * Strategy:
 *  - Validate top-level shape with Zod
 *  - Walk entry[0].changes[0].value.messages[0]
 *  - Pull contact display name from value.contacts (matched by wa_id)
 *
 * Limitations:
 *  - Only handles ONE message per webhook (Meta can batch up to 100). For this
 *    assessment, batched payloads return the FIRST message; in production
 *    we would loop and emit N normalized events.
 *  - Status updates (sent/delivered/read) and template events are ignored.
 */

const MetaTextMessage = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.literal("text"),
  text: z.object({ body: z.string() }),
});

const MetaMediaMessage = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(["image", "audio", "video", "document"]),
  // Each media type has its own object with id/mime_type/sha256/caption?.
  // We keep it loose since we only use caption.
  image: z.object({ caption: z.string().optional() }).passthrough().optional(),
  audio: z.object({ caption: z.string().optional() }).passthrough().optional(),
  video: z.object({ caption: z.string().optional() }).passthrough().optional(),
  document: z.object({ caption: z.string().optional() }).passthrough().optional(),
});

const MetaLocationMessage = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.literal("location"),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
});

const MetaMessage = z.union([MetaTextMessage, MetaMediaMessage, MetaLocationMessage]);

const MetaContact = z.object({
  profile: z.object({ name: z.string().optional() }).optional(),
  wa_id: z.string(),
});

const MetaWebhook = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z
                .object({
                  messaging_product: z.literal("whatsapp").optional(),
                  metadata: z.object({}).passthrough().optional(),
                  contacts: z.array(MetaContact).optional(),
                  messages: z.array(MetaMessage).optional(),
                })
                .passthrough(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

class MetaAdapter implements ProviderAdapter {
  readonly id = "meta";
  readonly name = "Meta WhatsApp Cloud API";

  canHandle(payload: unknown): boolean {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "object" in payload &&
      (payload as { object: unknown }).object === "whatsapp_business_account"
    );
  }

  normalize(payload: unknown) {
    const parsed = MetaWebhook.safeParse(payload);
    if (!parsed.success) {
      return err(
        new AdapterError("schema_invalid", "Meta webhook does not match expected shape", parsed.error.flatten()),
      );
    }

    const change = parsed.data.entry[0]!.changes[0]!;
    const value = change.value;

    if (change.field !== "messages" || !value.messages || value.messages.length === 0) {
      return err(new AdapterError("unknown_event", `Meta event "${change.field}" is not a message`));
    }

    const m = value.messages[0]!;

    let messageType: MessageType;
    let content: string | undefined;

    switch (m.type) {
      case "text":
        messageType = "text";
        content = m.text.body;
        break;
      case "image":
      case "audio":
      case "video":
      case "document":
        messageType = m.type;
        content = m[m.type]?.caption;
        break;
      case "location":
        messageType = "location";
        content = [m.location.name, m.location.address].filter(Boolean).join(" — ") || undefined;
        break;
    }

    const contactInfo = value.contacts?.find((c) => c.wa_id === m.from);

    const normalized: NormalizedMessage = {
      providerId: this.id,
      externalId: m.id,
      contact: {
        externalId: m.from,
        displayName: contactInfo?.profile?.name,
        phoneNumber: m.from, // wa_id is already E.164 without the leading +
      },
      direction: "inbound",
      messageType,
      content,
      occurredAt: new Date(Number(m.timestamp) * 1000),
      rawPayload: payload,
    };

    return ok(normalized);
  }
}

registry.register(new MetaAdapter());
