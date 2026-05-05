/**
 * Run pending migrations (idempotent).
 * Used by `pnpm db:migrate` and at server boot.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  // Some Postgres images don't enable pgcrypto by default; gen_random_uuid() needs it.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await migrate(db, { migrationsFolder: path.resolve(__dirname, "./migrations") });

  // Seed providers (idempotent).
  await db.execute(sql`
    INSERT INTO providers (id, name)
    VALUES ('meta', 'Meta WhatsApp Cloud API'),
           ('evolution', 'Evolution API'),
           ('zapi', 'Z-API')
    ON CONFLICT (id) DO NOTHING;
  `);

  console.log("✓ migrations applied + providers seeded");
  await pool.end();
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});
