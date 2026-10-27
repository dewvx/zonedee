import type { Candle, Timeframe } from '../types';
import type { DetectorConfig } from '../config';
import type { ParamValue, StrategyDef } from '../strategies/types';
import type { BaselineResult, Stats } from './types';
import { runBacktest, type RunOptions } from './run';

export const DETECTOR_CONFIG_KEYS = new Set([
  'swingLength',
  'equalBodyTolAtr',
  'breakBy',
  'touchBy',
  'boBreakBy',
  'atrPeriod',
]);

export type TuningGrid = Record<string, ParamValue[]>;

export interface GridSearchRow {
  index: number;
  rank?: number;
  label: string;
  combination: Record<string, ParamValue>;
  cfg: Partial<DetectorConfig>;
  params: Record<string, ParamValue>;
  signalsCount: number;
  tradesCount: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  maxDrawdownR: number;
  profitFactor: number | null;
  stats: Stats;
  inSample: Stats;
  outOfSample: Stats;
  baseline: BaselineResult | null;
  score: number;
  isBest?: boolean;
  isSignificant?: boolean;
}

export interface GridSearchOptions extends RunOptions {
  /** จำกัดจำนวน combination สูงสุดกันเครื่องค้าง (ค่าเริ่มต้น 150) */
  maxCombinations?: number;
  /** จำนวนรอบสุ่มเทียบสำหรับ candidate ชั้นนำ (ค่าเริ่มต้น 100) */
  topBaselineRuns?: number;
  /** จำนวนไม้ขั้นต่ำถึงจะนับว่ามีนัยสำคัญ (ค่าเริ่มต้น 25) */
  minSignificantTrades?: number;
}

export interface GridSearchResult {
  strategyId: string;
  strategyName: string;
  totalCombinations: number;
  testedCombinations: number;
  best: GridSearchRow | null;
  rows: GridSearchRow[];
}

/** คำนวณ Cartesian Product ของตัวเลือกทั้งหมด */
export function cartesianProduct<T = any>(entries: [string, T[]][]): Record<string, T>[] {
  if (entries.length === 0) return [{}];
  const [first, ...rest] = entries;
  const [key, values] = first!;
  const restCombs = cartesianProduct(rest);
  const result: Record<string, T>[] = [];
  for (const v of values) {
    for (const r of restCombs) {
      result.push({ [key]: v, ...r });
    }
  }
  return result;
}

/** แยก combination ออกเป็น cfg ของ detector และ params ของกลยุทธ์ */
export function splitCombination(comb: Record<string, ParamValue>): {
  cfg: Partial<DetectorConfig>;
  params: Record<string, ParamValue>;
} {
  const cfg: Partial<DetectorConfig> = {};
  const params: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(comb)) {
    if (DETECTOR_CONFIG_KEYS.has(k)) {
      (cfg as Record<string, ParamValue>)[k] = v;
    } else {
      params[k] = v;
    }
  }
  return { cfg, params };
}

/** สร้างข้อความสั้นอธิบายตัวแปร เช่น "swingLength=3, breakBy=close, rr=2" */
export function formatCombinationLabel(comb: Record<string, ParamValue>): string {
  return Object.entries(comb)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/** คะแนนความน่าสนใจของ combination (อิง Expectancy, OOS, Drawdown) */
export function computeRowScore(stats: Stats, oos: Stats, baseline: BaselineResult | null): number {
  if (stats.trades < 5) return -Infinity;
  let score = stats.expectancyR;

  // ผลตอบแทนช่วง Out-of-sample (ป้องกัน overfitting)
  if (oos.trades >= 5) {
    if (oos.expectancyR > 0) {
      score += 0.25 * oos.expectancyR;
    } else {
      score -= 0.6 * Math.abs(oos.expectancyR);
    }
  }

  // ปัจจัยความเสี่ยง Drawdown
  if (stats.maxDrawdownR > 0) {
    const rToDd = stats.totalR / Math.max(1, stats.maxDrawdownR);
    score += Math.min(0.2, 0.05 * rToDd);
  }

  // สถิติชนะการสุ่ม (Random Baseline)
  if (baseline && baseline.percentile >= 95) {
    score += 0.15;
  }

  return score;
}

/** สร้าง Grid ค่าเริ่มต้นสำหรับการจูนพารามิเตอร์ของท่า */
export function getDefaultTuningGrid(strategyOrId: StrategyDef | string): TuningGrid {
  const stratId = typeof strategyOrId === 'string' ? strategyOrId : strategyOrId.id;
  const grid: TuningGrid = {
    swingLength: [2, 3, 5],
    breakBy: ['close', 'wick'],
  };

  switch (stratId) {
    case 'ema-cross':
      grid['fast'] = [9, 13, 21];
      grid['slow'] = [21, 34, 55];
      grid['rr'] = [1.5, 2.0, 3.0];
      break;
    case 'sk-fibo':
      grid['entryLevel'] = [0.5, 0.618, 0.786];
      grid['rr'] = [1.5, 2.0, 2.5, 3.0];
      break;
    case 'liquidity-sweep':
      grid['requireChoch'] = [true, false];
      grid['rr'] = [1.5, 2.0, 3.0];
      break;
    case 'amd':
      grid['entryMode'] = ['fvg', 'market'];
      grid['minRR'] = [1.5, 2.0];
      grid['rr'] = [1.5, 2.0, 2.5, 3.0];
      break;
    default:
      if (typeof strategyOrId !== 'string' && strategyOrId.params) {
        for (const p of strategyOrId.params) {
          if (p.key === 'rr') grid['rr'] = [1.5, 2.0, 2.5, 3.0];
          else if (p.key === 'entryMode') grid['entryMode'] = ['limit', 'market'];
          else if (p.key === 'entryLevel') grid['entryLevel'] = [0.5, 0.618, 0.786];
          else if (p.key === 'slBufferAtr') grid['slBufferAtr'] = [0.05, 0.1, 0.2];
          else if (p.key === 'minRR') grid['minRR'] = [1.0, 1.5, 2.0];
        }
      } else {
        grid['rr'] = [1.5, 2.0, 3.0];
      }
      break;
  }

  return grid;
}

/**
 * รัน Grid Search Optimization หาพารามิเตอร์ที่ดีที่สุดของกลยุทธ์
 */
export function runGridSearch(
  candles: readonly Candle[],
  strategy: StrategyDef,
  grid: Record<string, ParamValue[]>,
  opts: GridSearchOptions,
): GridSearchResult {
  const maxCombs = opts.maxCombinations ?? 150;
  const topBaselineRuns = opts.topBaselineRuns ?? 100;
  const minSigTrades = opts.minSignificantTrades ?? 25;

  // 1. สร้างรายการ combinations ทั้งหมด
  const entries = Object.entries(grid).filter(([, vals]) => Array.isArray(vals) && vals.length > 0);
  const allCombinations = cartesianProduct(entries);
  const combinationsToTest = allCombinations.slice(0, maxCombs);

  // 2. รัน simulation แต่ละ combination อย่างรวดเร็ว (ยังไม่สุ่ม baseline ในรอบแรก)
  const preliminaryRows: GridSearchRow[] = [];

  for (let idx = 0; idx < combinationsToTest.length; idx++) {
    const comb = combinationsToTest[idx]!;
    const { cfg, params } = splitCombination(comb);

    const signals = strategy.generate({
      candles,
      tf: opts.tf,
      cfg: { ...opts.fine ? {} : {}, ...cfg },
      params,
    });

    const res = runBacktest(candles, signals, {
      ...opts,
      baselineRuns: 0, // รันรอบแรกแบบเร็ว < 1ms
    });

    const score = computeRowScore(res.stats, res.outOfSample, null);

    preliminaryRows.push({
      index: idx,
      label: formatCombinationLabel(comb),
      combination: comb,
      cfg,
      params,
      signalsCount: signals.length,
      tradesCount: res.stats.trades,
      winRate: res.stats.winRate,
      expectancyR: res.stats.expectancyR,
      totalR: res.stats.totalR,
      maxDrawdownR: res.stats.maxDrawdownR,
      profitFactor: res.stats.profitFactor,
      stats: res.stats,
      inSample: res.inSample,
      outOfSample: res.outOfSample,
      baseline: null,
      score,
    });
  }

  // 3. จัดอันดับตามคะแนนเบื้องต้น
  preliminaryRows.sort((a, b) => b.score - a.score);

  // 4. สุ่ม Random Baseline เฉพาะ Top 8 candidates ที่ทำผลงานได้ดี เพื่อประหยัดเวลา
  const topCandidates = preliminaryRows.slice(0, 8);
  for (const candidate of topCandidates) {
    if (candidate.tradesCount >= 5 && topBaselineRuns > 0) {
      const signals = strategy.generate({
        candles,
        tf: opts.tf,
        cfg: candidate.cfg,
        params: candidate.params,
      });

      const res = runBacktest(candles, signals, {
        ...opts,
        baselineRuns: topBaselineRuns,
        seed: opts.seed ?? 42,
      });

      candidate.baseline = res.baseline;
      candidate.score = computeRowScore(candidate.stats, candidate.outOfSample, res.baseline);
    }
  }

  // จัดอันดับใหม่อีกครั้งหลังมีคะแนน baseline
  preliminaryRows.sort((a, b) => b.score - a.score);

  preliminaryRows.forEach((r, idx) => {
    r.rank = idx + 1;
  });

  // 5. หา Combination ที่ดีที่สุดและมีนัยสำคัญทางสถิติ
  for (const row of preliminaryRows) {
    const isSig =
      row.tradesCount >= minSigTrades &&
      row.expectancyR > 0 &&
      row.outOfSample.expectancyR > 0 &&
      (row.baseline ? row.baseline.percentile >= 90 : true);

    row.isSignificant = isSig;
  }

  // หาผู้ชนะ: ตัวที่ได้คะแนนสูงสุดที่มีนัยสำคัญ หรือถ้าไม่มี ให้เอาตัวที่มีคะแนนสูงสุด
  const bestCandidate = preliminaryRows.find((r) => r.isSignificant) ?? preliminaryRows[0] ?? null;
  if (bestCandidate && bestCandidate.tradesCount > 0 && bestCandidate.expectancyR > 0) {
    bestCandidate.isBest = true;
  }

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    totalCombinations: allCombinations.length,
    testedCombinations: combinationsToTest.length,
    best: bestCandidate,
    rows: preliminaryRows,
  };
}
