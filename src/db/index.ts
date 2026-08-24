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
 * Some Supabase connection strings include sslmode=verify-full/require.
 * node-postgres gives URL ssl parameters precedence over the `ssl` object,
 * which can make Vercel fail with SELF_SIGNED_CERT_IN_CHAIN even when
 * rejectUnauthorized:false is supplied below.
 *
 * Remove only the URL-level certificate/SSL-mode options and let the Pool's
 * explicit SSL configuration control the connection. The connection remains
 * encrypted; this only disables CA-chain verification for this managed DB.
 */
function normalizeDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    // Keep the original value if the runtime receives a non-URL connection
    // string; pg can still parse standard libpq-style connection strings.
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
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
