import { describe, expect, it } from 'vitest';
import { rsi } from '../src/indicators/rsi';
import { sma } from '../src/indicators/sma';
import { scanStock } from '../src/scan/stock-scan';
import { watchMetrics } from '../src/scan/watch-metrics';
import type { Candle } from '../src/types';

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);
const day = (i: number, open: number, high: number, low: number, close: number, volume = 1_000_000): Candle => ({
  time: T0 + i * DAY,
  open,
  high,
  low,
  close,
  volume,
});

describe('sma / rsi', () => {
  it('sma 3 วัน', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it('rsi: ขึ้นอย่างเดียว 100 · ลงอย่างเดียว 0 · สลับเท่ากัน 50', () => {
    const up = Array.from({ length: 20 }, (_, i) => i);
    expect(rsi(up, 14).at(-1)).toBe(100);
    expect(rsi(up.map((x) => -x), 14).at(-1)).toBe(0);
    const zig = Array.from({ length: 30 }, (_, i) => (i % 2 ? 1 : 0));
    expect(rsi(zig, 14)[14]).toBeCloseTo(50, 0);
    expect(rsi(up, 14)[13]).toBeNull();
  });
  it('ไม่แอบดูอนาคต: คำนวณจากข้อมูลบางส่วน = ข้อมูลทั้งหมด', () => {
    const v = Array.from({ length: 60 }, (_, i) => Math.sin(i / 3) * 10 + i);
    const full = rsi(v, 14);
    expect(rsi(v.slice(0, 40), 14)).toEqual(full.slice(0, 40));
    expect(sma(v.slice(0, 40), 10)).toEqual(sma(v, 10).slice(0, 40));
  });
});

describe('scanStock (หุ้นซิ่ง)', () => {
  // 20 วันไซด์เวย์ 9.5–10.5 volume 1M แล้ววันสุดท้ายเปิด gap +6% ปิดทะลุกรอบ volume 5M
  const base = Array.from({ length: 21 }, (_, i) => day(i, 10, 10.5, 9.5, 10));
  const pop = [...base, day(21, 10.6, 11.8, 10.5, 11.5, 5_000_000)];

  it('จับได้ทั้ง volume พุ่ง, gap และทะลุ high 20 วัน', () => {
    const s = scanStock(pop)!;
    expect(s.relVolume).toBeCloseTo(5);
    expect(s.gapPct).toBeCloseTo(6);
    expect(s.changePct).toBeCloseTo(15);
    expect(s.priorHigh).toBe(10.5);
    expect(s.breakout).toBe(true);
    expect(s.signals).toEqual(expect.arrayContaining(['volume', 'gap', 'breakout']));
    expect(s.passes).toBe(true);
  });

  it('วันธรรมดา → ไม่มีสัญญาณ · ราคาเกินช่วง/สภาพคล่องต่ำ → passes = false', () => {
    const quiet = [...base, day(21, 10, 10.4, 9.8, 10.1, 900_000)];
    expect(scanStock(quiet)!.signals).toEqual([]);
    expect(scanStock(pop, { maxPrice: 5 })!.passes).toBe(false);
    expect(scanStock(pop, { minAvgDollarVolume: 50_000_000 })!.passes).toBe(false);
  });

  it('ข้อมูลไม่พอ → null', () => {
    expect(scanStock(base.slice(0, 10))).toBeNull();
  });
});

describe('watchMetrics (ลงทุนระยะยาว)', () => {
  // 400 วัน ราคาขึ้นวันละ 0.1 จาก 100
  const up = Array.from({ length: 400 }, (_, i) => day(i, 100 + i * 0.1, 100 + i * 0.1 + 0.5, 100 + i * 0.1 - 0.5, 100 + i * 0.1));
  const m = watchMetrics(up)!;

  it('เปลี่ยนแปลงย้อนหลังตามปฏิทิน', () => {
    expect(m.close).toBeCloseTo(139.9);
    expect(m.change1d).toBeCloseTo(((139.9 - 139.8) / 139.8) * 100);
    expect(m.change1w).toBeCloseTo(((139.9 - 139.2) / 139.2) * 100);
    expect(m.change1y).toBeCloseTo(((139.9 - 103.4) / 103.4) * 100);
  });

  it('high/low 52 สัปดาห์ + SMA + RSI', () => {
    expect(m.high52).toBeCloseTo(140.4);
    expect(m.fromHigh52Pct).toBeLessThan(0);
    expect(m.sma50).toBeCloseTo(139.9 - 2.45);
    expect(m.sma200).toBeCloseTo(139.9 - 9.95);
    expect(m.rsi14).toBe(100);
  });

  it('YTD นับจากราคาปิดวันสุดท้ายของปีก่อน', () => {
    // แท่งสุดท้าย = 2026-02-04 (วันที่ 399) → ฐาน YTD = 2025-12-31 (วันที่ 364)
    expect(m.changeYtd).toBeCloseTo(((139.9 - 136.4) / 136.4) * 100);
  });

  it('ข้อมูลสั้น → ค่าที่คิดไม่ได้เป็น null', () => {
    const short = watchMetrics(up.slice(0, 20))!;
    expect(short.change1y).toBeNull();
    expect(short.sma200).toBeNull();
  });
});
