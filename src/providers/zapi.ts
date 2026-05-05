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
 * Z-API webhook adapter (type: "ReceivedCallback" / "MessageStatusCallback").
 *
 * Payload reference: https://developer.z-api.io/webhooks/on-receive
 *
 * Notes:
 *  - `momment` is a millisecond-precision unix timestamp (Z-API typo, kept).
 *  - Different message kinds arrive under different top-level keys:
 *    `text.message`, `image`, `audio`, `video`, `document`, `location`, etc.
 */

const ZApiBaseFields = {
  instanceId: z.string().optional(),
  messageId: z.string(),
  phone: z.string(),
  fromMe: z.boolean(),
  momment: z.union([z.number(), z.string()]).optional(),
  status: z.string().optional(),
  chatName: z.string().optional(),
  senderName: z.string().optional(),
  participantPhone: z.string().nullable().optional(),
  type: z.string(),
} as const;

const ZApiWebhook = z
  .object({
    ...ZApiBaseFields,
    text: z.object({ message: z.string() }).optional(),
    image: z.object({ caption: z.string().optional() }).passthrough().optional(),
    audio: z.object({}).passthrough().optional(),
    video: z.object({ caption: z.string().optional() }).passthrough().optional(),
    document: z.object({ caption: z.string().optional(), fileName: z.string().optional() }).passthrough().optional(),
    location: z
      .object({
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

function pickContent(p: z.infer<typeof ZApiWebhook>): { type: MessageType; content?: string } {
  if (p.text?.message) return { type: "text", content: p.text.message };
  if (p.image) return { type: "image", content: p.image.caption };
  if (p.audio) return { type: "audio" };
  if (p.video) return { type: "video", content: p.video.caption };
  if (p.document) return { type: "document", content: p.document.caption ?? p.document.fileName };
  if (p.location)
    return {
      type: "location",
      content: [p.location.name, p.location.address].filter(Boolean).join(" — ") || undefined,
    };
  return { type: "text", content: undefined };
}

class ZApiAdapter implements ProviderAdapter {
  readonly id = "zapi";
  readonly name = "Z-API";

  canHandle(payload: unknown): boolean {
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return typeof p.messageId === "string" && typeof p.phone === "string" && typeof p.type === "string";
  }

  normalize(payload: unknown) {
    const parsed = ZApiWebhook.safeParse(payload);
    if (!parsed.success) {
      return err(new AdapterError("schema_invalid", "Z-API payload shape mismatch", parsed.error.flatten()));
    }

    const data = parsed.data;

    if (data.type !== "ReceivedCallback" && data.type !== "SendMessage") {
      return err(new AdapterError("unknown_event", `Z-API type "${data.type}" is not a message`));
    }

    const { type: messageType, content } = pickContent(data);

    const ts = typeof data.momment === "string" ? Number(data.momment) : data.momment ?? Date.now();
    // Z-API sends ms, not seconds — keep as ms.
    const occurredAt = new Date(ts);

    const normalized: NormalizedMessage = {
      providerId: this.id,
      externalId: data.messageId,
      contact: {
        externalId: data.phone,
        displayName: data.senderName ?? data.chatName,
        phoneNumber: data.phone,
      },
      direction: data.fromMe ? "outbound" : "inbound",
      messageType,
      content,
      occurredAt,
      rawPayload: payload,
    };

    return ok(normalized);
  }
}

registry.register(new ZApiAdapter());
