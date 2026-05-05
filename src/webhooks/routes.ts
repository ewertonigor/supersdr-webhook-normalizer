import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { countByStatus } from "../repositories/webhook-events.js";
import { receiveWebhook } from "./handler.js";

const ParamsSchema = z.object({
  provider: z.string().min(1).max(50),
});

export async function webhookRoutes(app: FastifyInstance) {
  const db = getDb();

  // Receive any provider webhook.
  app.post("/webhooks/:provider", async (request, reply) => {
    const params = ParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "Invalid provider parameter" });
    }

    // Capture only headers useful for debugging without leaking secrets.
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      if (typeof v === "string" && !k.toLowerCase().includes("authorization")) {
        safeHeaders[k] = v;
      }
    }

    const outcome = await receiveWebhook({
      db,
      log: request.log,
      providerSlug: params.data.provider,
      payload: request.body,
      headers: safeHeaders,
    });

    if (!outcome.ok) {
      return reply.code(outcome.status).send({ error: outcome.error });
    }

    return reply.code(202).send({ event_id: outcome.eventId, status: "received" });
  });

  // Quick observability endpoint — counts events per status.
  app.get("/webhooks/_metrics", async () => {
    const counts = await countByStatus(db);
    return { events_by_status: counts };
  });
}
