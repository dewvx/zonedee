/**
 * Exponential Moving Average
 *
 * - ค่าแรกที่มีผล อยู่ที่ index = period - 1 (seed ด้วย SMA ของ period ตัวแรก) แบบเดียวกับ TradingView
 * - ก่อนหน้านั้นเป็น null
 * - เป็นฟังก์ชันแบบ causal: ค่าที่ index i ใช้ข้อมูลแค่ 0..i เท่านั้น (ไม่แอบดูอนาคต)
 *
 * ใช้ใน: ท่า 3 ของริวเรน (EMA 9 / EMA 21) — ดู docs/rules.md
 */
export function ema(values: readonly number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) {
    throw new Error(`ema: period ต้องเป็นจำนวนเต็ม >= 1 (ได้ ${period})`);
  }
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
