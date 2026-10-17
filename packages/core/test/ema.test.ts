import { describe, expect, it } from 'vitest';
import { ema } from '../src/indicators/ema';
import { generateSampleCandles } from '../src/sample-data';

describe('ema', () => {
  it('seed ด้วย SMA แล้วคำนวณต่อแบบ exponential', () => {
    // period 3 → k = 0.5
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2); // (1+2+3)/3
    expect(out[3]).toBeCloseTo(3); // 4*0.5 + 2*0.5
    expect(out[4]).toBeCloseTo(4); // 5*0.5 + 3*0.5
  });

  it('ข้อมูลน้อยกว่า period ได้ null ทั้งหมด', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });

  it('period ไม่ถูกต้องต้อง throw', () => {
    expect(() => ema([1, 2, 3], 0)).toThrow();
    expect(() => ema([1, 2, 3], 2.5)).toThrow();
  });

  it('ไม่แอบดูอนาคต: คำนวณจากข้อมูลบางส่วน ต้องได้ค่าเท่ากับคำนวณจากข้อมูลทั้งหมด', () => {
    const closes = generateSampleCandles({ count: 300, timeframe: 'M5', startPrice: 2650 }).map(
      (c) => c.close,
    );
    const full = ema(closes, 21);
    for (const cut of [21, 50, 150, 299]) {
      const partial = ema(closes.slice(0, cut + 1), 21);
      expect(partial[cut]).toBe(full[cut]);
    }
  });
});
