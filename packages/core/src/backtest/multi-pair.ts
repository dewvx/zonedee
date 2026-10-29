import type { Candle } from '../types';
import type { BacktestOptions, EquityPoint, Signal, Stats, Trade } from './types';
import { simulate } from './engine';
import { computeStats, equityCurve, type MoneyOptions } from './stats';
import { RUN_DEFAULTS } from './run';

export interface PortfolioTrade extends Trade {
  symbol: string;
}

export interface MultiPairSymbolInput {
  symbol: string;
  candles: readonly Candle[];
  signals: readonly Signal[];
  options: BacktestOptions;
}

export interface MultiPairSymbolSummary {
  symbol: string;
  tradesCount: number;
  wins: number;
  losses: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  finalBalance: number;
  stats: Stats;
}

export interface MultiPairRunOptions {
  riskPct?: number;
  initialBalance?: number;
}

export interface MultiPairResult {
  portfolioTrades: PortfolioTrade[];
  portfolioStats: Stats;
  portfolioEquity: EquityPoint[];
  symbolSummaries: MultiPairSymbolSummary[];
  /** อัตราส่วนประโยชน์การกระจายความเสี่ยง (ผลรวม Max DD แต่ละตัว ÷ Max DD ของพอร์ต) */
  diversificationRatio: number;
  totalSymbols: number;
}

/**
 * รัน Backtest รวมหลายคู่เงิน (Multi-Pair Portfolio Backtesting)
 * - จำลองออเดอร์ของแต่ละคู่เงินตามสเปก spread และ swap ประจำคู่เงินนั้น
 * - รวมออเดอร์ทั้งหมดเรียงตามลำดับเวลาจริง (Chronological)
 * - คำนวณผลตอบแทนพอร์ตโฟลิโอ เส้น Equity รวม และการกระจายความเสี่ยง (Diversification Ratio)
 */
export function runMultiPair(
  inputs: readonly MultiPairSymbolInput[],
  opts: MultiPairRunOptions = {},
): MultiPairResult {
  const money: MoneyOptions = {
    riskPct: opts.riskPct ?? RUN_DEFAULTS.riskPct,
    initialBalance: opts.initialBalance ?? RUN_DEFAULTS.initialBalance,
  };

  const portfolioTrades: PortfolioTrade[] = [];
  const symbolSummaries: MultiPairSymbolSummary[] = [];

  for (const item of inputs) {
    const { trades } = simulate(item.candles, item.signals, item.options);
    const symTrades: PortfolioTrade[] = trades.map((t) => ({ ...t, symbol: item.symbol }));
    portfolioTrades.push(...symTrades);

    const stats = computeStats(trades, money);
    symbolSummaries.push({
      symbol: item.symbol,
      tradesCount: stats.trades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      expectancyR: stats.expectancyR,
      totalR: stats.totalR,
      profitFactor: stats.profitFactor,
      maxDrawdownR: stats.maxDrawdownR,
      finalBalance: stats.finalBalance,
      stats,
    });
  }

  // รวมและเรียงลำดับเทรดทั้งหมดตาม exitTime (หรือ entryTime ถ้า exitTime เท่ากัน)
  portfolioTrades.sort((a, b) => a.exitTime - b.exitTime || a.entryTime - b.entryTime);

  const portfolioStats = computeStats(portfolioTrades, money);
  const portfolioEquity = equityCurve(portfolioTrades, money);

  const sumIndividualDd = symbolSummaries.reduce((sum, s) => sum + s.maxDrawdownR, 0);
  const diversificationRatio =
    portfolioStats.maxDrawdownR > 0
      ? Number((sumIndividualDd / portfolioStats.maxDrawdownR).toFixed(2))
      : 1;

  // เรียงลำดับ symbol summary ตาม Total R จากมากไปน้อย
  symbolSummaries.sort((a, b) => b.totalR - a.totalR);

  return {
    portfolioTrades,
    portfolioStats,
    portfolioEquity,
    symbolSummaries,
    diversificationRatio,
    totalSymbols: inputs.length,
  };
}
