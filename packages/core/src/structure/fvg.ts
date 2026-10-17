import { DEFAULTS, type DetectorConfig } from '../config';
import { atr } from '../indicators/atr';
import type { Candle } from '../types';

export interface FVG {
  id: string;
  /** bull: high[i-2] < low[i] · bear: low[i-2] > high[i] */
  direction: 'bull' | 'bear';
  top: number;
  bottom: number;
  /** แท่งแรกของ 3 แท่ง (ขอบซ้ายตอนวาด) */
  startIndex: number;
  startTime: number;
  /** แท่งที่ 3 — รู้ว่ามีช่องตอนแท่งนี้ปิด */
  confirmIndex: number;
  /** open = ยังไม่มีใครเข้ามา · partial = ราคาเข้ามาบางส่วน · filled = ปิดช่องหมดแล้ว */
  state: 'open' | 'partial' | 'filled';
  filledIndex: number | null;
}

/**
 * Fair Value Gap (docs/rules.md ชั้นที่ 1) ✅
 * ช่องต้องกว้าง ≥ fvgMinAtr × ATR (ATR ณ แท่งที่ 3) · สถานะ ณ แท่ง asOf
 * คืนทุกช่อง (รวมที่ filled แล้ว) เรียงตามเวลาที่เกิด — ผู้เรียกกรองเองว่าจะแสดงแบบไหน
 */
export function detectFVGs(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
  asOf: number = candles.length - 1,
): FVG[] {
  const cfg = { ...DEFAULTS, ...config };
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;
  const atrs = atr(data, cfg.atrPeriod);

  const gaps: FVG[] = [];
  const active: FVG[] = [];

  for (let i = 0; i < data.length; i++) {
    const bar = data[i]!;

    // อัปเดตช่องที่ยังไม่เต็ม
    for (let g = active.length - 1; g >= 0; g--) {
      const f = active[g]!;
      if (f.direction === 'bull') {
        if (bar.low <= f.bottom) fill(f, i);
        else if (bar.low < f.top) f.state = 'partial';
      } else {
        if (bar.high >= f.top) fill(f, i);
        else if (bar.high > f.bottom) f.state = 'partial';
      }
      if (f.state === 'filled') active.splice(g, 1);
    }

    if (i < 2) continue;
    const first = data[i - 2]!;
    const minSize = cfg.fvgMinAtr > 0 ? (atrs[i] == null ? Infinity : cfg.fvgMinAtr * atrs[i]!) : 0;
    let gap: FVG | null = null;
    if (first.high < bar.low && bar.low - first.high >= minSize) {
      gap = mk('bull', bar.low, first.high, i, first.time);
    } else if (first.low > bar.high && first.low - bar.high >= minSize) {
      gap = mk('bear', first.low, bar.high, i, first.time);
    }
    if (gap) {
      gaps.push(gap);
      active.push(gap);
    }
  }
  return gaps;
}

function mk(direction: FVG['direction'], top: number, bottom: number, i: number, startTime: number): FVG {
  return {
    id: `fvg-${direction}-${i}`,
    direction,
    top,
    bottom,
    startIndex: i - 2,
    startTime,
    confirmIndex: i,
    state: 'open',
    filledIndex: null,
  };
}

function fill(f: FVG, i: number) {
  f.state = 'filled';
  f.filledIndex = i;
}
