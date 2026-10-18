import { createRng } from '../random';
import type { Candle } from '../types';
import { simulateSignal } from './engine';
import type { BacktestOptions, BaselineResult, Signal, Trade } from './types';

export interface BaselineOptions {
  /** สุ่มกี่รอบ */
  runs: number;
  seed: number;
}

/**
 * เทียบกับ "เข้าแบบสุ่ม" (Monte Carlo) — ท่าที่ดีต้องชนะการโยนเหรียญ
 * แต่ละรอบ: สุ่มจุดเข้า + ทิศ จำนวนเท่ากับเทรดของท่า โดยใช้ระยะ SL/TP (เป็นราคา) ชุดเดียวกับท่า
 * แล้วจำลองด้วย engine เดียวกัน (spread, D10 ฯลฯ) → ได้ expectancy ของรอบนั้น
 * percentile = ท่านี้ดีกว่าการสุ่มกี่ % ของรอบ (≥ 95 = มีแววว่าไม่ใช่ฟลุก)
 */
export function randomBaseline(
  candles: readonly Candle[],
  trades: readonly Trade[],
  opts: BacktestOptions,
  bo: BaselineOptions,
): BaselineResult {
  const empty: BaselineResult = { runs: 0, mean: 0, p5: 0, p50: 0, p95: 0, percentile: 0 };
  const n = candles.length;
  if (trades.length === 0 || n < 3) return empty;

  const rng = createRng(bo.seed);
  const first = Math.min(...trades.map((t) => t.signalIndex));
  const span = n - 2 - first;
  if (span <= 0) return empty;

  const dists = trades.map((t) => ({ risk: Math.abs(t.entry - t.sl), reward: Math.abs(t.tp - t.entry) }));
  const strategyExp = trades.reduce((a, t) => a + t.r, 0) / trades.length;

  const results: number[] = [];
  for (let run = 0; run < bo.runs; run++) {
    let sum = 0;
    let count = 0;
    for (const d of dists) {
      const index = first + Math.floor(rng() * span);
      const isLong = rng() < 0.5;
      const ref = candles[index]!.close;
      const sig: Signal = {
        index,
        direction: isLong ? 'long' : 'short',
        entryType: 'market',
        entry: ref,
        sl: isLong ? ref - d.risk : ref + d.risk,
        tp: isLong ? ref + d.reward : ref - d.reward,
        reason: 'random',
      };
      const t = simulateSignal(candles, sig, opts);
      if (t) {
        sum += t.r;
        count++;
      }
    }
    results.push(count ? sum / count : 0);
  }

  const sorted = [...results].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const below = results.filter((x) => x < strategyExp).length;
  const ties = results.filter((x) => x === strategyExp).length;
  return {
    runs: results.length,
    mean: results.reduce((a, b) => a + b, 0) / results.length,
    p5: q(0.05),
    p50: q(0.5),
    p95: q(0.95),
    percentile: ((below + ties / 2) / results.length) * 100,
  };
}
