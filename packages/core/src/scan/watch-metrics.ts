import { rsi } from '../indicators/rsi';
import { sma } from '../indicators/sma';
import type { Candle } from '../types';

const DAY = 86_400_000;

export interface WatchMetrics {
  lastTime: number;
  close: number;
  /** % เปลี่ยนแปลง (null = ข้อมูลไม่ถึง) */
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  change3m: number | null;
  changeYtd: number | null;
  change1y: number | null;
  high52: number;
  low52: number;
  /** ห่างจาก high 52 สัปดาห์กี่ % (≤ 0) */
  fromHigh52Pct: number;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
}

/** ราคาปิดของแท่งล่าสุดที่เวลา ≤ t (ค้นแบบ binary) */
function closeAtOrBefore(candles: readonly Candle[], t: number): number | null {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? candles[ans]!.close : null;
}

/**
 * ตัวเลขสำหรับหน้า watchlist ลงทุนระยะยาว (D1) — ข้อมูลเฉยๆ ไม่ใช่คำแนะนำซื้อขาย
 * ช่วงเวลานับตามปฏิทิน (1w = 7 วัน, 1m = 30, 3m = 91, 1y = 365) จากแท่งล่าสุด
 */
export function watchMetrics(candles: readonly Candle[]): WatchMetrics | null {
  const n = candles.length;
  if (n < 2) return null;
  const last = candles[n - 1]!;
  const pct = (from: number | null) => (from === null || from <= 0 ? null : ((last.close - from) / from) * 100);
  const back = (days: number) => (candles[0]!.time <= last.time - days * DAY ? closeAtOrBefore(candles, last.time - days * DAY) : null);
  const y = new Date(last.time).getUTCFullYear();
  const yearStart = Date.UTC(y, 0, 1);
  const ytdBase = candles[0]!.time < yearStart ? closeAtOrBefore(candles, yearStart - 1) : null;

  let high52 = -Infinity;
  let low52 = Infinity;
  for (let k = n - 1; k >= 0 && candles[k]!.time > last.time - 365 * DAY; k--) {
    high52 = Math.max(high52, candles[k]!.high);
    low52 = Math.min(low52, candles[k]!.low);
  }
  const closes = candles.map((c) => c.close);
  return {
    lastTime: last.time,
    close: last.close,
    change1d: pct(candles[n - 2]!.close),
    change1w: pct(back(7)),
    change1m: pct(back(30)),
    change3m: pct(back(91)),
    changeYtd: pct(ytdBase),
    change1y: pct(back(365)),
    high52,
    low52,
    fromHigh52Pct: ((last.close - high52) / high52) * 100,
    sma50: n >= 50 ? (sma(closes.slice(-50), 50).at(-1) ?? null) : null,
    sma200: n >= 200 ? (sma(closes.slice(-200), 200).at(-1) ?? null) : null,
    rsi14: rsi(closes.slice(-300), 14).at(-1) ?? null,
  };
}
