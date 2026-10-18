import { resample } from './resample';
import { TIMEFRAME_MS, type Candle, type Timeframe } from './types';

export interface HtfView {
  tf: Timeframe;
  candles: Candle[];
  /**
   * availableAt[j] = index ของแท่ง LTF แรกที่ "ปิดแล้ว" หลังจากแท่ง HTF j ปิด
   * (ใช้ข้อมูลของแท่ง HTF j ได้ตั้งแต่แท่ง LTF นี้เป็นต้นไป) · Infinity = ยังไม่ปิดภายในข้อมูลที่มี
   */
  availableAt: number[];
}

/**
 * มุมมอง TF ใหญ่จากแท่ง TF เล็ก พร้อมตารางว่าแท่ง TF ใหญ่แต่ละแท่ง "ใช้ได้" ตั้งแต่แท่ง TF เล็กไหน
 * กฎ no-look-ahead: แท่ง HTF ใช้ได้เมื่อมีแท่ง LTF ที่ปิดหลังเวลาปิดของแท่ง HTF นั้นแล้ว
 * (ช่วงตลาดปิด/วันหยุด → รอแท่ง LTF แรกหลังช่วงนั้น ซึ่งช้ากว่าจริงนิดหน่อยแต่ไม่มีทางโกง)
 */
export function htfView(ltf: readonly Candle[], ltfTf: Timeframe, htfTf: Timeframe): HtfView {
  const candles = resample(ltf, htfTf);
  const ltfMs = TIMEFRAME_MS[ltfTf];
  const htfMs = TIMEFRAME_MS[htfTf];
  const availableAt = candles.map((h) => {
    const closeTime = h.time + htfMs;
    // แท่ง LTF แรกที่เวลาปิด (time + ltfMs) ≥ เวลาปิดของแท่ง HTF
    let lo = 0;
    let hi = ltf.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ltf[mid]!.time + ltfMs < closeTime) lo = mid + 1;
      else hi = mid;
    }
    return lo < ltf.length ? lo : Infinity;
  });
  return { tf: htfTf, candles, availableAt };
}

/** index ของแท่ง HTF ล่าสุดที่ปิดแล้ว ณ แท่ง LTF i (-1 = ยังไม่มี) */
export function lastClosedHtf(view: HtfView, i: number): number {
  let lo = 0;
  let hi = view.availableAt.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (view.availableAt[mid]! <= i) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
