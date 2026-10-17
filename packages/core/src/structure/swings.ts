import type { Candle } from '../types';

export interface SwingPoint {
  kind: 'high' | 'low';
  /** แท่งที่เป็นยอด/ก้น */
  pivotIndex: number;
  /** แท่งที่รู้ว่าเป็น swing ได้จริง = pivotIndex + swingLength (ห้ามใช้ก่อนแท่งนี้) */
  confirmIndex: number;
  /** ราคา high (swing high) หรือ low (swing low) ของแท่ง pivot */
  price: number;
  time: number;
}

/**
 * Swing high = แท่งที่ high สูงกว่า N แท่งซ้ายทุกแท่ง (strict) และไม่ต่ำกว่า N แท่งขวา
 * (ยอดเท่ากันติดกันนับตัวแรกตัวเดียว) — swing low กลับด้าน
 * ผลเรียงตาม confirmIndex แล้วตาม pivotIndex
 * D1 ใน rules.md: N = swingLength
 */
export function detectSwings(candles: readonly Candle[], opts: { swingLength: number }): SwingPoint[] {
  const n = opts.swingLength;
  if (!Number.isInteger(n) || n < 1) throw new Error(`detectSwings: swingLength ต้องเป็นจำนวนเต็ม >= 1 (ได้ ${n})`);
  const out: SwingPoint[] = [];

  for (let j = n; j + n < candles.length; j++) {
    const c = candles[j]!;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= n && (isHigh || isLow); k++) {
      const left = candles[j - k]!;
      const right = candles[j + k]!;
      if (!(c.high > left.high && c.high >= right.high)) isHigh = false;
      if (!(c.low < left.low && c.low <= right.low)) isLow = false;
    }
    if (isHigh) out.push({ kind: 'high', pivotIndex: j, confirmIndex: j + n, price: c.high, time: c.time });
    if (isLow) out.push({ kind: 'low', pivotIndex: j, confirmIndex: j + n, price: c.low, time: c.time });
  }
  return out;
}
