import { DEFAULTS, type DetectorConfig } from '../config';
import { sma } from '../indicators/sma';
import { detectStructure } from '../structure/market-structure';
import type { Candle } from '../types';
import { keyLevels, type KeyLevels } from './key-levels';

/** ค่าตั้งต้นของตัวสแกนหุ้นซิ่ง (docs/rules.md: Phase 10) */
export const SCAN_DEFAULTS = {
  /** ค่าเฉลี่ย volume กี่วัน */
  volLookback: 20,
  /** ทะลุ high ของกี่วันก่อนหน้า */
  breakoutLookback: 20,
  /** volume วันนี้ ≥ กี่เท่าของค่าเฉลี่ย ถึงนับว่า "พุ่ง" */
  minRelVolume: 2,
  /** เปิดกระโดดจากราคาปิดเมื่อวาน ≥ กี่ % */
  minGapPct: 4,
  /** BOS ขาขึ้นภายในกี่แท่งล่าสุด */
  bosWithinBars: 3,
  minPrice: 0.5,
  maxPrice: 50,
  /** มูลค่าซื้อขายเฉลี่ยต่อวันขั้นต่ำ (USD) — กันหุ้นที่ไม่มีสภาพคล่อง */
  minAvgDollarVolume: 1_000_000,
  /** ห่างจากแนวรับ/แนวต้าน (แบบง่าย) ไม่เกินกี่ % ถึงนับว่า "ใกล้" */
  levelNearPct: 3,
};
export type ScanOptions = typeof SCAN_DEFAULTS;

export type ScanSignal = 'volume' | 'gap' | 'breakout' | 'bos' | 'near-support' | 'broke-support' | 'broke-resistance';

export interface StockScan {
  lastTime: number;
  close: number;
  prevClose: number;
  changePct: number;
  gapPct: number;
  volume: number;
  avgVolume: number;
  relVolume: number;
  avgDollarVolume: number;
  /** high สูงสุดของ N วันก่อนหน้า (ไม่รวมวันนี้) */
  priorHigh: number;
  breakout: boolean;
  /** ห่างจาก priorHigh กี่ % (ติดลบ = ยังอยู่ใต้) */
  fromPriorHighPct: number;
  bosBull: boolean;
  aboveSma50: boolean | null;
  /** แนวรับต้านแบบง่าย (keyLevels) */
  levels: KeyLevels | null;
  signals: ScanSignal[];
  /** คะแนนเรียงลำดับ: volume 3 · breakout 3 · ทะลุแนวต้าน 3 · gap 2 · ใกล้แนวรับ 2 · bos 1 · หลุดแนวรับ 1 (+ relVolume เป็นตัวตัดสินเสมอ) */
  score: number;
  /** ผ่านตัวกรองราคา + สภาพคล่อง */
  passes: boolean;
}

/**
 * สแกนหุ้น 1 ตัวจากแท่ง D1 (แท่งสุดท้าย = วันล่าสุด ถ้าตลาดยังเปิดอยู่ volume ยังไม่ครบวัน)
 * ไม่ได้บอกว่าควรซื้อ — แค่คัดตัวที่ "มีอะไรเกิดขึ้น" มาให้ดูกราฟต่อ
 */
export function scanStock(
  candles: readonly Candle[],
  options: Partial<ScanOptions> = {},
  config: Partial<DetectorConfig> = {},
): StockScan | null {
  const o = { ...SCAN_DEFAULTS, ...options };
  const n = candles.length;
  const need = Math.max(o.volLookback, o.breakoutLookback) + 1;
  if (n < need) return null;
  const last = candles[n - 1]!;
  const prev = candles[n - 2]!;

  let volSum = 0;
  let dollarSum = 0;
  for (let k = n - 1 - o.volLookback; k < n - 1; k++) {
    volSum += candles[k]!.volume;
    dollarSum += candles[k]!.volume * candles[k]!.close;
  }
  const avgVolume = volSum / o.volLookback;
  const avgDollarVolume = dollarSum / o.volLookback;
  let priorHigh = -Infinity;
  for (let k = n - 1 - o.breakoutLookback; k < n - 1; k++) priorHigh = Math.max(priorHigh, candles[k]!.high);

  const relVolume = avgVolume > 0 ? last.volume / avgVolume : 0;
  const gapPct = ((last.open - prev.close) / prev.close) * 100;
  const changePct = ((last.close - prev.close) / prev.close) * 100;
  const breakout = last.close > priorHigh;
  const cfg = { ...DEFAULTS, ...config };
  const bosBull = detectStructure(candles, cfg).some(
    (e) => e.direction === 'bull' && e.confirmIndex >= n - o.bosWithinBars,
  );
  const s50 = n >= 50 ? sma(candles.slice(-50).map((c) => c.close), 50).at(-1) ?? null : null;

  const signals: ScanSignal[] = [];
  if (relVolume >= o.minRelVolume) signals.push('volume');
  if (gapPct >= o.minGapPct) signals.push('gap');
  if (breakout) signals.push('breakout');
  if (bosBull) signals.push('bos');
  const levels = keyLevels(candles, { nearPct: o.levelNearPct });
  if (levels?.brokeResistance) signals.push('broke-resistance');
  else if (levels?.brokeSupport) signals.push('broke-support');
  else if (levels?.nearSupport) signals.push('near-support');
  const weight: Record<ScanSignal, number> = {
    volume: 3,
    breakout: 3,
    'broke-resistance': 3,
    gap: 2,
    'near-support': 2,
    bos: 1,
    'broke-support': 1,
  };

  return {
    lastTime: last.time,
    close: last.close,
    prevClose: prev.close,
    changePct,
    gapPct,
    volume: last.volume,
    avgVolume,
    relVolume,
    avgDollarVolume,
    priorHigh,
    breakout,
    fromPriorHighPct: ((last.close - priorHigh) / priorHigh) * 100,
    bosBull,
    aboveSma50: s50 === null ? null : last.close > s50,
    levels,
    signals,
    score: signals.reduce((a, s) => a + weight[s], 0) + Math.min(relVolume, 20) / 100,
    passes: last.close >= o.minPrice && last.close <= o.maxPrice && avgDollarVolume >= o.minAvgDollarVolume,
  };
}
