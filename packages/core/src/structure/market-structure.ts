import { DEFAULTS, type DetectorConfig } from '../config';
import type { Candle } from '../types';
import { detectSwings, type SwingPoint } from './swings';

export interface StructureEvent {
  /** BOS = ทะลุไปทางเดียวกับเทรนด์ (หรือการเบรกครั้งแรก) · CHoCH = ทะลุสวนเทรนด์ (ริวเรนเรียก MSS) */
  type: 'BOS' | 'CHoCH';
  /** bull = ทะลุ swing high ขึ้น · bear = ทะลุ swing low ลง */
  direction: 'bull' | 'bear';
  /** ราคาของ swing ที่ถูกทะลุ (= "เส้น BO" ของ Braron) */
  level: number;
  swingIndex: number;
  swingTime: number;
  breakIndex: number;
  breakTime: number;
  /** = breakIndex (รู้ผลตอนแท่งเบรกปิด) */
  confirmIndex: number;
  /** ฐานของขาที่เบรก: low ต่ำสุด (bull) / high สูงสุด (bear) ในช่วง [swingIndex, breakIndex] */
  originIndex: number;
  originPrice: number;
}

/**
 * โครงสร้างตลาด (docs/rules.md ชั้นที่ 1: BOS / CHoCH)
 * - ใช้ swing ที่ยืนยันแล้วล่าสุด ฝั่งละ 1 ตัว (swing ใหม่มาแทนตัวเก่า) — D11
 * - ทะลุตาม breakBy (D3: ค่าเริ่มต้นปิดทะลุ) · swing หนึ่งตัวถูกทะลุได้ครั้งเดียว
 * - เทรนด์ขึ้นแล้วทะลุ swing low = CHoCH ขาลง · เทรนด์ลงแล้วทะลุ swing high = CHoCH ขาขึ้น · นอกนั้น BOS
 * causal: ผลถึงแท่ง asOf ใช้แค่แท่ง 0..asOf
 */
export function detectStructure(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
  asOf: number = candles.length - 1,
): StructureEvent[] {
  const cfg = { ...DEFAULTS, ...config };
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;

  const byConfirm = new Map<number, SwingPoint[]>();
  for (const s of detectSwings(data, { swingLength: cfg.swingLength })) {
    const list = byConfirm.get(s.confirmIndex) ?? [];
    list.push(s);
    byConfirm.set(s.confirmIndex, list);
  }

  const events: StructureEvent[] = [];
  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;
  let trend: 'up' | 'down' | null = null;

  for (let i = 0; i < data.length; i++) {
    for (const s of byConfirm.get(i) ?? []) {
      if (s.kind === 'high') lastHigh = s;
      else lastLow = s;
    }
    const bar = data[i]!;
    const upPrice = cfg.breakBy === 'close' ? bar.close : bar.high;
    const downPrice = cfg.breakBy === 'close' ? bar.close : bar.low;

    if (lastHigh && upPrice > lastHigh.price) {
      const origin = extreme(data, lastHigh.pivotIndex, i, 'low');
      events.push(makeEvent(trend === 'down' ? 'CHoCH' : 'BOS', 'bull', lastHigh, i, bar.time, origin));
      trend = 'up';
      lastHigh = null;
    }
    if (lastLow && downPrice < lastLow.price) {
      const origin = extreme(data, lastLow.pivotIndex, i, 'high');
      events.push(makeEvent(trend === 'up' ? 'CHoCH' : 'BOS', 'bear', lastLow, i, bar.time, origin));
      trend = 'down';
      lastLow = null;
    }
  }
  return events;
}

function makeEvent(
  type: StructureEvent['type'],
  direction: StructureEvent['direction'],
  swing: SwingPoint,
  i: number,
  time: number,
  origin: { index: number; price: number },
): StructureEvent {
  return {
    type,
    direction,
    level: swing.price,
    swingIndex: swing.pivotIndex,
    swingTime: swing.time,
    breakIndex: i,
    breakTime: time,
    confirmIndex: i,
    originIndex: origin.index,
    originPrice: origin.price,
  };
}

/** low ต่ำสุด / high สูงสุด ในช่วง [from, to] (ถ้าเท่ากันเอาตัวหลังสุด = ใกล้แท่งเบรกที่สุด) */
function extreme(data: readonly Candle[], from: number, to: number, kind: 'low' | 'high') {
  let index = from;
  let price = kind === 'low' ? data[from]!.low : data[from]!.high;
  for (let k = from + 1; k <= to; k++) {
    const v = kind === 'low' ? data[k]!.low : data[k]!.high;
    if (kind === 'low' ? v <= price : v >= price) {
      index = k;
      price = v;
    }
  }
  return { index, price };
}
