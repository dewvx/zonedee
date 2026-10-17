import type { Candle } from '../types';

/**
 * Average True Range แบบ Wilder (RMA) เหมือน TradingView
 * - TR[0] = high - low, TR[i] = max(high-low, |high-prevClose|, |low-prevClose|)
 * - ค่าแรกที่ index period-1 = ค่าเฉลี่ยของ TR period ตัวแรก ก่อนหน้านั้นเป็น null
 * - causal: ค่าที่ i ใช้แค่แท่ง 0..i
 */
export function atr(candles: readonly Candle[], period = 14): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error(`atr: period ต้องเป็นจำนวนเต็ม >= 1 (ได้ ${period})`);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  let prev: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : null;
    const tr =
      prevClose === null
        ? c.high - c.low
        : Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));

    if (i < period) {
      sum += tr;
      if (i === period - 1) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = (prev! * (period - 1) + tr) / period;
      out[i] = prev;
    }
  }
  return out;
}
