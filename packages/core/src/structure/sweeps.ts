import { DEFAULTS, type DetectorConfig } from '../config';
import type { Candle } from '../types';
import { detectSwings, type SwingPoint } from './swings';

export interface SweepEvent {
  /** bear = กวาด swing high (buy-side liquidity) แล้วปิดกลับลง · bull = กวาด swing low แล้วปิดกลับขึ้น */
  direction: 'bull' | 'bear';
  level: number;
  swingIndex: number;
  /** แท่งที่ sweep */
  index: number;
  time: number;
  confirmIndex: number;
}

/**
 * Liquidity sweep (docs/rules.md ชั้นที่ 1: "โดนไส้เท่านั้นถึงเรียก sweep") ✅
 * - ไส้ทะลุ swing ที่ยังไม่ถูกแตะ แต่ราคาปิดกลับเข้ามา → sweep (swing นั้นหมดสภาพคล่อง นับครั้งเดียว)
 * - ปิดทะลุ = เบรก ไม่ใช่ sweep (swing นั้นถูกตัดทิ้ง)
 * - swing ที่เก่ากว่า sweepLookback แท่งไม่นับ
 * ต่างจาก BOS ตรงที่ดูทุก swing ที่ยังไม่ถูกแตะ ไม่ใช่แค่ตัวล่าสุด (สภาพคล่องค้างอยู่ทุกยอด/ก้น)
 */
export function detectSweeps(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
  asOf: number = candles.length - 1,
): SweepEvent[] {
  const cfg = { ...DEFAULTS, ...config };
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;

  const byConfirm = new Map<number, SwingPoint[]>();
  for (const s of detectSwings(data, { swingLength: cfg.swingLength })) {
    const list = byConfirm.get(s.confirmIndex) ?? [];
    list.push(s);
    byConfirm.set(s.confirmIndex, list);
  }

  const events: SweepEvent[] = [];
  let highs: SwingPoint[] = [];
  let lows: SwingPoint[] = [];

  for (let i = 0; i < data.length; i++) {
    const bar = data[i]!;
    highs = highs.filter((s) => {
      if (i - s.pivotIndex > cfg.sweepLookback) return false;
      if (bar.close > s.price) return false; // เบรก
      if (bar.high > s.price) {
        events.push({ direction: 'bear', level: s.price, swingIndex: s.pivotIndex, index: i, time: bar.time, confirmIndex: i });
        return false;
      }
      return true;
    });
    lows = lows.filter((s) => {
      if (i - s.pivotIndex > cfg.sweepLookback) return false;
      if (bar.close < s.price) return false;
      if (bar.low < s.price) {
        events.push({ direction: 'bull', level: s.price, swingIndex: s.pivotIndex, index: i, time: bar.time, confirmIndex: i });
        return false;
      }
      return true;
    });
    for (const s of byConfirm.get(i) ?? []) (s.kind === 'high' ? highs : lows).push(s);
  }
  return events;
}
