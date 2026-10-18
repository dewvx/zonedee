import type { Candle } from '../types';
import { randomBaseline } from './baseline';
import { simulate } from './engine';
import { computeStats, equityCurve } from './stats';
import type { BacktestOptions, BacktestResult, Signal } from './types';

export interface RunOptions extends BacktestOptions {
  /** เสี่ยงกี่ % ต่อไม้ (ใช้คิดเส้น equity เป็นเงิน) */
  riskPct?: number;
  initialBalance?: number;
  /** สัดส่วนข้อมูลช่วงท้ายที่กันไว้เป็น out-of-sample (0 = ไม่แบ่ง) */
  oosFraction?: number;
  /** จำนวนรอบสุ่มเทียบ (0 = ไม่ทำ) */
  baselineRuns?: number;
  seed?: number;
}

export const RUN_DEFAULTS = {
  riskPct: 1,
  initialBalance: 1000,
  oosFraction: 0.3,
  baselineRuns: 200,
  seed: 42,
};

/** จำลอง + สถิติ + แบ่ง in/out-of-sample + เทียบกับการสุ่ม ในครั้งเดียว */
export function runBacktest(candles: readonly Candle[], signals: readonly Signal[], opts: RunOptions): BacktestResult {
  const o = { ...RUN_DEFAULTS, ...opts };
  const money = { riskPct: o.riskPct, initialBalance: o.initialBalance };
  const { trades, skipped } = simulate(candles, signals, o);

  const splitIndex = o.oosFraction > 0 ? Math.floor(candles.length * (1 - o.oosFraction)) : candles.length;
  const splitTime = splitIndex < candles.length ? candles[splitIndex]!.time : null;
  const inTrades = trades.filter((t) => t.entryIndex < splitIndex);
  const outTrades = trades.filter((t) => t.entryIndex >= splitIndex);

  return {
    trades,
    skipped,
    stats: computeStats(trades, money),
    inSample: computeStats(inTrades, money),
    outOfSample: computeStats(outTrades, money),
    splitTime,
    equity: equityCurve(trades, money),
    baseline:
      o.baselineRuns > 0 && trades.length > 0
        ? randomBaseline(candles, trades, o, { runs: o.baselineRuns, seed: o.seed })
        : null,
  };
}
