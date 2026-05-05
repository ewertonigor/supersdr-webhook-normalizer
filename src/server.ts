import sensible from "@fastify/sensible";
import Fastify from "fastify";
import { config } from "./config.js";
import { getDb, getPool } from "./db/client.js";
import "./providers/index.js"; // side-effect: registers all adapters
import { messageRoutes } from "./messages/routes.js";
import { registry } from "./providers/registry.js";
import { webhookRoutes } from "./webhooks/routes.js";
import { WebhookProcessor } from "./webhooks/processor.js";

async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss.l", ignore: "pid,hostname" } }
          : undefined,
    },
    bodyLimit: 1024 * 1024, // 1 MB — webhooks should never be huge
  });

  await app.register(sensible);

  // Health endpoint for the docker healthcheck and load balancers.
  app.get("/health", async () => ({
    ok: true,
    providers: registry.list().map((p) => ({ id: p.id, name: p.name })),
    timestamp: new Date().toISOString(),
  }));

  await app.register(webhookRoutes);
  await app.register(messageRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  const db = getDb(config.DATABASE_URL);

  const processor = new WebhookProcessor(db, app.log, {
    pollIntervalMs: config.WORKER_POLL_INTERVAL_MS,
    batchSize: config.WORKER_BATCH_SIZE,
    maxAttempts: config.WORKER_MAX_ATTEMPTS,
  });

  app.addHook("onReady", async () => {
    processor.start();
  });

  app.addHook("onClose", async () => {
    await processor.stop();
    await getPool().end();
  });

  // Graceful shutdown on signals.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.log.info({ signal }, "received shutdown signal");
      app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`✓ supersdr listening on :${config.PORT} (${config.NODE_ENV})`);
  } catch (err) {
    app.log.error({ err }, "failed to start");
    process.exit(1);
  }
}

main();
