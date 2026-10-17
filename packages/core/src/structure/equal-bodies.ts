import type { Candle } from '../types';

const bodyTop = (c: Candle) => Math.max(c.open, c.close);
const bodyBottom = (c: Candle) => Math.min(c.open, c.close);

/**
 * กฎ "เนื้อเท่ากัน 2 แท่ง" ของริวเรน ที่ยอด/ก้นของ swing (docs/rules.md ชั้นที่ 1)
 * ดูคู่แท่งติดกัน (pivot-1, pivot) และ (pivot, pivot+1):
 * - ยอด: แท่งเขียวปิด ≈ แท่งแดงถัดไปเปิด (เนื้อชนกันตรงยอด) หรือขอบบนของเนื้อเท่ากัน
 * - ก้น: แท่งแดงปิด ≈ แท่งเขียวถัดไปเปิด หรือขอบล่างของเนื้อเท่ากัน
 * `tol` เป็นหน่วยราคา (ผู้เรียกคำนวณจาก equalTolAtr × ATR)
 * ใช้แท่ง pivot+1 ซึ่งไม่เกิน confirmIndex ของ swing (swingLength ≥ 1) จึงไม่แอบดูอนาคต
 */
export function hasEqualBodiesAtPivot(
  candles: readonly Candle[],
  pivotIndex: number,
  kind: 'high' | 'low',
  tol: number,
): boolean {
  for (const a of [pivotIndex - 1, pivotIndex]) {
    const first = candles[a];
    const second = candles[a + 1];
    if (!first || !second) continue;
    if (kind === 'high') {
      const junction = first.close > first.open && second.close < second.open && Math.abs(first.close - second.open) <= tol;
      if (junction || Math.abs(bodyTop(first) - bodyTop(second)) <= tol) return true;
    } else {
      const junction = first.close < first.open && second.close > second.open && Math.abs(first.close - second.open) <= tol;
      if (junction || Math.abs(bodyBottom(first) - bodyBottom(second)) <= tol) return true;
    }
  }
  return false;
}
