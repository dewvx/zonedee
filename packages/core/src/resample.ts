import { TIMEFRAME_MS, type Candle, type Timeframe } from './types';

const DAY_MS = 24 * 60 * 60_000;
/** 1970-01-05 00:00 UTC เป็นวันจันทร์ — ใช้เป็นจุดตั้งต้นของแท่ง W1 */
const MONDAY_ANCHOR = 4 * DAY_MS;

/**
 * เวลาตัดแท่ง Daily:
 * - 'utc': ตัดที่ 00:00 UTC (ค่าเดิมตามข้อ D9 ใน docs/rules.md)
 * - 'ny-close': ตัดตอน New York Close (17:00 NY / ตี 4 ช่วงฤดูร้อน หรือ ตี 5 ช่วงฤดูหนาวในไทย — ตรงกับ MT5 ของ XM)
 */
export type D1Cutoff = 'utc' | 'ny-close';

/**
 * ตรวจสอบว่าเวลา UTC ms อยู่ในช่วง US Daylight Saving Time (EDT) หรือไม่
 * ตามกฎของสหรัฐฯ:
 * - เริ่ม: วันอาทิตย์ที่ 2 ของเดือนมีนาคม เวลา 02:00 EST (07:00 UTC)
 * - สิ้นสุด: วันอาทิตย์แรกของเดือนพฤศจิกายน เวลา 02:00 EDT (06:00 UTC)
 */
export function isUsDst(timeMs: number): boolean {
  const d = new Date(timeMs);
  const year = d.getUTCFullYear();

  // อาทิตย์ที่ 2 ของ มี.ค.
  const march1 = new Date(Date.UTC(year, 2, 1));
  const firstSunMarch = 1 + ((7 - march1.getUTCDay()) % 7);
  const secondSunMarch = firstSunMarch + 7;
  const dstStart = Date.UTC(year, 2, secondSunMarch, 7, 0, 0);

  // อาทิตย์แรกของ พ.ย.
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstSunNov = 1 + ((7 - nov1.getUTCDay()) % 7);
  const dstEnd = Date.UTC(year, 10, firstSunNov, 6, 0, 0);

  return timeMs >= dstStart && timeMs < dstEnd;
}

/**
 * เวลาเปิดของแท่ง D1 แบบ New York Close (17:00 NY)
 * - ช่วง EDT (ฤดูร้อน): 17:00 NY คือ 21:00 UTC
 * - ช่วง EST (ฤดูหนาว): 17:00 NY คือ 22:00 UTC
 *
 * หากเวลา timeMs อยู่ก่อนเวลา cutoff ของวันนั้น (เช่น 10:00 UTC)
 * แท่งนี้จะเปิดตั้งแต่เวลา cutoff ของวันก่อนหน้า
 */
export function nyCloseBucketStart(timeMs: number): number {
  const d = new Date(timeMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const dt = d.getUTCDate();

  const testT = Date.UTC(y, m, dt, 21, 30, 0);
  const cutoffHour = isUsDst(testT) ? 21 : 22;
  const todayCutoff = Date.UTC(y, m, dt, cutoffHour, 0, 0);

  if (timeMs >= todayCutoff) {
    return todayCutoff;
  } else {
    const yestTestT = Date.UTC(y, m, dt - 1, 21, 30, 0);
    const yestCutoffHour = isUsDst(yestTestT) ? 21 : 22;
    return Date.UTC(y, m, dt - 1, yestCutoffHour, 0, 0);
  }
}

/**
 * เวลาเปิดของแท่ง timeframe `tf` ที่ `time` ตกอยู่
 * - TF ต่ำกว่า D1 และ D1: ตัดตาม UTC หรือ NY Close (D1 เริ่ม 00:00 UTC หรือ 17:00 NY — ดู D9 ใน docs/rules.md)
 * - W1: เริ่มวันจันทร์ 00:00 UTC
 */
export function bucketStart(time: number, tf: Timeframe, cutoff: D1Cutoff = 'utc'): number {
  if (tf === 'D1' && cutoff === 'ny-close') {
    return nyCloseBucketStart(time);
  }
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
export function resample(
  candles: readonly Candle[],
  tf: Timeframe,
  cutoff: D1Cutoff = 'utc',
): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;

  for (const c of candles) {
    const start = bucketStart(c.time, tf, cutoff);
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
export function isBucketClosed(
  bucketTime: number,
  tf: Timeframe,
  now: number,
  cutoff: D1Cutoff = 'utc',
): boolean {
  if (tf === 'D1' && cutoff === 'ny-close') {
    return now >= bucketTime + DAY_MS;
  }
  return now >= bucketTime + TIMEFRAME_MS[tf];
}
