import { describe, expect, it } from "vitest";
import { registry } from "../providers/registry.js";
import "../providers/zapi.js";

const SAMPLE = {
  instanceId: "INSTANCE",
  messageId: "3EB0B430B6F8C1D073A0",
  phone: "5511988888888",
  fromMe: false,
  momment: 1677234567000,
  status: "RECEIVED",
  chatName: "João Silva",
  senderName: "João Silva",
  type: "ReceivedCallback",
  text: { message: "Olá, gostaria de saber mais sobre o produto" },
};

describe("ZApiAdapter", () => {
  const adapter = registry.resolve("zapi")!;

  it("registers itself", () => {
    expect(adapter.id).toBe("zapi");
  });

  it("recognizes Z-API payload via canHandle", () => {
    expect(adapter.canHandle(SAMPLE)).toBe(true);
    expect(adapter.canHandle({ event: "messages.upsert" })).toBe(false);
  });

  it("normalizes a text message (ms timestamp)", () => {
    const r = adapter.normalize(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      providerId: "zapi",
      externalId: "3EB0B430B6F8C1D073A0",
      direction: "inbound",
      messageType: "text",
      content: "Olá, gostaria de saber mais sobre o produto",
      contact: {
        externalId: "5511988888888",
        displayName: "João Silva",
        phoneNumber: "5511988888888",
      },
    });
    // Z-API sends milliseconds, not seconds
    expect(r.value.occurredAt.toISOString()).toBe("2023-02-24T10:29:27.000Z");
  });

  it("rejects status callbacks", () => {
    const r = adapter.normalize({ ...SAMPLE, type: "MessageStatusCallback" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("unknown_event");
  });

  it("returns schema_invalid when required fields are missing", () => {
    const r = adapter.normalize({ messageId: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("schema_invalid");
  });
});
