import type { Candle } from './types';

/**
 * รวมแท่งชุดใหม่เข้ากับชุดเดิม
 * - เวลาซ้ำกัน: ใช้แท่งจากชุดใหม่ (เช่น แท่งล่าสุดที่ยังไม่ปิดถูกอัปเดต)
 * - ผลลัพธ์เรียงตามเวลา ไม่มีเวลาซ้ำ ไม่แก้ไข input
 * ใช้ตอนโหลดย้อนหลังเพิ่ม (prepend) และตอนอัปเดตแท่งล่าสุด (append)
 */
export function mergeCandles(existing: readonly Candle[], incoming: readonly Candle[]): Candle[] {
  if (incoming.length === 0) return [...existing];
  if (existing.length === 0) return dedupeSorted(incoming);

  const byTime = new Map<number, Candle>();
  for (const c of existing) byTime.set(c.time, c);
  for (const c of incoming) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function dedupeSorted(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
