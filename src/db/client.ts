import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Lazy-init Postgres pool.
 * Centralized so tests can override (or use a separate test DB).
 */
export function getPool(databaseUrl?: string): pg.Pool {
  if (!pool) {
    const url = databaseUrl ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({
      connectionString: url,
      max: 10,
    });
  }
  return pool;
}

export function getDb(databaseUrl?: string) {
  return drizzle(getPool(databaseUrl), { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
