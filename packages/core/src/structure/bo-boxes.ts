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
  const cfg = { ...DEFAULTS, ...config };
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;

  const byBreak = new Map<number, StructureEvent[]>();
  for (const e of detectStructure(data, cfg)) {
    const list = byBreak.get(e.breakIndex) ?? [];
    list.push(e);
    byBreak.set(e.breakIndex, list);
  }

  let boxes: (BoBox & { dead?: boolean })[] = [];
  for (let i = 0; i < data.length; i++) {
    const bar = data[i]!;
    for (const b of boxes) {
      if (b.dead || b.createdIndex >= i) continue;
      if (b.direction === 'bull' ? bar.close < b.bottom : bar.close > b.top) b.dead = true;
      else if (b.state === 'fresh' && bar.low <= b.top && bar.high >= b.bottom) b.state = 'tested';
    }
    for (const e of byBreak.get(i) ?? []) {
      const top = e.direction === 'bull' ? e.level : e.originPrice;
      const bottom = e.direction === 'bull' ? e.originPrice : e.level;
      if (top <= bottom) continue;
      boxes.push({
        id: `${e.direction}-${e.swingIndex}`,
        direction: e.direction,
        top,
        bottom,
        startTime: e.swingTime,
        createdIndex: i,
        state: 'fresh',
        eventType: e.type,
      });
    }
    if (boxes.length > 200) boxes = boxes.filter((b) => !b.dead);
  }
  return boxes.filter((b) => !b.dead).map(({ dead: _dead, ...b }) => b);
}
