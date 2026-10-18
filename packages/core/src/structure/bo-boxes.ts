import { DEFAULTS, type DetectorConfig } from '../config';
import type { Candle } from '../types';
import { detectStructure, type StructureEvent } from './market-structure';

export interface BoBox {
  id: string;
  /** bull = Bo buy (กรอบเขียว) · bear = Bo sell (กรอบแดง) */
  direction: 'bull' | 'bear';
  top: number;
  bottom: number;
  /** ขอบซ้าย = เวลาของ swing ที่ถูกเบรก */
  startTime: number;
  /** แท่งที่กรอบเกิด (แท่งเบรก) */
  createdIndex: number;
  /** fresh = ราคายังไม่กลับมา · tested = ราคากลับมาแตะกรอบแล้ว */
  state: 'fresh' | 'tested';
  eventType: StructureEvent['type'];
}

/**
 * กรอบ Bo buy / Bo sell ของ Braron (docs/rules.md ชั้นที่ 3, D5 ✅)
 * - Bo buy: ขอบบน = swing high ที่ถูกเบรก · ขอบล่าง = ฐานของขาที่เบรก (low ต่ำสุดระหว่าง swing กับแท่งเบรก)
 * - Bo sell: กลับด้าน
 * - หมดอายุเมื่อปิดทะลุขอบล่าง (buy) / ขอบบน (sell) — คืนเฉพาะกรอบที่ยังไม่หมดอายุ ณ แท่ง asOf
 * กรอบนี้คือกรอบของ TF ที่ส่งเข้ามา — การรวม 3 TF (เขียว 2 แดง 1) เป็นงานของชั้นท่าเทรด
 */
export function detectBoBoxes(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
  asOf: number = candles.length - 1,
): BoBox[] {
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;
  return detectBoBoxHistory(data, config)
    .filter((b) => b.expiredIndex === null)
    .map(({ testedIndex, expiredIndex: _e, ...b }) => ({ ...b, state: testedIndex === null ? 'fresh' : 'tested' }));
}

/** กรอบ Bo พร้อมประวัติ (ใช้ในท่าเทรด/backtest) */
export interface BoBoxLife extends Omit<BoBox, 'state'> {
  /** แท่งแรกที่ราคากลับมาแตะกรอบ (null = ยังไม่แตะ) */
  testedIndex: number | null;
  /** แท่งที่ปิดทะลุฝั่งตรงข้าม = หมดอายุ (null = ยังใช้ได้) */
  expiredIndex: number | null;
}

/**
 * กรอบ Bo ทุกกรอบที่เคยเกิด พร้อมแท่งที่ถูกแตะ/หมดอายุ — causal: ข้อมูลของกรอบ ณ แท่ง i
 * ดูได้จาก createdIndex ≤ i และเทียบ testedIndex/expiredIndex กับ i
 */
export function detectBoBoxHistory(candles: readonly Candle[], config: Partial<DetectorConfig> = {}): BoBoxLife[] {
  const cfg = { ...DEFAULTS, ...config };
  const byBreak = new Map<number, StructureEvent[]>();
  for (const e of detectStructure(candles, cfg)) {
    const list = byBreak.get(e.breakIndex) ?? [];
    list.push(e);
    byBreak.set(e.breakIndex, list);
  }

  const all: BoBoxLife[] = [];
  let alive: BoBoxLife[] = [];
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;
    for (const b of alive) {
      if (b.createdIndex >= i) continue;
      if (b.direction === 'bull' ? bar.close < b.bottom : bar.close > b.top) b.expiredIndex = i;
      else if (b.testedIndex === null && bar.low <= b.top && bar.high >= b.bottom) b.testedIndex = i;
    }
    alive = alive.filter((b) => b.expiredIndex === null);
    for (const e of byBreak.get(i) ?? []) {
      const top = e.direction === 'bull' ? e.level : e.originPrice;
      const bottom = e.direction === 'bull' ? e.originPrice : e.level;
      if (top <= bottom) continue;
      const box: BoBoxLife = {
        id: `${e.direction}-${e.swingIndex}`,
        direction: e.direction,
        top,
        bottom,
        startTime: e.swingTime,
        createdIndex: i,
        eventType: e.type,
        testedIndex: null,
        expiredIndex: null,
      };
      all.push(box);
      alive.push(box);
    }
  }
  return all;
}
