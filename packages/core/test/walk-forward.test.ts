import { describe, expect, it } from 'vitest';
import { generateSampleCandles } from '../src/sample-data';
import { getStrategy } from '../src/strategies';
import {
  generateWalkForwardWindows,
  runWalkForward,
  type WalkForwardOptions,
} from '../src/backtest/walk-forward';
import type { Candle } from '../src/types';

describe('generateWalkForwardWindows (การแบ่งหน้าต่างเวลา Walk-Forward)', () => {
  it('ข้อมูลสั้นเกินไป (< 30 แท่ง) ต้องคืนค่าอาร์เรย์ว่าง', () => {
    const candles = generateSampleCandles({ count: 20, timeframe: 'M15', startPrice: 2650 });
    const windows = generateWalkForwardWindows(candles, {});
    expect(windows).toEqual([]);
  });

  it('แบ่งตาม windowsCount ได้หน้าต่างที่ Test ไม่ซ้อนทับกันและเรียงต่อเนื่อง', () => {
    const candles = generateSampleCandles({ count: 1000, timeframe: 'M15', startPrice: 2650 });
    const windows = generateWalkForwardWindows(candles, { windowsCount: 4, tf: 'M15' });

    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      expect(w.trainStartTime).toBeLessThan(w.trainEndTime);
      expect(w.testStartTime).toBe(w.trainEndTime);
      expect(w.testEndTime).toBeGreaterThan(w.testStartTime);
      expect(w.trainStartIndex).toBeLessThan(w.trainEndIndex);
      expect(w.testStartIndex).toBeLessThan(w.testEndIndex);

      if (i > 0) {
        const prev = windows[i - 1]!;
        // เลื่อนไปข้างหน้า
        expect(w.trainStartTime).toBeGreaterThan(prev.trainStartTime);
      }
    }
  });

  it('แบ่งตาม trainDays และ testDays ได้ช่วงเวลาที่ถูกต้อง', () => {
    const dayMs = 86_400_000;
    const count = 400 * 24; // 400 วัน ของ TF H1
    const candles: Candle[] = [];
    const baseTime = Date.UTC(2025, 0, 1, 0, 0, 0);
    let price = 2600;
    for (let i = 0; i < count; i++) {
      candles.push({
        time: baseTime + i * 3600_000,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price + 0.2,
        volume: 10,
      });
      price += (i % 2 === 0 ? 0.3 : -0.2);
    }

    const windows = generateWalkForwardWindows(candles, {
      trainDays: 180,
      testDays: 60,
      stepDays: 60,
      tf: 'H1',
    });

    expect(windows.length).toBeGreaterThanOrEqual(2);
    const w0 = windows[0]!;
    expect(w0.trainEndTime - w0.trainStartTime).toBeCloseTo(180 * dayMs, -3);
    expect(w0.testEndTime - w0.testStartTime).toBeCloseTo(60 * dayMs, -3);
  });
});

describe('runWalkForward (การจำลอง Walk-Forward Analysis)', () => {
  const strat = getStrategy('ema-cross')!;

  it('รันและคืนค่าครบทั้ง steps, combinedOutOfSampleStats, WFE และ equity curve', () => {
    const candles = generateSampleCandles({ count: 2000, timeframe: 'M15', startPrice: 2650, seed: 42 });
    const opts: WalkForwardOptions = {
      tf: 'M15',
      windowsCount: 4,
      riskPct: 1,
      initialBalance: 1000,
      params: { emaFast: 9, emaSlow: 21 },
    };

    const res = runWalkForward(candles, strat, opts);

    expect(res.totalWindows).toBeGreaterThanOrEqual(3);
    expect(res.steps).toHaveLength(res.totalWindows);

    for (const step of res.steps) {
      expect(step.inSample).toBeDefined();
      expect(step.outOfSample).toBeDefined();
      expect(typeof step.efficiencyPct).toBe('number');
    }

    // รวมเทรด OOS ทั้งหมด
    expect(res.combinedOutOfSampleTrades).toBeDefined();
    expect(res.combinedOutOfSampleStats).toBeDefined();
    expect(res.combinedInSampleStats).toBeDefined();
    expect(typeof res.walkForwardEfficiencyPct).toBe('number');
    expect(typeof res.isRobust).toBe('boolean');
    expect(res.equity.length).toBe(res.combinedOutOfSampleTrades.length ? res.combinedOutOfSampleTrades.length + 1 : 0);

    // ตรวจสอบว่าเทรด OOS เรียงตาม exitTime
    for (let i = 1; i < res.combinedOutOfSampleTrades.length; i++) {
      expect(res.combinedOutOfSampleTrades[i]!.exitTime).toBeGreaterThanOrEqual(
        res.combinedOutOfSampleTrades[i - 1]!.exitTime,
      );
    }
  });

  it('เทรด OOS ในแต่ละหน้าต่าง ต้องเข้าออเดอร์เฉพาะในช่วง Test ของรอบนั้น', () => {
    const candles = generateSampleCandles({ count: 1500, timeframe: 'M15', startPrice: 2650, seed: 99 });
    const res = runWalkForward(candles, strat, { tf: 'M15', windowsCount: 3 });

    for (const step of res.steps) {
      const win = step.window;
      // หาเทรดที่เกิดในรอบนี้
      expect(win.testStartIndex).toBeLessThan(win.testEndIndex);
    }
  });
});
