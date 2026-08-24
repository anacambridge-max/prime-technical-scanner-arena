import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Prefer the Supabase/Postgres connection variable used by the deployment.
 * DATABASE_URL remains supported for local/dev environments.
 */
const databaseUrl = process.env.DATABASE_POSTGRES_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_POSTGRES_URL or DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
