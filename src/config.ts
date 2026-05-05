import { z } from "zod";

/**
 * Env vars validated at boot — fail fast on misconfiguration.
 *
 * OpenAI key is REQUIRED. The assessment is explicit about this being a real
 * LLM integration; we don't ship a mock fallback.
 */
const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
});

export type Config = z.infer<typeof Schema>;

function load(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`✗ invalid configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config: Config = load();
