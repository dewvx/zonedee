import { describe, expect, it } from 'vitest';
import { bucketStart, isBucketClosed, resample } from '../src/resample';
import { generateSampleCandles } from '../src/sample-data';
import { TIMEFRAME_MS, type Candle } from '../src/types';

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const t0 = Date.UTC(2026, 9, 12); // จันทร์ 12 ต.ค. 2026 00:00 UTC

const c = (time: number, o: number, h: number, l: number, cl: number, v = 1): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: v,
});

describe('bucketStart', () => {
  it('M15 ตัดทุก 15 นาที', () => {
    expect(bucketStart(t0 + 14 * M, 'M15')).toBe(t0);
    expect(bucketStart(t0 + 15 * M, 'M15')).toBe(t0 + 15 * M);
  });

  it('H4 ตัดที่ 00/04/08/... UTC', () => {
    expect(bucketStart(t0 + 5 * H + 30 * M, 'H4')).toBe(t0 + 4 * H);
  });

  it('D1 ตัดที่ 00:00 UTC', () => {
    expect(bucketStart(t0 + 23 * H + 59 * M, 'D1')).toBe(t0);
  });

  it('W1 เริ่มวันจันทร์', () => {
    expect(new Date(t0).getUTCDay()).toBe(1); // จันทร์
    expect(bucketStart(t0 + 6 * D + 23 * H, 'W1')).toBe(t0); // อาทิตย์ยังเป็นสัปดาห์เดียวกัน
    expect(bucketStart(t0 + 7 * D, 'W1')).toBe(t0 + 7 * D);
    expect(bucketStart(t0 - 1, 'W1')).toBe(t0 - 7 * D);
  });
});

describe('resample', () => {
  it('รวม M1 เป็น M5 ได้ OHLCV ถูกต้อง', () => {
    const m1 = [
      c(t0, 10, 12, 9, 11, 1),
      c(t0 + M, 11, 15, 10, 14, 2),
      c(t0 + 2 * M, 14, 14, 8, 9, 3),
      c(t0 + 5 * M, 9, 10, 7, 8, 4), // แท่ง M5 ถัดไป
    ];
    expect(resample(m1, 'M5')).toEqual([
      c(t0, 10, 15, 8, 9, 6),
      c(t0 + 5 * M, 9, 10, 7, 8, 4),
    ]);
  });

  it('ช่วงไม่มีข้อมูลไม่เติมแท่งว่าง', () => {
    const m1 = [c(t0, 1, 1, 1, 1), c(t0 + 3 * H, 2, 2, 2, 2)];
    expect(resample(m1, 'H1').map((x) => x.time)).toEqual([t0, t0 + 3 * H]);
  });

  it('ไม่แก้ไข input', () => {
    const m1 = [c(t0, 1, 2, 0, 1), c(t0 + M, 1, 3, 0, 2)];
    const copy = m1.map((x) => ({ ...x }));
    resample(m1, 'M5');
    expect(m1).toEqual(copy);
  });

  it('ข้อมูลไม่เรียงต้อง throw', () => {
    expect(() => resample([c(t0 + 10 * M, 1, 1, 1, 1), c(t0, 1, 1, 1, 1)], 'M5')).toThrow();
  });

  it('M1 → H1 ตรงกับ M1 → M15 → H1 (resample ซ้อนได้)', () => {
    const m1 = generateSampleCandles({ count: 3000, timeframe: 'M1', startPrice: 2650, startTime: t0 });
    const direct = resample(m1, 'H1');
    const viaM15 = resample(resample(m1, 'M15'), 'H1');
    expect(viaM15).toEqual(direct);
  });

  it('ข้อมูลเพิ่ม แท่งที่ปิดไปแล้วไม่เปลี่ยน (เปลี่ยนได้แค่แท่งสุดท้าย)', () => {
    const m1 = generateSampleCandles({ count: 2000, timeframe: 'M1', startPrice: 2650, startTime: t0 });
    const full = resample(m1, 'M30');
    for (const cut of [100, 777, 1500]) {
      const partial = resample(m1.slice(0, cut), 'M30');
      expect(partial.slice(0, -1)).toEqual(full.slice(0, partial.length - 1));
    }
  });
});

describe('isBucketClosed', () => {
  it('H4 ปิดเมื่อครบ 4 ชม.', () => {
    expect(isBucketClosed(t0, 'H4', t0 + 4 * H - 1)).toBe(false);
    expect(isBucketClosed(t0, 'H4', t0 + TIMEFRAME_MS.H4)).toBe(true);
  });
});
