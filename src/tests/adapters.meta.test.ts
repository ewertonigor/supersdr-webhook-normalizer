import { describe, expect, it } from "vitest";
import { registry } from "../providers/registry.js";
import "../providers/meta.js";

const SAMPLE_TEXT = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5511999999999", phone_number_id: "PNID" },
            contacts: [{ profile: { name: "João Silva" }, wa_id: "5511988888888" }],
            messages: [
              {
                from: "5511988888888",
                id: "wamid.HBgN",
                timestamp: "1677234567",
                type: "text",
                text: { body: "Olá, gostaria de saber mais sobre o produto" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("MetaAdapter", () => {
  const adapter = registry.resolve("meta")!;

  it("registers itself", () => {
    expect(adapter).toBeDefined();
    expect(adapter.id).toBe("meta");
  });

  it("recognizes a Meta payload via canHandle", () => {
    expect(adapter.canHandle(SAMPLE_TEXT)).toBe(true);
    expect(adapter.canHandle({ event: "messages.upsert" })).toBe(false);
  });

  it("normalizes a text message", () => {
    const r = adapter.normalize(SAMPLE_TEXT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      providerId: "meta",
      externalId: "wamid.HBgN",
      direction: "inbound",
      messageType: "text",
      content: "Olá, gostaria de saber mais sobre o produto",
      contact: {
        externalId: "5511988888888",
        displayName: "João Silva",
        phoneNumber: "5511988888888",
      },
    });
    expect(r.value.occurredAt).toBeInstanceOf(Date);
    expect(r.value.occurredAt.toISOString()).toBe("2023-02-24T10:29:27.000Z");
  });

  it("returns schema_invalid for malformed payload", () => {
    const r = adapter.normalize({ object: "whatsapp_business_account", entry: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("schema_invalid");
  });

  it("returns unknown_event when field is not 'messages'", () => {
    const r = adapter.normalize({
      object: "whatsapp_business_account",
      entry: [{ id: "X", changes: [{ field: "statuses", value: { statuses: [] } }] }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("unknown_event");
  });

  it("normalizes media messages with caption", () => {
    const r = adapter.normalize({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "X",
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "5511988888888" }],
                messages: [
                  {
                    from: "5511988888888",
                    id: "wamid.IMG",
                    timestamp: "1677234567",
                    type: "image",
                    image: { caption: "Veja a foto", mime_type: "image/jpeg", id: "media-id" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messageType).toBe("image");
    expect(r.value.content).toBe("Veja a foto");
  });
});
