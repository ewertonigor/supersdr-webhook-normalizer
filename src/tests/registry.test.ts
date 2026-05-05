import { describe, expect, it } from "vitest";
import "../providers/index.js";
import { registry } from "../providers/registry.js";

describe("ProviderRegistry", () => {
  it("has the three expected adapters registered", () => {
    const ids = registry.list().map((a) => a.id).sort();
    expect(ids).toEqual(["evolution", "meta", "zapi"]);
  });

  it("resolves by id", () => {
    expect(registry.resolve("meta")?.id).toBe("meta");
    expect(registry.resolve("evolution")?.id).toBe("evolution");
    expect(registry.resolve("zapi")?.id).toBe("zapi");
  });

  it("returns undefined for unknown providers", () => {
    expect(registry.resolve("twilio")).toBeUndefined();
  });

  it("detects provider from payload shape", () => {
    expect(registry.detect({ object: "whatsapp_business_account", entry: [] })?.id).toBe("meta");
    expect(registry.detect({ event: "messages.upsert" })?.id).toBe("evolution");
    expect(
      registry.detect({ messageId: "x", phone: "y", type: "ReceivedCallback" })?.id,
    ).toBe("zapi");
    expect(registry.detect({ random: "blob" })).toBeUndefined();
  });

  it("rejects double registration", () => {
    const meta = registry.resolve("meta")!;
    expect(() => registry.register(meta)).toThrow(/already registered/);
  });
});
