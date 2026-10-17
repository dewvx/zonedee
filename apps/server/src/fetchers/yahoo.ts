import YahooFinance from 'yahoo-finance2';
import { TIMEFRAME_MS, bucketStart, type Candle, type Timeframe } from '@zonedee/core';

export interface YahooQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

const INTERVAL: Partial<Record<Timeframe, '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk'>> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  D1: '1d',
  W1: '1wk',
};

/**
 * แปลง quotes ของ Yahoo เป็น Candle
 * - ปัดเวลาให้ตรง bucket ของ TF (Yahoo รายวันให้เวลาเปิดตลาด เช่น 13:30 UTC → 00:00 UTC)
 * - ตัดแถว null ทิ้ง (วันหยุด / ช่วงไม่มีเทรด)
 * - หุ้น: ราคาปรับ split แล้ว แต่ไม่ได้ปรับปันผล · forex: volume = 0
 */
export function mapYahooQuotes(quotes: readonly YahooQuote[], tf: Timeframe): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const q of quotes) {
    if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
    if (!(q.open > 0 && q.high > 0 && q.low > 0 && q.close > 0)) continue;
    const time = bucketStart(q.date.getTime(), tf);
    // แถวซ้ำเวลาเดียวกัน (Yahoo ชอบส่งแท่งปัจจุบันมาซ้ำ) ใช้แถวหลังสุด
    byTime.set(time, {
      time,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

let client: InstanceType<typeof YahooFinance> | null = null;

/** ดึงแท่งจาก Yahoo Finance ช่วง [from, to) */
export async function fetchYahoo(symbol: string, tf: Timeframe, from: Date, to: Date): Promise<Candle[]> {
  const interval = INTERVAL[tf];
  if (!interval) throw new Error(`Yahoo ไม่มี interval สำหรับ ${tf}`);
  client ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  // ขยาย period2 ไปอีก 1 แท่ง ให้ได้แท่งล่าสุดที่ยังไม่ปิดด้วย
  const result = await client.chart(symbol, {
    period1: from,
    period2: new Date(to.getTime() + TIMEFRAME_MS[tf]),
    interval,
  });
  return mapYahooQuotes(result.quotes, tf);
}
