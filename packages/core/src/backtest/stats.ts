import type { EquityPoint, Stats, Trade } from './types';

export interface MoneyOptions {
  /** เสี่ยงกี่ % ของยอดเงินปัจจุบันต่อไม้ (ทบต้น) */
  riskPct: number;
  initialBalance: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * สถิติของชุดเทรด — ทุกค่าเป็น R (1R = ระยะ entry→SL) จึงเทียบได้ทุกตลาด
 * เงินคิดแบบเสี่ยงคงที่ riskPct% ของยอดปัจจุบัน (ไม่สน lot ขั้นต่ำ — ดูเป็นแนวโน้ม ไม่ใช่ตัวเลขจริงเป๊ะ)
 */
export function computeStats(trades: readonly Trade[], money: MoneyOptions): Stats {
  const rs = trades.map((t) => t.r);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);

  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let maxStreak = 0;
  let balance = money.initialBalance;
  let peakBal = balance;
  let maxDdPct = 0;
  for (const r of rs) {
    cum += r;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    streak = r < 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
    balance *= 1 + (r * money.riskPct) / 100;
    peakBal = Math.max(peakBal, balance);
    if (peakBal > 0) maxDdPct = Math.max(maxDdPct, ((peakBal - balance) / peakBal) * 100);
  }

  const longs = trades.filter((t) => t.direction === 'long');
  const shorts = trades.filter((t) => t.direction === 'short');
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWinR: mean(wins),
    avgLossR: mean(losses),
    expectancyR: mean(rs),
    totalR: cum,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    maxDrawdownR: maxDd,
    maxConsecLosses: maxStreak,
    avgBarsHeld: mean(trades.map((t) => t.barsHeld)),
    longs: longs.length,
    shorts: shorts.length,
    longExpectancyR: mean(longs.map((t) => t.r)),
    shortExpectancyR: mean(shorts.map((t) => t.r)),
    finalBalance: balance,
    maxDrawdownPct: maxDdPct,
  };
}

/** เส้น equity ทีละเทรด (จุดแรก = ก่อนเทรดแรก) */
export function equityCurve(trades: readonly Trade[], money: MoneyOptions): EquityPoint[] {
  const out: EquityPoint[] = [];
  let r = 0;
  let balance = money.initialBalance;
  if (trades.length) out.push({ time: trades[0]!.entryTime, r, balance });
  for (const t of trades) {
    r += t.r;
    balance *= 1 + (t.r * money.riskPct) / 100;
    out.push({ time: t.exitTime, r, balance });
  }
  return out;
}
