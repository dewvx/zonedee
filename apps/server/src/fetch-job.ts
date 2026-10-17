import type { Candle, Timeframe } from '@zonedee/core';
import { ingest } from './ingest';
import type { CandleStore } from './store';
import type { DataSource, NativeSeries, SymbolConfig } from './symbols';

const DAY_MS = 24 * 60 * 60_000;

/** ดึงแท่ง TF `tf` ช่วง [from, to) จากแหล่งข้อมูล */
export type Fetcher = (sourceSymbol: string, tf: Timeframe, from: Date, to: Date) => Promise<Candle[]>;
export type Fetchers = Partial<Record<DataSource, Fetcher>>;

export interface FetchOptions {
  /** บังคับเริ่มดึงจากเวลานี้ (UTC ms) */
  from?: number;
  /** ดึงครั้งแรกย้อนหลังกี่วัน (แทนค่า defaultHistoryDays ของ symbol) */
  days?: number;
  now?: number;
  log?: (msg: string) => void;
}

/**
 * เวลาเริ่มดึงของ native หนึ่งชุด
 * - มีข้อมูลแล้ว: ต่อจากแท่งล่าสุด (รวมแท่งล่าสุดด้วย เผื่อรอบก่อนมันยังไม่ปิด)
 * - ยังไม่มี: ย้อนหลัง `days` / defaultHistoryDays
 * - ไม่ว่ากรณีไหน ไม่ย้อนเกิน maxDays ที่แหล่งข้อมูลให้ได้
 */
export function resolveFrom(
  store: CandleStore,
  cfg: SymbolConfig,
  native: NativeSeries,
  opts: FetchOptions,
): number {
  const now = opts.now ?? Date.now();
  const earliest = now - native.maxDays * DAY_MS;
  const last = store.lastTime(cfg.symbol, native.tf);
  const wanted =
    opts.from ?? last ?? now - (opts.days ?? cfg.defaultHistoryDays) * DAY_MS;
  return Math.max(wanted, earliest);
}

export interface FetchResult {
  total: number;
  errors: string[];
}

export async function fetchSymbol(
  store: CandleStore,
  cfg: SymbolConfig,
  fetchers: Fetchers,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now();
  const fetcher = fetchers[cfg.source];
  if (!fetcher) throw new Error(`ไม่มีตัวดึงข้อมูลสำหรับแหล่ง '${cfg.source}'`);
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

  let total = 0;
  const errors: string[] = [];

  for (const native of cfg.natives) {
    const from = resolveFrom(store, cfg, native, opts);
    const chunkMs = native.chunkDays * DAY_MS;
    try {
      for (let start = from; start < now; start += chunkMs) {
        const end = Math.min(start + chunkMs, now);
        const candles = await fetcher(cfg.sourceSymbol, native.tf, new Date(start), new Date(end));
        const res = ingest(store, cfg, native.tf, candles);
        total += res.native;
        log(`  ${cfg.symbol} ${native.tf.padEnd(3)} ${fmt(start)} → ${fmt(end)} UTC : ${res.native.toLocaleString()} แท่ง`);
      }
    } catch (err) {
      // native ชุดหนึ่งพัง (เช่น Yahoo ไม่ให้ M1 ช่วงนั้น) ให้ไปชุดถัดไปต่อ
      const msg = `${native.tf}: ${(err as Error).message}`;
      errors.push(msg);
      log(`  ⚠ ${cfg.symbol} ${msg}`);
    }
  }

  return { total, errors };
}
