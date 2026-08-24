import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Prefer the Supabase/Postgres connection variable used by the deployment.
 * DATABASE_URL remains supported for local/dev environments.
 */
const rawDatabaseUrl =
  process.env.DATABASE_POSTGRES_URL ?? process.env.DATABASE_URL;

if (!rawDatabaseUrl) {
  throw new Error("DATABASE_POSTGRES_URL or DATABASE_URL is required");
}

/**
 * Supabase connection URLs can carry sslmode/sslrootcert query parameters.
 * node-postgres lets URL-level SSL options override the Pool `ssl` object,
 * which can produce SELF_SIGNED_CERT_IN_CHAIN on Vercel. Strip only those
 * URL-level options and keep the connection encrypted with explicit TLS.
 */
function normalizeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value
      .replace(/([?&])sslmode=[^&]*/gi, "$1")
      .replace(/([?&])sslcert=[^&]*/gi, "$1")
      .replace(/([?&])sslkey=[^&]*/gi, "$1")
      .replace(/([?&])sslrootcert=[^&]*/gi, "$1")
      .replace(/[?&]$/, "");
  }
}

const databaseUrl = normalizeDatabaseUrl(rawDatabaseUrl);

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    // Keep failed Vercel requests from waiting on dead DB connections.
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 3000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
