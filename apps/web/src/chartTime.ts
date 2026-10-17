import type { UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@zonedee/core';

/**
 * core ใช้ UTC ms แต่ Lightweight Charts ใช้วินาที และวาดแกนเวลาเป็น UTC เสมอ
 * วิธีที่ไลบรารีแนะนำคือเลื่อนเวลาไปเป็นเวลาท้องถิ่นก่อนส่งเข้ากราฟ — ไทย UTC+7 ไม่มี DST เลยบวกคงที่ได้
 * ผลคือทั้งแกนล่าง, crosshair และเส้นแบ่งวัน เป็นเวลาไทยตรงกันหมด
 * แปลงตรงนี้ที่เดียว (ข้อมูลจริงยังเป็น UTC ms ทั้งโปรเจกต์)
 */
const DISPLAY_OFFSET_MS = 7 * 60 * 60_000;
export const toChartTime = (ms: number) => Math.floor((ms + DISPLAY_OFFSET_MS) / 1000) as UTCTimestamp;
export const fromChartTime = (t: number) => t * 1000 - DISPLAY_OFFSET_MS;

/**
 * เวลาของแท่งแรกที่ ≥ ms (ไม่มี → แท่งสุดท้าย)
 * ใช้ตอนวาดสิ่งที่มาจาก TF อื่น (เช่นกรอบ Bo ของ M30 บนกราฟ M5) เพราะกราฟหาพิกัดได้เฉพาะเวลาที่มีแท่งจริง
 */
export function snapTime(candles: readonly Candle[], ms: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  if (hi < 0) return ms;
  if (ms <= candles[0]!.time) return candles[0]!.time;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.time < ms) lo = mid + 1;
    else hi = mid;
  }
  return candles[lo]!.time;
}
