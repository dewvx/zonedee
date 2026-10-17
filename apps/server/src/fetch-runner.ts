import { fetchSymbol, type FetchOptions, type FetchResult, type Fetchers } from './fetch-job';
import type { CandleStore } from './store';
import type { SymbolConfig } from './symbols';

export interface RunResult extends FetchResult {
  symbol: string;
  source: string;
  durationMs: number;
}

/**
 * ตัวสั่งดึงข้อมูลจากในแอป (ปุ่มอัปเดต / อัปเดตอัตโนมัติ)
 * กดซ้ำระหว่างที่ symbol เดิมกำลังดึงอยู่ จะได้ผลของรอบเดียวกัน ไม่ยิงซ้ำ
 */
export function createFetchRunner(store: CandleStore, fetchers: Fetchers) {
  const running = new Map<string, Promise<RunResult>>();

  return function run(cfg: SymbolConfig, opts: FetchOptions = {}): Promise<RunResult> {
    const existing = running.get(cfg.symbol);
    if (existing) return existing;

    const started = Date.now();
    const job = fetchSymbol(store, cfg, fetchers, opts)
      .then((res) => ({ ...res, symbol: cfg.symbol, source: cfg.source, durationMs: Date.now() - started }))
      .finally(() => running.delete(cfg.symbol));
    running.set(cfg.symbol, job);
    return job;
  };
}
