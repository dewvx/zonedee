import { describe, expect, it } from 'vitest';
import { summarizeStock, type StockSummaryInput } from '../src/scan/stock-summary';

describe('summarizeStock', () => {
  it('ขาขึ้นแข็งแกร่ง (Golden cross + RSI ดี + ทะลุแนวต้าน) → bias bullish', () => {
    const input: StockSummaryInput = {
      symbol: 'AAPL',
      metrics: {
        lastTime: Date.now(),
        close: 230,
        change1d: 1.5,
        change1w: 3.2,
        change1m: 5.0,
        change3m: 12.0,
        changeYtd: 18.0,
        change1y: 25.0,
        high52: 235,
        low52: 165,
        fromHigh52Pct: -2.1,
        sma50: 220,
        sma200: 195,
        rsi14: 62,
      },
      levels: {
        time: Date.now(),
        close: 230,
        supports: [{ price: 215, top: 217, bottom: 213, touches: 2, strength: 2, distancePct: -6.5, label: 'S' }],
        resistances: [{ price: 235, top: 237, bottom: 233, touches: 2, strength: 2, distancePct: 2.1, label: 'R' }],
        nearSupport: false,
        nearResistance: false,
        brokeSupport: null,
        brokeResistance: { price: 225, top: 227, bottom: 223, touches: 3, strength: 3, distancePct: -2.2, label: 'RBS' },
        status: 'broke-resistance',
      },
      fundamentals: {
        pe: 28,
        revenueGrowth: 0.18,
        profitMargin: 0.24,
      },
    };

    const res = summarizeStock(input);
    expect(res.bias).toBe('bullish');
    expect(res.headline).toContain('ขาขึ้น');
    expect(res.bullets.some((b) => b.type === 'pro' && b.category === 'trend')).toBe(true);
    expect(res.bullets.some((b) => b.type === 'pro' && b.category === 'level')).toBe(true);
    expect(res.bullets.some((b) => b.type === 'pro' && b.category === 'fundamental')).toBe(true);
  });

  it('ขาลง (Death cross + ต่ำกว่า SMA 200 + หลุดแนวรับ) → bias bearish', () => {
    const input: StockSummaryInput = {
      symbol: 'INTC',
      metrics: {
        lastTime: Date.now(),
        close: 20,
        change1d: -2.5,
        change1w: -5.0,
        change1m: -12.0,
        change3m: -25.0,
        changeYtd: -40.0,
        change1y: -35.0,
        high52: 50,
        low52: 18,
        fromHigh52Pct: -60,
        sma50: 25,
        sma200: 35,
        rsi14: 28,
      },
      levels: {
        time: Date.now(),
        close: 20,
        supports: [],
        resistances: [{ price: 25, top: 26, bottom: 24, touches: 2, strength: 2, distancePct: 25, label: 'R' }],
        nearSupport: false,
        nearResistance: false,
        brokeSupport: { price: 22, top: 23, bottom: 21, touches: 2, strength: 2, distancePct: 10, label: 'SBR' },
        brokeResistance: null,
        status: 'broke-support',
      },
      fundamentals: {
        pe: -5,
        revenueGrowth: -0.10,
        profitMargin: -0.05,
      },
    };

    const res = summarizeStock(input);
    expect(res.bias).toBe('bearish');
    expect(res.bullets.some((b) => b.type === 'con' && b.category === 'trend')).toBe(true);
    expect(res.bullets.some((b) => b.type === 'con' && b.category === 'level')).toBe(true);
    expect(res.bullets.some((b) => b.type === 'con' && b.category === 'fundamental')).toBe(true);
  });

  it('ใกล้วันประกาศงบการเงิน ≤ 5 วัน → มีข้อความเตือนความผันผวน', () => {
    const input: StockSummaryInput = {
      symbol: 'NVDA',
      metrics: {
        lastTime: Date.now(),
        close: 140,
        change1d: 1.0,
        change1w: 2.0,
        change1m: 8.0,
        change3m: 15.0,
        changeYtd: 150.0,
        change1y: 200.0,
        high52: 145,
        low52: 40,
        fromHigh52Pct: -3.4,
        sma50: 130,
        sma200: 105,
        rsi14: 65,
      },
      earningsDaysLeft: 3,
    };

    const res = summarizeStock(input);
    expect(res.bullets.some((b) => b.category === 'earnings')).toBe(true);
    expect(res.actionAdvice).toContain('ประกาศงบการเงิน');
  });

  it('ใกล้แนวรับสำคัญ → แนะนำเป็นจุดสะสมความเสี่ยงต่ำ', () => {
    const input: StockSummaryInput = {
      symbol: 'MSFT',
      metrics: {
        lastTime: Date.now(),
        close: 420,
        change1d: -0.5,
        change1w: -1.2,
        change1m: 0.5,
        change3m: 4.0,
        changeYtd: 15.0,
        change1y: 25.0,
        high52: 468,
        low52: 360,
        fromHigh52Pct: -10.2,
        sma50: 425,
        sma200: 410,
        rsi14: 48,
      },
      levels: {
        time: Date.now(),
        close: 420,
        supports: [{ price: 418, top: 420, bottom: 416, touches: 3, strength: 3, distancePct: -0.4, label: 'S' }],
        resistances: [{ price: 445, top: 448, bottom: 442, touches: 2, strength: 2, distancePct: 5.9, label: 'R' }],
        nearSupport: true,
        nearResistance: false,
        brokeSupport: null,
        brokeResistance: null,
        status: 'near-support',
      },
    };

    const res = summarizeStock(input);
    expect(res.bullets.some((b) => b.category === 'level' && b.type === 'pro')).toBe(true);
    expect(res.headline).toContain('แนวรับ');
  });
});
