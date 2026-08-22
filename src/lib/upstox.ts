/**
 * Upstox API client — SERVER-SIDE ONLY.
 *
 * - Access token comes exclusively from process.env.UPSTOX_ACCESS_TOKEN.
 * - The token is never sent to the browser, never logged, never persisted.
 * - All requests carry timeouts + bounded retries (handles 429 / 5xx).
 * - One bad symbol never throws upwards: callers get null and keep scanning.
 */

import { gunzipSync } from "node:zlib";
import { db } from "@/db";
import { instrumentMap } from "@/db/schema";
import { inArray } from "drizzle-orm";
import type { CandlePoint, PrevDayLevels } from "./types";
import { istTimeLabel, istDateKey, epochForIst } from "./time";

const API_BASE = "https://api.upstox.com";
const INSTRUMENT_URLS = [
  "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
  "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz",
];

export function upstoxConfigured(): boolean {
  return Boolean(process.env.UPSTOX_ACCESS_TOKEN?.trim());
}

function authHeaders(): Record<string, string> {
  const token = process.env.UPSTOX_ACCESS_TOKEN?.trim();
  return {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

class UpstoxHttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function fetchJson(
  url: string,
  timeoutMs: number,
  maxRetries: number
): Promise<unknown> {
  let attempt = 0;
  let lastErr: Error | null = null;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: authHeaders(),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 401) {
        // Expired/invalid token — retrying will not help.
        throw new UpstoxHttpError(401, "Upstox token expired or invalid");
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        const backoff =
          Math.max(retryAfter * 1000, 350 * Math.pow(2, attempt)) +
          Math.random() * 150;
        lastErr = new UpstoxHttpError(res.status, `HTTP ${res.status}`);
        attempt++;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      if (!res.ok) {
        throw new UpstoxHttpError(res.status, `HTTP ${res.status}`);
      }
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof UpstoxHttpError && (err.status === 401 || (err.status !== 429 && err.status < 500))) {
        throw err;
      }
      lastErr = err as Error;
      attempt++;
      if (attempt <= maxRetries) {
        await new Promise((r) =>
          setTimeout(r, 350 * Math.pow(2, attempt) + Math.random() * 150)
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error("Upstox request failed");
}

/** Small concurrency pool (no external dependency). */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await fn(items[idx], idx);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/* ------------------------------------------------------------------ */
/* Candle normalization                                                */
/* ------------------------------------------------------------------ */

interface RawCandleTuple {
  0: string | number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

function extractCandleTuples(payload: unknown): RawCandleTuple[] {
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    payload.data &&
    typeof payload.data === "object" &&
    "candles" in (payload.data as Record<string, unknown>)
  ) {
    const candles = (payload.data as { candles?: unknown }).candles;
    if (Array.isArray(candles)) return candles as RawCandleTuple[];
  }
  return [];
}

/** Normalize Upstox tuple candles -> ascending, malformed rows removed. */
export function normalizeCandles(raw: unknown): CandlePoint[] {
  const tuples = extractCandleTuples(raw);
  const out: CandlePoint[] = [];
  for (const t of tuples) {
    if (!Array.isArray(t) || t.length < 6) continue;
    const [ts, o, h, l, c, v] = t;
    const ms = typeof ts === "number" ? ts : Date.parse(String(ts));
    const nums = [o, h, l, c, v].map(Number);
    if (!Number.isFinite(ms) || nums.some((n) => !Number.isFinite(n))) continue;
    const [no, nh, nl, nc, nv] = nums;
    if (nh < nl || nh <= 0 || nl <= 0 || nv < 0) continue; // malformed candle
    out.push({
      t: ms,
      label: istTimeLabel(new Date(ms)),
      o: no,
      h: nh,
      l: nl,
      c: nc,
      v: nv,
    });
  }
  out.sort((a, b) => a.t - b.t);
  // de-duplicate identical timestamps (keep last)
  const dedup = new Map<number, CandlePoint>();
  for (const c of out) dedup.set(c.t, c);
  return Array.from(dedup.values());
}

/* ------------------------------------------------------------------ */
/* Instrument key resolution (NSE_EQ|ISIN) with DB cache               */
/* ------------------------------------------------------------------ */

interface InstrumentRow {
  instrument_key?: string;
  trading_symbol?: string;
  segment?: string;
  name?: string;
}

async function downloadInstrumentBundle(timeoutMs: number): Promise<Map<string, { key: string; name: string }>> {
  const map = new Map<string, { key: string; name: string }>();
  for (const url of INSTRUMENT_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const json = gunzipSync(buf).toString("utf8");
      const rows = JSON.parse(json) as InstrumentRow[];
      for (const r of rows) {
        if (!r.trading_symbol || !r.instrument_key) continue;
        if (r.segment && r.segment !== "NSE_EQ") continue;
        const sym = r.trading_symbol.toUpperCase();
        if (!map.has(sym)) {
          map.set(sym, { key: r.instrument_key, name: r.name ?? sym });
        }
      }
      if (map.size > 100) return map;
    } catch {
      // try next bundle URL
    }
  }
  return map;
}

/** Resolve trading symbols -> Upstox instrument keys (DB-cached). */
export async function resolveInstrumentKeys(
  symbols: string[],
  timeoutMs: number
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  try {
    const rows = await db
      .select()
      .from(instrumentMap)
      .where(inArray(instrumentMap.symbol, symbols));
    const hit = new Set(rows.map((r) => r.symbol));
    for (const r of rows) out.set(r.symbol, r.instrumentKey);
    for (const s of symbols) if (!hit.has(s)) missing.push(s);
  } catch {
    for (const s of symbols) missing.push(s);
  }
  if (missing.length === 0) return out;

  const bundle = await downloadInstrumentBundle(timeoutMs);
  if (bundle.size === 0) return out; // unresolved symbols stay missing

  const now = new Date();
  for (const s of missing) {
    const found = bundle.get(s);
    if (!found) continue;
    out.set(s, found.key);
    try {
      await db
        .insert(instrumentMap)
        .values({ symbol: s, instrumentKey: found.key, name: found.name, updatedAt: now })
        .onConflictDoUpdate({
          target: instrumentMap.symbol,
          set: { instrumentKey: found.key, name: found.name, updatedAt: now },
        });
    } catch {
      // cache write is best-effort
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Market data endpoints                                               */
/* ------------------------------------------------------------------ */

/** Today's (intraday) candles on the 5-minute timeframe. */
export async function fetchIntraday5m(
  instrumentKey: string,
  timeoutMs: number,
  maxRetries: number
): Promise<CandlePoint[]> {
  const key = encodeURIComponent(instrumentKey);
  const urls = [
    `${API_BASE}/v3/historical-candle/intraday/${key}/minutes/5`,
    `${API_BASE}/v2/historical-candle/intraday/${key}/5minute`,
  ];
  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const payload = await fetchJson(url, timeoutMs, maxRetries);
      return normalizeCandles(payload);
    } catch (err) {
      if (err instanceof UpstoxHttpError && err.status === 401) throw err;
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error("intraday fetch failed");
}

/** Previous completed trading day levels (from daily candles). */
export async function fetchPrevDayLevels(
  instrumentKey: string,
  todayKey: string,
  timeoutMs: number,
  maxRetries: number
): Promise<PrevDayLevels | null> {
  const key = encodeURIComponent(instrumentKey);
  const fromDate = epochForIst(todayKey, "00:00");
  const from = new Date(fromDate.getTime() - 15 * 24 * 3600 * 1000);
  const to = new Date(fromDate.getTime() - 24 * 3600 * 1000);
  const fromStr = istDateKey(from);
  const toStr = istDateKey(to);
  const url = `${API_BASE}/v2/historical-candle/${key}/day/${toStr}/${fromStr}`;
  const payload = await fetchJson(url, timeoutMs, maxRetries);
  const candles = normalizeCandles(payload);
  // The most recent completed daily candle is the previous trading day.
  const prev = candles.filter((c) => c.t < fromDate.getTime()).pop();
  if (!prev) return null;
  return {
    pdh: prev.h,
    pdl: prev.l,
    prevClose: prev.c,
    prevOpen: prev.o,
    dayKey: istDateKey(new Date(prev.t)),
  };
}

/** Best-effort live LTP ticks (never used for confirmations). */
export async function fetchLtpBatch(
  instrumentKeys: string[],
  timeoutMs: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const chunks: string[][] = [];
  for (let i = 0; i < instrumentKeys.length; i += 100) {
    chunks.push(instrumentKeys.slice(i, i + 100));
  }
  await mapPool(chunks, 2, async (chunk) => {
    try {
      const q = chunk.map((k) => `instrument_key=${encodeURIComponent(k)}`).join("&");
      const payload = (await fetchJson(
        `${API_BASE}/v2/market-quote/ltp?${q}`,
        timeoutMs,
        1
      )) as { data?: Record<string, { instrument_token?: string; last_price?: number }> };
      const data = payload?.data ?? {};
      for (const val of Object.values(data)) {
        const token = val?.instrument_token;
        const price = val?.last_price;
        if (token && typeof price === "number" && Number.isFinite(price)) {
          out.set(token, price);
        }
      }
    } catch {
      // LTP refresh is optional; ignore
    }
  });
  // map instrument_token (same string as key in v2 ltp echo) -> price
  // v2 echoes keys as "NSE_EQ|ISIN" so token == instrument key
  return out;
}
