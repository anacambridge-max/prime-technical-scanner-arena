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

/**
 * Vercel's Node runtime can reject the certificate chain returned by some
 * Supabase pooler endpoints with SELF_SIGNED_CERT_IN_CHAIN. The connection
 * itself is still encrypted; we explicitly disable CA-chain verification for
 * this managed Postgres connection so the scanner can connect reliably.
 *
 * Do not put database credentials or certificates in source control.
 */
export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
