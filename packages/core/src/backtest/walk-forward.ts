import type { Candle, Timeframe } from '../types';
import type { StrategyDef, ParamValue } from '../strategies/types';
import type { DetectorConfig } from '../config';
import type { BacktestOptions, EquityPoint, Signal, Stats, Trade } from './types';
import { simulate } from './engine';
import { computeStats, equityCurve, type MoneyOptions } from './stats';
import { RUN_DEFAULTS } from './run';

export interface WalkForwardWindow {
  index: number;
  trainStartTime: number;
  trainEndTime: number;
  testStartTime: number;
  testEndTime: number;
  trainStartIndex: number;
  trainEndIndex: number;
  testStartIndex: number;
  testEndIndex: number;
}

export interface WalkForwardStep {
  window: WalkForwardWindow;
  inSample: Stats;
  outOfSample: Stats;
  inSampleTradesCount: number;
  outOfSampleTradesCount: number;
  /** Walk-Forward Efficiency ของรอบนี้ (%) = (OOS Expectancy / IS Expectancy) * 100 */
  efficiencyPct: number;
}

export interface WalkForwardWindowConfig {
  /** จำนวนวันของช่วง Train (In-Sample) ค่าเริ่มต้น 180 วัน */
  trainDays?: number;
  /** จำนวนวันของช่วง Test (Out-of-Sample) ค่าเริ่มต้น 60 วัน */
  testDays?: number;
  /** จำนวนวันที่เลื่อนในแต่ละรอบ (ค่าเริ่มต้น = testDays เพื่อให้ OOS ต่อเนื่องไม่ซ้อนทับ) */
  stepDays?: number;
  /** หรือระบุจำนวนรอบที่ต้องการแบ่ง (เช่น 3-6 รอบ) */
  windowsCount?: number;
  tf?: Timeframe;
}

export interface WalkForwardOptions extends BacktestOptions {
  /** จำนวนวันของช่วง Train (In-Sample) ค่าเริ่มต้น 180 วัน */
  trainDays?: number;
  /** จำนวนวันของช่วง Test (Out-of-Sample) ค่าเริ่มต้น 60 วัน */
  testDays?: number;
  /** จำนวนวันที่เลื่อนในแต่ละรอบ (ค่าเริ่มต้น = testDays เพื่อให้ OOS ต่อเนื่องไม่ซ้อนทับ) */
  stepDays?: number;
  /** หรือระบุจำนวนรอบที่ต้องการแบ่ง (เช่น 3-6 รอบ) */
  windowsCount?: number;
  riskPct?: number;
  initialBalance?: number;
  params?: Record<string, ParamValue>;
  cfg?: Partial<DetectorConfig>;
}

export interface WalkForwardResult {
  steps: WalkForwardStep[];
  combinedOutOfSampleTrades: Trade[];
  combinedOutOfSampleStats: Stats;
  combinedInSampleStats: Stats;
  /** Walk-Forward Efficiency รวมทั้งระบบ (%) */
  walkForwardEfficiencyPct: number;
  /** ผ่านเกณฑ์ความทนทาน (WFE >= 50% และ OOS Expectancy > 0) */
  isRobust: boolean;
  equity: EquityPoint[];
  totalWindows: number;
}

/** หา index ของแท่งแรกที่มีเวลา >= time */
function findIndexGe(candles: readonly Candle[], time: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.time < time) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.min(candles.length - 1, lo);
}

/**
 * คำนวณช่วงเวลาหน้าต่างเลื่อน (Sliding Windows) สำหรับ Walk-Forward
 */
export function generateWalkForwardWindows(
  candles: readonly Candle[],
  opts: WalkForwardWindowConfig = {},
): WalkForwardWindow[] {
  if (candles.length < 30) return [];

  const firstTime = candles[0]!.time;
  const lastTime = candles.at(-1)!.time;
  const totalMs = lastTime - firstTime;

  let trainMs: number;
  let testMs: number;
  let stepMs: number;
  let count: number;

  if (opts.windowsCount && opts.windowsCount > 1) {
    count = Math.min(10, Math.max(2, Math.floor(opts.windowsCount)));
    stepMs = totalMs / (count + 1);
    trainMs = 2 * stepMs; // Train = 2 ส่วน
    testMs = stepMs;     // Test = 1 ส่วน
  } else {
    trainMs = (opts.trainDays ?? 180) * 86_400_000;
    testMs = (opts.testDays ?? 60) * 86_400_000;
    stepMs = (opts.stepDays ?? opts.testDays ?? 60) * 86_400_000;

    // ถ้าข้อมูลสั้นกว่า trainDays + testDays ให้แบ่งตามสัดส่วนอัตโนมัติ (3 รอบ)
    if (trainMs + testMs > totalMs) {
      count = 3;
      stepMs = totalMs / (count + 1);
      trainMs = 2 * stepMs;
      testMs = stepMs;
    } else {
      count = Math.max(1, Math.floor((totalMs - trainMs - testMs) / stepMs) + 1);
    }
  }

  const windows: WalkForwardWindow[] = [];
  for (let k = 0; k < count; k++) {
    const trainStartTime = firstTime + k * stepMs;
    const trainEndTime = trainStartTime + trainMs;
    const testStartTime = trainEndTime;
    const testEndTime = Math.min(lastTime + 1, testStartTime + testMs);

    if (testStartTime >= lastTime) break;

    const trainStartIndex = findIndexGe(candles, trainStartTime);
    const trainEndIndex = findIndexGe(candles, trainEndTime);
    const testStartIndex = trainEndIndex;
    const testEndIndex = findIndexGe(candles, testEndTime);

    if (trainEndIndex <= trainStartIndex || testEndIndex <= testStartIndex) continue;

    windows.push({
      index: windows.length,
      trainStartTime,
      trainEndTime,
      testStartTime,
      testEndTime,
      trainStartIndex,
      trainEndIndex,
      testStartIndex,
      testEndIndex,
    });
  }

  return windows;
}

/**
 * รัน Walk-Forward Analysis สำหรับกลยุทธ์ที่กำหนด
 */
export function runWalkForward(
  candles: readonly Candle[],
  strategy: StrategyDef,
  opts: WalkForwardOptions,
): WalkForwardResult {
  const money: MoneyOptions = {
    riskPct: opts.riskPct ?? RUN_DEFAULTS.riskPct,
    initialBalance: opts.initialBalance ?? RUN_DEFAULTS.initialBalance,
  };

  const windows = generateWalkForwardWindows(candles, opts);
  const steps: WalkForwardStep[] = [];
  const allOosTrades: Trade[] = [];
  const allIsTrades: Trade[] = [];

  for (const win of windows) {
    // รวม buffer ย้อนหลัง 100 แท่งเพื่อให้อินดิเคเตอร์คำนวณได้อย่างต่อเนื่อง
    const warmupStart = Math.max(0, win.trainStartIndex - 100);
    const windowCandles = candles.slice(warmupStart, win.testEndIndex + 1);

    const rawSignals = strategy.generate({
      candles: windowCandles,
      tf: opts.tf,
      cfg: opts.cfg,
      params: opts.params,
    });

    // ปรับ index สัญญาณให้ตรงกับ candles ชุดใหญ่
    const mappedSignals: Signal[] = rawSignals.map((s) => ({
      ...s,
      index: s.index + warmupStart,
    }));

    const { trades } = simulate(candles, mappedSignals, opts);

    // แยก In-Sample vs Out-of-Sample ตามเวลาเข้า
    const isTrades = trades.filter(
      (t) => t.entryTime >= win.trainStartTime && t.entryTime < win.trainEndTime,
    );
    const oosTrades = trades.filter(
      (t) => t.entryTime >= win.testStartTime && t.entryTime < win.testEndTime,
    );

    allIsTrades.push(...isTrades);
    allOosTrades.push(...oosTrades);

    const inSample = computeStats(isTrades, money);
    const outOfSample = computeStats(oosTrades, money);

    let efficiencyPct = 0;
    if (inSample.expectancyR > 0) {
      efficiencyPct = (outOfSample.expectancyR / inSample.expectancyR) * 100;
    } else if (outOfSample.expectancyR > 0) {
      efficiencyPct = 100;
    }

    steps.push({
      window: win,
      inSample,
      outOfSample,
      inSampleTradesCount: isTrades.length,
      outOfSampleTradesCount: oosTrades.length,
      efficiencyPct: Number(efficiencyPct.toFixed(1)),
    });
  }

  // เรียงลำดับเทรด OOS รวมตามเวลาปิด
  allOosTrades.sort((a, b) => a.exitTime - b.exitTime);
  const combinedOutOfSampleStats = computeStats(allOosTrades, money);
  const combinedInSampleStats = computeStats(allIsTrades, money);

  let walkForwardEfficiencyPct = 0;
  if (combinedInSampleStats.expectancyR > 0) {
    walkForwardEfficiencyPct = Number(
      ((combinedOutOfSampleStats.expectancyR / combinedInSampleStats.expectancyR) * 100).toFixed(1),
    );
  } else if (combinedOutOfSampleStats.expectancyR > 0) {
    walkForwardEfficiencyPct = 100;
  }

  const isRobust =
    walkForwardEfficiencyPct >= 50 &&
    combinedOutOfSampleStats.expectancyR > 0 &&
    allOosTrades.length >= 10;

  const equity = equityCurve(allOosTrades, money);

  return {
    steps,
    combinedOutOfSampleTrades: allOosTrades,
    combinedOutOfSampleStats,
    combinedInSampleStats,
    walkForwardEfficiencyPct,
    isRobust,
    equity,
    totalWindows: steps.length,
  };
}
