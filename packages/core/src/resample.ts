import { TIMEFRAME_MS, type Candle, type Timeframe } from './types';

const DAY_MS = 24 * 60 * 60_000;
/** 1970-01-05 00:00 UTC เป็นวันจันทร์ — ใช้เป็นจุดตั้งต้นของแท่ง W1 */
const MONDAY_ANCHOR = 4 * DAY_MS;

/**
 * เวลาเปิดของแท่ง timeframe `tf` ที่ `time` ตกอยู่
 * - TF ต่ำกว่า D1 และ D1: ตัดตาม UTC (D1 เริ่ม 00:00 UTC — ดู D9 ใน docs/rules.md)
 * - W1: เริ่มวันจันทร์ 00:00 UTC
 */
export function bucketStart(time: number, tf: Timeframe): number {
  const ms = TIMEFRAME_MS[tf];
  if (tf === 'W1') return Math.floor((time - MONDAY_ANCHOR) / ms) * ms + MONDAY_ANCHOR;
  return Math.floor(time / ms) * ms;
}

/**
 * รวมแท่ง TF เล็กเป็น TF ใหญ่
 * - input ต้องเรียงตามเวลา (น้อย → มาก) และ TF ของ input ต้องเล็กกว่าหรือเท่ากับ `tf`
 * - ช่วงที่ไม่มีข้อมูล (ตลาดปิด / เสาร์อาทิตย์) จะไม่มีแท่ง ไม่เติมแท่งว่าง
 * - แท่งสุดท้ายอาจยังไม่ปิด (เช่น H4 ที่เพิ่งผ่านไป 1 ชม.) — ใช้ `isBucketClosed` ตรวจก่อนใช้ใน backtest
 */
export function resample(candles: readonly Candle[], tf: Timeframe): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;

  for (const c of candles) {
    const start = bucketStart(c.time, tf);
    if (cur && start === cur.time) {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.volume += c.volume;
    } else {
      if (cur && start < cur.time) {
        throw new Error(`resample: ข้อมูลไม่ได้เรียงตามเวลา (${c.time} มาหลัง bucket ${cur.time})`);
      }
      cur = { time: start, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      out.push(cur);
    }
  }
  return out;
}

/**
 * แท่ง TF ใหญ่ที่เปิดเวลา `bucketTime` ปิดแล้วหรือยัง ณ เวลา `now`
 * (กฎ no-look-ahead: ข้อมูล TF ใหญ่ใช้ได้หลังแท่งปิดเท่านั้น)
 */
export function isBucketClosed(bucketTime: number, tf: Timeframe, now: number): boolean {
  return now >= bucketTime + TIMEFRAME_MS[tf];
}
