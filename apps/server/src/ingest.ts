import { TIMEFRAME_MS, bucketStart, resample, type Candle, type Timeframe } from '@zonedee/core';
import type { CandleStore } from './store';
import { parentNative, type SymbolConfig } from './symbols';

/**
 * บันทึกแท่ง native (TF ที่ดึงตรงจากแหล่ง) แล้วคำนวณ TF ที่ resample จาก native ตัวนี้ใหม่
 * เฉพาะช่วงที่ได้รับผลกระทบ (ย้อนไปถึงต้นสัปดาห์ของแท่งแรก เพื่อให้แท่ง W1 ครบ)
 */
export function ingest(
  store: CandleStore,
  cfg: SymbolConfig,
  nativeTf: Timeframe,
  candles: readonly Candle[],
) {
  const derived: Partial<Record<Timeframe, number>> = {};
  if (candles.length === 0) return { native: 0, derived };

  const sorted = [...candles].sort((a, b) => a.time - b.time);
  store.upsert(cfg.symbol, nativeTf, sorted);

  const targets = cfg.timeframes.filter((tf) => parentNative(cfg, tf, TIMEFRAME_MS) === nativeTf);
  if (targets.length > 0) {
    const from = bucketStart(sorted[0]!.time, 'W1');
    const to = sorted.at(-1)!.time + TIMEFRAME_MS[nativeTf];
    const source = store.range(cfg.symbol, nativeTf, from, to);
    for (const tf of targets) derived[tf] = store.upsert(cfg.symbol, tf, resample(source, tf));
  }
  return { native: sorted.length, derived };
}
