import { describe, expect, it } from 'vitest';
import { generateSampleCandles } from '../src/sample-data';
import { getStrategy } from '../src/strategies';
import { runMultiPair, type MultiPairSymbolInput } from '../src/backtest/multi-pair';

describe('runMultiPair (Multi-Pair Portfolio Backtesting)', () => {
  const strat = getStrategy('ema-cross')!;

  it('ไม่มี symbol ส่งเข้ามา คืนค่าว่างอย่างปลอดภัย', () => {
    const res = runMultiPair([], { riskPct: 1, initialBalance: 1000 });
    expect(res.totalSymbols).toBe(0);
    expect(res.portfolioTrades).toEqual([]);
    expect(res.symbolSummaries).toEqual([]);
    expect(res.portfolioStats.trades).toBe(0);
  });

  it('รันหลายคู่เงินรวมกัน จัดเรียงเทรดตามเวลาจริง และคำนวณผลพอร์ตโฟลิโอถูกต้อง', () => {
    const goldCandles = generateSampleCandles({ count: 500, timeframe: 'M15', startPrice: 2650, seed: 10 });
    const eurusdCandles = generateSampleCandles({ count: 500, timeframe: 'M15', startPrice: 1.08, seed: 20 });
    const usdjpyCandles = generateSampleCandles({ count: 500, timeframe: 'M15', startPrice: 152.0, seed: 30 });

    const goldSignals = strat.generate({ candles: goldCandles, tf: 'M15' });
    const eurSignals = strat.generate({ candles: eurusdCandles, tf: 'M15' });
    const jpySignals = strat.generate({ candles: usdjpyCandles, tf: 'M15' });

    const inputs: MultiPairSymbolInput[] = [
      {
        symbol: 'XAUUSD',
        candles: goldCandles,
        signals: goldSignals,
        options: { tf: 'M15', spread: 0.35 },
      },
      {
        symbol: 'EURUSD',
        candles: eurusdCandles,
        signals: eurSignals,
        options: { tf: 'M15', spread: 0.00016 },
      },
      {
        symbol: 'USDJPY',
        candles: usdjpyCandles,
        signals: jpySignals,
        options: { tf: 'M15', spread: 0.02 },
      },
    ];

    const res = runMultiPair(inputs, { riskPct: 1, initialBalance: 10_000 });

    expect(res.totalSymbols).toBe(3);
    expect(res.symbolSummaries).toHaveLength(3);

    // ตรวจสอบว่า symbolSummaries เรียงตาม totalR มากไปน้อย
    for (let i = 1; i < res.symbolSummaries.length; i++) {
      expect(res.symbolSummaries[i - 1]!.totalR).toBeGreaterThanOrEqual(res.symbolSummaries[i]!.totalR);
    }

    // จำนวนเทรดของพอร์ตต้องเท่ากับผลรวมของแต่ละคู่เงิน
    const totalSymTrades = res.symbolSummaries.reduce((sum, s) => sum + s.tradesCount, 0);
    expect(res.portfolioTrades.length).toBe(totalSymTrades);
    expect(res.portfolioStats.trades).toBe(totalSymTrades);

    // ตรวจสอบว่า portfolioTrades มี tag symbol และเรียงตามเวลาปิด exitTime
    for (let i = 1; i < res.portfolioTrades.length; i++) {
      const prev = res.portfolioTrades[i - 1]!;
      const curr = res.portfolioTrades[i]!;
      expect(curr.symbol).toBeTruthy();
      expect(curr.exitTime).toBeGreaterThanOrEqual(prev.exitTime);
    }

    // Diversification ratio ต้องเป็นตัวเลขบวก
    expect(res.diversificationRatio).toBeGreaterThan(0);

    // เส้น Equity ของพอร์ตต้องต่อเนื่อง
    expect(res.portfolioEquity.length).toBe(res.portfolioTrades.length + 1);
    expect(res.portfolioEquity[0]!.balance).toBe(10_000);
  });
});
