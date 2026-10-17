import { DEFAULTS, type DetectorConfig } from '../config';
import { atr } from '../indicators/atr';
import type { Candle } from '../types';
import { detectStructure, type StructureEvent } from './market-structure';

export interface OrderBlock {
  id: string;
  /** bull = OB ฝั่งซื้อ (แท่งแดงสุดท้ายก่อนวิ่งขึ้น) · bear = ฝั่งขาย */
  direction: 'bull' | 'bear';
  top: number;
  bottom: number;
  /** แท่งที่เป็น OB */
  index: number;
  startTime: number;
  /** แท่งที่รู้ว่าเป็น OB (แท่งที่เกิด BOS/CHoCH) */
  createdIndex: number;
  state: 'fresh' | 'tested';
}

/**
 * Order Block (docs/rules.md ชั้นที่ 1) 🟡 — D12
 * ทุก BOS/CHoCH: ไล่ย้อนจากฐานของขาที่เบรก (originIndex) ไปถึง swing หาแท่งสีตรงข้ามแท่งแรกที่เจอ
 * (bull: แท่งแดง · bear: แท่งเขียว) ไม่เจอใช้แท่งฐาน · โซน = high..low ของแท่งนั้น
 * นับเมื่อวิ่งแรงพอ: |close แท่งเบรก − ขอบ OB ฝั่งไกล| ≥ obImpulseAtr × ATR
 * ทิ้งเมื่อปิดทะลุขอบล่าง (bull) / ขอบบน (bear) · คืนเฉพาะ OB ที่ยังไม่ถูกทะลุ ณ แท่ง asOf
 */
export function detectOrderBlocks(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
  asOf: number = candles.length - 1,
): OrderBlock[] {
  const cfg = { ...DEFAULTS, ...config };
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;
  const atrs = atr(data, cfg.atrPeriod);

  const byBreak = new Map<number, StructureEvent[]>();
  for (const e of detectStructure(data, cfg)) {
    const list = byBreak.get(e.breakIndex) ?? [];
    list.push(e);
    byBreak.set(e.breakIndex, list);
  }

  let obs: (OrderBlock & { dead?: boolean })[] = [];
  for (let i = 0; i < data.length; i++) {
    const bar = data[i]!;
    for (const ob of obs) {
      if (ob.dead || ob.createdIndex >= i) continue;
      if (ob.direction === 'bull' ? bar.close < ob.bottom : bar.close > ob.top) ob.dead = true;
      else if (ob.state === 'fresh' && bar.low <= ob.top && bar.high >= ob.bottom) ob.state = 'tested';
    }
    for (const e of byBreak.get(i) ?? []) {
      const k = findObCandle(data, e);
      const c = data[k]!;
      const impulse = e.direction === 'bull' ? bar.close - c.low : c.high - bar.close;
      const a = atrs[i];
      if (cfg.obImpulseAtr > 0 && (a == null || impulse < cfg.obImpulseAtr * a)) continue;
      obs.push({
        id: `ob-${e.direction}-${k}`,
        direction: e.direction,
        top: c.high,
        bottom: c.low,
        index: k,
        startTime: c.time,
        createdIndex: i,
        state: 'fresh',
      });
    }
    if (obs.length > 200) obs = obs.filter((o) => !o.dead);
  }
  return obs.filter((o) => !o.dead).map(({ dead: _dead, ...o }) => o);
}

function findObCandle(data: readonly Candle[], e: StructureEvent): number {
  for (let k = e.originIndex; k >= e.swingIndex; k--) {
    const c = data[k]!;
    if (e.direction === 'bull' ? c.close < c.open : c.close > c.open) return k;
  }
  return e.originIndex;
}
