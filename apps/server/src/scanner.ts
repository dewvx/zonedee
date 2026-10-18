import { scanStock, type Candle, type ScanOptions, type StockScan } from '@zonedee/core';
import { TICKER_RE } from './user-symbols';

/** แหล่งรายชื่อหุ้นที่จะสแกน — ตัวที่มี id ของ Yahoo ใช้ screener สำเร็จรูปของ Yahoo (ฟรี) */
export const SCAN_SOURCES = [
  { id: 'small_cap_gainers', label: 'Small cap ขึ้นแรงวันนี้ (Yahoo)' },
  { id: 'aggressive_small_caps', label: 'Small cap โตแรง (Yahoo)' },
  { id: 'day_gainers', label: 'ขึ้นแรงสุดวันนี้ (Yahoo)' },
  { id: 'most_actives', label: 'ซื้อขายมากสุดวันนี้ (Yahoo)' },
  { id: 'most_shorted_stocks', label: 'โดน short เยอะ (Yahoo)' },
  { id: 'watchlist', label: 'หุ้นใน watchlist ของฉัน' },
  { id: 'custom', label: 'พิมพ์ ticker เอง' },
] as const;
export type ScanSourceId = (typeof SCAN_SOURCES)[number]['id'];
export type YahooScreenId = Exclude<ScanSourceId, 'watchlist' | 'custom'>;

export interface ScreenQuote {
  symbol: string;
  name: string;
  marketCap: number | null;
}

export interface ScanDeps {
  screener: (id: YahooScreenId, count: number) => Promise<ScreenQuote[]>;
  /** แท่ง D1 ช่วง [from, to) */
  daily: (symbol: string, from: Date, to: Date) => Promise<Candle[]>;
  watchlistSymbols: () => string[];
  now?: () => number;
}

export interface ScanRequest {
  source: ScanSourceId;
  /** ใช้เมื่อ source = custom */
  symbols?: string[];
  count?: number;
  options?: Partial<ScanOptions>;
}

export interface ScanRow {
  symbol: string;
  name: string;
  marketCap: number | null;
  scan: StockScan | null;
  error: string | null;
}

export interface ScanResponse {
  source: ScanSourceId;
  scannedAt: number;
  rows: ScanRow[];
  error: string | null;
}

const CACHE_MS = 10 * 60_000;
const HISTORY_DAYS = 400;
const CONCURRENCY = 4;

/** ตัวสแกนหุ้นซิ่ง: ดึงรายชื่อ → ดึง D1 ย้อนหลัง ~1 ปี (cache 10 นาที) → scanStock → เรียงคะแนน */
export function createScanner(deps: ScanDeps) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; candles: Candle[] }>();

  const daily = async (symbol: string) => {
    const hit = cache.get(symbol);
    if (hit && now() - hit.at < CACHE_MS) return hit.candles;
    const to = new Date(now() + 86_400_000);
    const candles = await deps.daily(symbol, new Date(now() - HISTORY_DAYS * 86_400_000), to);
    cache.set(symbol, { at: now(), candles });
    return candles;
  };

  return async function scan(req: ScanRequest): Promise<ScanResponse> {
    const count = Math.min(Math.max(req.count ?? 25, 1), 100);
    let list: ScreenQuote[] = [];
    let error: string | null = null;
    try {
      if (req.source === 'custom') {
        list = [...new Set((req.symbols ?? []).map((s) => s.trim().toUpperCase()).filter((s) => TICKER_RE.test(s)))]
          .slice(0, 100)
          .map((symbol) => ({ symbol, name: symbol, marketCap: null }));
      } else if (req.source === 'watchlist') {
        list = deps.watchlistSymbols().map((symbol) => ({ symbol, name: symbol, marketCap: null }));
      } else {
        list = (await deps.screener(req.source, count)).slice(0, count);
      }
    } catch (err) {
      error = `ดึงรายชื่อจาก Yahoo ไม่ได้: ${(err as Error).message}`;
    }

    const rows: ScanRow[] = new Array(list.length);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const k = next++;
        const q = list[k]!;
        try {
          rows[k] = { ...q, scan: scanStock(await daily(q.symbol), req.options), error: null };
        } catch (err) {
          rows[k] = { ...q, scan: null, error: (err as Error).message };
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    rows.sort((a, b) => (b.scan?.score ?? -1) - (a.scan?.score ?? -1));
    return { source: req.source, scannedAt: now(), rows, error };
  };
}
