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
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;
  return detectOrderBlockHistory(data, config)
    .filter((o) => o.brokenIndex === null)
    .map(({ testedIndex, brokenIndex: _b, ...o }) => ({ ...o, state: testedIndex === null ? 'fresh' : 'tested' }));
}

/** OB พร้อมประวัติ (ใช้ในท่าเทรด/backtest) */
export interface OrderBlockLife extends Omit<OrderBlock, 'state'> {
  testedIndex: number | null;
  /** แท่งที่ปิดทะลุ OB = ทิ้ง */
  brokenIndex: number | null;
}

/** OB ทุกตัวที่เคยเกิด พร้อมแท่งที่ถูกแตะ/ถูกทะลุ — causal */
export function detectOrderBlockHistory(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
): OrderBlockLife[] {
  const cfg = { ...DEFAULTS, ...config };
  const atrs = atr(candles, cfg.atrPeriod);
  const byBreak = new Map<number, StructureEvent[]>();
  for (const e of detectStructure(candles, cfg)) {
    const list = byBreak.get(e.breakIndex) ?? [];
    list.push(e);
    byBreak.set(e.breakIndex, list);
  }

  const all: OrderBlockLife[] = [];
  let alive: OrderBlockLife[] = [];
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i]!;
    for (const ob of alive) {
      if (ob.createdIndex >= i) continue;
      if (ob.direction === 'bull' ? bar.close < ob.bottom : bar.close > ob.top) ob.brokenIndex = i;
      else if (ob.testedIndex === null && bar.low <= ob.top && bar.high >= ob.bottom) ob.testedIndex = i;
    }
    alive = alive.filter((o) => o.brokenIndex === null);
    for (const e of byBreak.get(i) ?? []) {
      const k = findObCandle(candles, e);
      const c = candles[k]!;
      const impulse = e.direction === 'bull' ? bar.close - c.low : c.high - bar.close;
      const a = atrs[i];
      if (cfg.obImpulseAtr > 0 && (a == null || impulse < cfg.obImpulseAtr * a)) continue;
      const ob: OrderBlockLife = {
        id: `ob-${e.direction}-${k}`,
        direction: e.direction,
        top: c.high,
        bottom: c.low,
        index: k,
        startTime: c.time,
        createdIndex: i,
        testedIndex: null,
        brokenIndex: null,
      };
      all.push(ob);
      alive.push(ob);
    }
  }
  return all;
}

function findObCandle(data: readonly Candle[], e: StructureEvent): number {
  for (let k = e.originIndex; k >= e.swingIndex; k--) {
    const c = data[k]!;
    if (e.direction === 'bull' ? c.close < c.open : c.close > c.open) return k;
  }
  return e.originIndex;
}
