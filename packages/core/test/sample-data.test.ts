import { describe, expect, it } from 'vitest';
import { generateSampleCandles, seedFromString } from '../src/sample-data';
import { TIMEFRAME_MS } from '../src/types';

describe('generateSampleCandles', () => {
  const candles = generateSampleCandles({ count: 500, timeframe: 'M15', startPrice: 2650, seed: 7 });

  it('seed เดิมได้ข้อมูลเดิม', () => {
    const again = generateSampleCandles({ count: 500, timeframe: 'M15', startPrice: 2650, seed: 7 });
    expect(again).toEqual(candles);
  });

  it('แท่งเทียนถูกต้องตามรูปร่าง (high สูงสุด, low ต่ำสุด)', () => {
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });

  it('เวลาเรียงกันห่างเท่ากับ timeframe', () => {
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.time - candles[i - 1]!.time).toBe(TIMEFRAME_MS.M15);
    }
  });

  it('seedFromString ให้ค่าคงที่', () => {
    expect(seedFromString('XAUUSD')).toBe(seedFromString('XAUUSD'));
    expect(seedFromString('XAUUSD')).not.toBe(seedFromString('EURUSD'));
  });
});
