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

export function upstoxConfigured(): boolean { return Boolean(process.env.UPSTOX_ACCESS_TOKEN?.trim()); }

function authHeaders(): Record<string, string> {
  const token = process.env.UPSTOX_ACCESS_TOKEN?.trim();
  return { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

class UpstoxHttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function fetchJson(url: string, timeoutMs: number, maxRetries: number): Promise<unknown> {
  let attempt = 0;
  let lastErr: Error | null = null;
  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: authHeaders(), signal: controller.signal, cache: "no-store" });
      if (res.status === 401) throw new UpstoxHttpError(401, "Upstox token expired or invalid");
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        const delay = Math.min(Math.max(retryAfter * 1000, 250 * Math.pow(2, attempt)), 1500);
        lastErr = new UpstoxHttpError(res.status, `HTTP ${res.status}`);
        attempt++;
        if (attempt <= maxRetries) await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (!res.ok) throw new UpstoxHttpError(res.status, `HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof UpstoxHttpError && (err.status === 401 || (err.status !== 429 && err.status < 500))) throw err;
      lastErr = err as Error;
      attempt++;
      if (attempt <= maxRetries) await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
    } finally { clearTimeout(timer); }
  }
  throw lastErr ?? new Error("Upstox request failed");
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const idx = cursor++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}

interface RawCandleTuple { 0: string | number; 1: number; 2: number; 3: number; 4: number; 5: number; }

function extractCandleTuples(payload: unknown): RawCandleTuple[] {
  if (payload && typeof payload === "object" && "data" in payload && payload.data && typeof payload.data === "object" && "candles" in (payload.data as Record<string, unknown>)) {
    const candles = (payload.data as { candles?: unknown }).candles;
    if (Array.isArray(candles)) return candles as RawCandleTuple[];
  }
  return [];
}

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
    if (nh < nl || nh <= 0 || nl <= 0 || nv < 0) continue;
    out.push({ t: ms, label: istTimeLabel(new Date(ms)), o: no, h: nh, l: nl, c: nc, v: nv });
  }
  out.sort((a, b) => a.t - b.t);
  const dedup = new Map<number, CandlePoint>();
  for (const c of out) dedup.set(c.t, c);
  return Array.from(dedup.values());
}

interface InstrumentRow { instrument_key?: string; trading_symbol?: string; segment?: string; name?: string; }

async function downloadInstrumentBundle(timeoutMs: number): Promise<Map<string, { key: string; name: string }>> {
  const map = new Map<string, { key: string; name: string }>();
  for (const url of INSTRUMENT_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const rows = JSON.parse(gunzipSync(buf).toString("utf8")) as InstrumentRow[];
      for (const r of rows) {
        if (!r.trading_symbol || !r.instrument_key) continue;
        if (r.segment && r.segment !== "NSE_EQ") continue;
        const sym = r.trading_symbol.toUpperCase();
        if (!map.has(sym)) map.set(sym, { key: r.instrument_key, name: r.name ?? sym });
      }
      if (map.size > 100) return map;
    } catch { /* Try next bundle. */ }
  }
  return map;
}

export async function resolveInstrumentKeys(symbols: string[], timeoutMs: number): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  try {
    const rows = await db.select().from(instrumentMap).where(inArray(instrumentMap.symbol, symbols));
    const hit = new Set(rows.map((r) => r.symbol));
    for (const r of rows) out.set(r.symbol, r.instrumentKey);
    for (const s of symbols) if (!hit.has(s)) missing.push(s);
  } catch { missing.push(...symbols); }
  if (missing.length === 0) return out;

  const bundle = await downloadInstrumentBundle(timeoutMs);
  if (bundle.size === 0) return out;
  const now = new Date();
  const cacheRows: Array<{ symbol: string; instrumentKey: string; name: string; updatedAt: Date }> = [];
  for (const s of missing) {
    const found = bundle.get(s);
    if (!found) continue;
    out.set(s, found.key);
    cacheRows.push({ symbol: s, instrumentKey: found.key, name: found.name, updatedAt: now });
  }

  // Cache all resolved instruments in one DB call. The old code performed one
  // INSERT per symbol sequentially, which could exhaust Vercel's 120s runtime.
  if (cacheRows.length) {
    try { await db.insert(instrumentMap).values(cacheRows).onConflictDoNothing({ target: instrumentMap.symbol }); }
    catch { /* Cache is best-effort; resolved keys are still returned. */ }
  }
  return out;
}

export async function fetchIntraday5m(instrumentKey: string, timeoutMs: number, maxRetries: number): Promise<CandlePoint[]> {
  const key = encodeURIComponent(instrumentKey);
  const urls = [`${API_BASE}/v3/historical-candle/intraday/${key}/minutes/5`, `${API_BASE}/v2/historical-candle/intraday/${key}/5minute`];
  let lastErr: Error | null = null;
  for (const url of urls) {
    try { return normalizeCandles(await fetchJson(url, timeoutMs, maxRetries)); }
    catch (err) { if (err instanceof UpstoxHttpError && err.status === 401) throw err; lastErr = err as Error; }
  }
  throw lastErr ?? new Error("intraday fetch failed");
}

export async function fetchPrevDayLevels(instrumentKey: string, todayKey: string, timeoutMs: number, maxRetries: number): Promise<PrevDayLevels | null> {
  const key = encodeURIComponent(instrumentKey);
  const fromDate = epochForIst(todayKey, "00:00");
  const from = new Date(fromDate.getTime() - 15 * 86400000);
  const to = new Date(fromDate.getTime() - 86400000);
  const url = `${API_BASE}/v3/historical-candle/${key}/days/1/${istDateKey(to)}/${istDateKey(from)}`;
  const candles = normalizeCandles(await fetchJson(url, timeoutMs, maxRetries));
  const prev = candles.filter((c) => c.t < fromDate.getTime()).pop();
  if (!prev) return null;
  return { pdh: prev.h, pdl: prev.l, prevClose: prev.c, prevOpen: prev.o, dayKey: istDateKey(new Date(prev.t)) };
}

export async function fetchRecent5mWithLevels(instrumentKey: string, todayKey: string, timeoutMs: number, maxRetries: number): Promise<{ candles: CandlePoint[]; warmup: CandlePoint[]; levels: PrevDayLevels | null }> {
  const key = encodeURIComponent(instrumentKey);
  const todayStart = epochForIst(todayKey, "00:00").getTime();
  const from = new Date(todayStart - 7 * 86400000);
  const url = `${API_BASE}/v3/historical-candle/${key}/minutes/5/${todayKey}/${istDateKey(from)}`;
  const all = normalizeCandles(await fetchJson(url, timeoutMs, maxRetries));
  const today = all.filter((c) => c.t >= todayStart);
  const prior = all.filter((c) => c.t < todayStart);
  if (!prior.length) return { candles: today, warmup: [], levels: null };
  const prevDayKey = istDateKey(new Date(prior[prior.length - 1].t));
  const prevDay = prior.filter((c) => istDateKey(new Date(c.t)) === prevDayKey);
  const levels = prevDay.length ? { pdh: Math.max(...prevDay.map((c) => c.h)), pdl: Math.min(...prevDay.map((c) => c.l)), prevClose: prevDay[prevDay.length - 1].c, prevOpen: prevDay[0].o, dayKey: prevDayKey } : null;
  return { candles: today, warmup: prior.slice(-160), levels };
}

export async function fetchLtpBatch(instrumentKeys: string[], timeoutMs: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < instrumentKeys.length; i += 500) {
    const chunk = instrumentKeys.slice(i, i + 500);
    try {
      const q = chunk.map((k) => `instrument_key=${encodeURIComponent(k)}`).join("&");
      const payload = (await fetchJson(`${API_BASE}/v3/market-quote/ltp?${q}`, timeoutMs, 1)) as { data?: Record<string, { instrument_token?: string; last_price?: number }> };
      for (const [key, val] of Object.entries(payload?.data ?? {})) { const price = val?.last_price; if (typeof price === "number" && Number.isFinite(price)) out.set(key, price); }
    } catch { /* LTP is display-only. */ }
  }
  return out;
}
