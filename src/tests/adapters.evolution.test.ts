import { describe, expect, it } from "vitest";
import { registry } from "../providers/registry.js";
import "../providers/evolution.js";

const SAMPLE = {
  event: "messages.upsert",
  instance: "minha-instancia",
  data: {
    key: { remoteJid: "5511988888888@s.whatsapp.net", fromMe: false, id: "3EB0B430B6F8C1D073A0" },
    pushName: "João Silva",
    message: { conversation: "Olá, gostaria de saber mais sobre o produto" },
    messageType: "conversation",
    messageTimestamp: 1677234567,
  },
  sender: "5511988888888@s.whatsapp.net",
};

describe("EvolutionAdapter", () => {
  const adapter = registry.resolve("evolution")!;

  it("registers itself", () => {
    expect(adapter.id).toBe("evolution");
  });

  it("recognizes Evolution payload via canHandle", () => {
    expect(adapter.canHandle(SAMPLE)).toBe(true);
    expect(adapter.canHandle({ object: "whatsapp_business_account" })).toBe(false);
  });

  it("normalizes a conversation message", () => {
    const r = adapter.normalize(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      providerId: "evolution",
      externalId: "3EB0B430B6F8C1D073A0",
      direction: "inbound",
      messageType: "text",
      content: "Olá, gostaria de saber mais sobre o produto",
      contact: {
        externalId: "5511988888888@s.whatsapp.net",
        displayName: "João Silva",
        phoneNumber: "5511988888888",
      },
    });
  });

  it("marks fromMe=true as outbound", () => {
    const r = adapter.normalize({ ...SAMPLE, data: { ...SAMPLE.data, key: { ...SAMPLE.data.key, fromMe: true } } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.direction).toBe("outbound");
  });

  it("rejects unknown events", () => {
    const r = adapter.normalize({ ...SAMPLE, event: "presence.update" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("unknown_event");
  });

  it("normalizes extendedTextMessage to text", () => {
    const r = adapter.normalize({
      ...SAMPLE,
      data: {
        ...SAMPLE.data,
        message: { extendedTextMessage: { text: "Olá" } },
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.messageType).toBe("text");
    expect(r.value.content).toBe("Olá");
  });
});
