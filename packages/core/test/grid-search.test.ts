import { describe, expect, it } from 'vitest';
import { generateSampleCandles } from '../src/sample-data';
import { getStrategy, STRATEGIES } from '../src/strategies';
import {
  cartesianProduct,
  formatCombinationLabel,
  getDefaultTuningGrid,
  runGridSearch,
  splitCombination,
} from '../src/backtest/grid-search';

describe('Grid Search Optimization (จูนพารามิเตอร์อัตโนมัติ)', () => {
  it('cartesianProduct คำนวณผลคูณคาร์ทีเซียนของทุกตัวแปรได้อย่างแม่นยำ', () => {
    const empty = cartesianProduct([]);
    expect(empty).toEqual([{}]);

    const single = cartesianProduct([['a', [1, 2, 3]]]);
    expect(single).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);

    const multi = cartesianProduct<any>([
      ['swingLength', [2, 3]],
      ['breakBy', ['close', 'wick']],
    ]);
    expect(multi).toHaveLength(4);
    expect(multi).toEqual([
      { swingLength: 2, breakBy: 'close' },
      { swingLength: 2, breakBy: 'wick' },
      { swingLength: 3, breakBy: 'close' },
      { swingLength: 3, breakBy: 'wick' },
    ]);
  });

  it('splitCombination แยกค่าระหว่าง DetectorConfig และ Strategy Params ถูกต้อง', () => {
    const { cfg, params } = splitCombination({
      swingLength: 3,
      breakBy: 'close',
      rr: 2.5,
      entryMode: 'limit',
    });
    expect(cfg).toEqual({ swingLength: 3, breakBy: 'close' });
    expect(params).toEqual({ rr: 2.5, entryMode: 'limit' });
  });

  it('formatCombinationLabel สร้างข้อความสรุปตัวแปรอย่างกระชับ', () => {
    const label = formatCombinationLabel({ swingLength: 3, breakBy: 'close', rr: 2 });
    expect(label).toBe('swingLength=3, breakBy=close, rr=2');
  });

  it('getDefaultTuningGrid สร้างตารางตัวแปรที่ครอบคลุมของแต่ละท่า', () => {
    const emaStrat = getStrategy('ema-cross')!;
    const gridEma = getDefaultTuningGrid(emaStrat);
    expect(gridEma['swingLength']).toBeDefined();
    expect(gridEma['breakBy']).toBeDefined();
    expect(gridEma['rr']).toBeDefined();

    const skStrat = getStrategy('sk-fibo')!;
    const gridSk = getDefaultTuningGrid(skStrat);
    expect(gridSk['entryLevel']).toBeDefined();
  });

  it('runGridSearch รันทุก combination บนข้อมูลจำลอง เรียงลำดับ และหา combination ที่ดีที่สุด', () => {
    const candles = generateSampleCandles({ count: 4000, timeframe: 'M5', startPrice: 2650, seed: 12 });
    const strat = getStrategy('ema-cross')!;

    const grid = {
      swingLength: [2, 3],
      rr: [1.5, 2.0],
    };

    const result = runGridSearch(candles, strat, grid, {
      tf: 'M5',
      topBaselineRuns: 30,
      maxCombinations: 10,
    });

    expect(result.strategyId).toBe('ema-cross');
    expect(result.totalCombinations).toBe(4);
    expect(result.testedCombinations).toBe(4);
    expect(result.rows).toHaveLength(4);

    // ตรวจสอบว่า rows ถูกเรียงตาม score จากมากไปน้อย
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i - 1]!.score).toBeGreaterThanOrEqual(result.rows[i]!.score);
    }

    // มีแถวที่ระบุเป็นตัวที่ดีที่สุด (ถ้ามีเทรด)
    if (result.best) {
      expect(result.best.isBest).toBe(true);
      expect(result.best.tradesCount).toBeGreaterThan(0);
    }
  });

  it('จำกัดจำนวน combination สูงสุดด้วย maxCombinations', () => {
    const candles = generateSampleCandles({ count: 500, timeframe: 'M15', startPrice: 100, seed: 7 });
    const strat = getStrategy('crt')!;

    const grid = {
      swingLength: [2, 3, 5],
      breakBy: ['close', 'wick'],
      rr: [1.5, 2.0, 2.5],
      entryMode: ['limit', 'market'],
    }; // 3 * 2 * 3 * 2 = 36 combinations

    const result = runGridSearch(candles, strat, grid, {
      tf: 'M15',
      maxCombinations: 5,
      topBaselineRuns: 0,
    });

    expect(result.totalCombinations).toBe(36);
    expect(result.testedCombinations).toBe(5);
    expect(result.rows).toHaveLength(5);
  });
});
