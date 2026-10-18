/** Simple moving average — คืนยาวเท่า input (ช่วงที่ยังไม่ครบ period = null) */
export function sma(values: readonly number[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period < 1) throw new Error(`sma: period ต้องเป็นจำนวนเต็ม >= 1 (ได้ ${period})`);
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
