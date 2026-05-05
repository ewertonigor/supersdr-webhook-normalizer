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
 * Evolution API webhook adapter (event: "messages.upsert").
 *
 * Payload reference: https://doc.evolution-api.com/v2/en/integrations/webhook
 *
 * Notes:
 *  - remoteJid is the WhatsApp JID like "5511988888888@s.whatsapp.net".
 *    We strip the suffix to get the bare phone number.
 *  - Evolution's `message` object is a discriminated union by key
 *    (conversation, imageMessage, audioMessage, ...). We map a subset.
 *  - When `fromMe === true` we treat as outbound and persist; the LLM step
 *    skips outbound when scoring intent (handled upstream).
 */

const EvolutionMessageBody = z
  .object({
    // Plain text
    conversation: z.string().optional(),
    // Long text / formatted
    extendedTextMessage: z.object({ text: z.string() }).optional(),
    // Media types — captures caption when present
    imageMessage: z.object({ caption: z.string().optional() }).passthrough().optional(),
    audioMessage: z.object({}).passthrough().optional(),
    videoMessage: z.object({ caption: z.string().optional() }).passthrough().optional(),
    documentMessage: z.object({ caption: z.string().optional(), fileName: z.string().optional() }).passthrough().optional(),
    locationMessage: z
      .object({
        degreesLatitude: z.number().optional(),
        degreesLongitude: z.number().optional(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const EvolutionWebhook = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    pushName: z.string().optional(),
    message: EvolutionMessageBody,
    messageType: z.string().optional(),
    messageTimestamp: z.union([z.number(), z.string()]),
  }),
});

function jidToPhone(jid: string): string {
  // "5511988888888@s.whatsapp.net" -> "5511988888888"
  // "5511988888888-1234567@g.us" -> "5511988888888-1234567" (group, kept as-is)
  return jid.split("@")[0] ?? jid;
}

function pickContent(body: z.infer<typeof EvolutionMessageBody>): { type: MessageType; content?: string } {
  if (body.conversation) return { type: "text", content: body.conversation };
  if (body.extendedTextMessage?.text) return { type: "text", content: body.extendedTextMessage.text };
  if (body.imageMessage) return { type: "image", content: body.imageMessage.caption };
  if (body.audioMessage) return { type: "audio" };
  if (body.videoMessage) return { type: "video", content: body.videoMessage.caption };
  if (body.documentMessage) return { type: "document", content: body.documentMessage.caption ?? body.documentMessage.fileName };
  if (body.locationMessage)
    return {
      type: "location",
      content: [body.locationMessage.name, body.locationMessage.address].filter(Boolean).join(" — ") || undefined,
    };
  return { type: "text", content: undefined };
}

class EvolutionAdapter implements ProviderAdapter {
  readonly id = "evolution";
  readonly name = "Evolution API";

  canHandle(payload: unknown): boolean {
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return typeof p.event === "string" && (p.event.startsWith("messages.") || p.event === "send.message");
  }

  normalize(payload: unknown) {
    const parsed = EvolutionWebhook.safeParse(payload);
    if (!parsed.success) {
      return err(new AdapterError("schema_invalid", "Evolution payload shape mismatch", parsed.error.flatten()));
    }

    const { data, event } = parsed.data;

    if (event !== "messages.upsert" && event !== "send.message") {
      return err(new AdapterError("unknown_event", `Evolution event "${event}" is not a message`));
    }

    const phone = jidToPhone(data.key.remoteJid);
    const { type: messageType, content } = pickContent(data.message);

    const tsRaw = typeof data.messageTimestamp === "string" ? Number(data.messageTimestamp) : data.messageTimestamp;
    const occurredAt = new Date(tsRaw * 1000);

    const normalized: NormalizedMessage = {
      providerId: this.id,
      externalId: data.key.id,
      contact: {
        externalId: data.key.remoteJid,
        displayName: data.pushName,
        phoneNumber: phone,
      },
      direction: data.key.fromMe ? "outbound" : "inbound",
      messageType,
      content,
      occurredAt,
      rawPayload: payload,
    };

    return ok(normalized);
  }
}

registry.register(new EvolutionAdapter());
