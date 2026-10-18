import { describe, expect, it } from 'vitest';
import { simulate } from '../src/backtest/engine';
import { computeStats } from '../src/backtest/stats';
import { randomBaseline } from '../src/backtest/baseline';
import { htfView, lastClosedHtf } from '../src/mtf';
import { runBacktest } from '../src/backtest/run';
import { generateSampleCandles } from '../src/sample-data';
import type { Signal, Trade } from '../src/backtest/types';
import type { Candle } from '../src/types';

const M = 60_000;
/** แท่ง M15 จาก [open, high, low, close] */
const bars = (rows: [number, number, number, number][], step = 15 * M): Candle[] =>
  rows.map(([open, high, low, close], i) => ({ time: i * step, open, high, low, close, volume: 1 }));

const long = (index: number, sl: number, tp: number, extra: Partial<Signal> = {}): Signal => ({
  index,
  direction: 'long',
  entryType: 'market',
  entry: 0,
  sl,
  tp,
  reason: 'test',
  ...extra,
});
const short = (index: number, sl: number, tp: number, extra: Partial<Signal> = {}): Signal => ({
  ...long(index, sl, tp, extra),
  direction: 'short',
});

describe('simulate — market orders', () => {
  const up = bars([
    [100, 101, 99, 100], // 0 สัญญาณ
    [100, 102, 99.5, 101.5], // 1 เข้าที่ open 100
    [101.5, 104, 101, 103.8], // 2
    [103.8, 106, 103, 105.5], // 3 แตะ TP 105
  ]);

  it('long ถึง TP → +R ตามระยะจริง', () => {
    const { trades } = simulate(up, [long(0, 98, 105)], { tf: 'M15' });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ entryIndex: 1, entry: 100, exit: 105, exitReason: 'tp', exitIndex: 3 });
    expect(trades[0]!.r).toBeCloseTo(2.5); // (105-100)/(100-98)
  });

  it('spread: long เข้าที่ ask (open + spread) — R ลดลง', () => {
    const { trades } = simulate(up, [long(0, 98, 105)], { tf: 'M15', spread: 0.5 });
    expect(trades[0]!.entry).toBe(100.5);
    expect(trades[0]!.r).toBeCloseTo((105 - 100.5) / (100.5 - 98));
  });

  it('long โดน SL → −1R', () => {
    const down = bars([
      [100, 101, 99, 100],
      [100, 100.5, 98.5, 99],
      [99, 99.5, 97, 97.5], // low 97 ≤ SL 98
    ]);
    const { trades } = simulate(down, [long(0, 98, 105)], { tf: 'M15' });
    expect(trades[0]).toMatchObject({ exitReason: 'sl', exit: 98 });
    expect(trades[0]!.r).toBeCloseTo(-1);
  });

  it('short: SL/TP เทียบกับราคา ask (high/low + spread)', () => {
    const data = bars([
      [100, 101, 99, 100],
      [100, 100.5, 99, 99.5],
      [99.5, 101.8, 99, 101], // high 101.8 + spread 0.3 = 102.1 ≥ SL 102
    ]);
    const { trades } = simulate(data, [short(0, 102, 95)], { tf: 'M15', spread: 0.3 });
    expect(trades[0]).toMatchObject({ entry: 100, exitReason: 'sl', exit: 102 });
    expect(trades[0]!.r).toBeCloseTo(-1);
  });

  it('แท่งเดียวโดนทั้ง SL และ TP ไม่มีข้อมูล M1 → นับเป็น SL (D10)', () => {
    const data = bars([
      [100, 101, 99, 100],
      [100, 106, 97, 101], // ทั้ง 97 ≤ 98 และ 106 ≥ 105
    ]);
    expect(simulate(data, [long(0, 98, 105)], { tf: 'M15' }).trades[0]!.exitReason).toBe('sl');
  });

  it('แท่งเดียวโดนทั้งคู่ ใช้ M1 แยกได้ว่า TP โดนก่อน', () => {
    const data = bars([
      [100, 101, 99, 100],
      [100, 106, 97, 101],
    ]);
    const fine = bars(
      [
        ...Array.from({ length: 15 }, () => [100, 100.5, 99.5, 100] as [number, number, number, number]),
        [100, 106, 100, 105.5], // นาทีที่ 15 (แท่ง M15 ที่ 1 เริ่ม) — TP ก่อน
        [105.5, 105.6, 97, 98],
      ],
      M,
    );
    const { trades } = simulate(data, [long(0, 98, 105)], { tf: 'M15', fine: { candles: fine, tf: 'M1' } });
    expect(trades[0]!.exitReason).toBe('tp');
  });

  it('ราคาเปิดกระโดดทะลุ SL → ออกที่ราคาเปิด (แย่กว่า SL)', () => {
    const data = bars([
      [100, 101, 99, 100],
      [100, 100.5, 99, 99.5],
      [96, 97, 95, 96], // gap ลงใต้ SL 98
    ]);
    const t = simulate(data, [long(0, 98, 105)], { tf: 'M15' }).trades[0]!;
    expect(t.exit).toBe(96);
    expect(t.r).toBeCloseTo(-2);
  });

  it('ถือครบ maxBarsInTrade → ปิดที่ราคาปิด', () => {
    const flat = bars(Array.from({ length: 10 }, () => [100, 100.5, 99.5, 100.2] as [number, number, number, number]));
    const t = simulate(flat, [long(0, 98, 105)], { tf: 'M15', maxBarsInTrade: 3 }).trades[0]!;
    expect(t).toMatchObject({ exitReason: 'time', exitIndex: 3, exit: 100.2 });
  });

  it('ข้อมูลหมดระหว่างถือ → ปิดที่แท่งสุดท้าย (eod)', () => {
    const t = simulate(up.slice(0, 3), [long(0, 98, 110)], { tf: 'M15' }).trades[0]!;
    expect(t.exitReason).toBe('eod');
  });

  it('ถือได้ทีละสถานะ — สัญญาณระหว่างถือถูกข้าม', () => {
    const res = simulate(up, [long(0, 98, 105), long(1, 99, 110)], { tf: 'M15' });
    expect(res.trades).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  it('ราคาเปิดอยู่เลย TP ไปแล้ว → ข้ามสัญญาณ', () => {
    const data = bars([
      [100, 101, 99, 100],
      [106, 107, 105.5, 106.5],
    ]);
    const res = simulate(data, [long(0, 98, 105)], { tf: 'M15' });
    expect(res.trades).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });
});

describe('simulate — limit orders', () => {
  it('ราคาย่อลงมาถึง limit → เข้าที่ราคา limit', () => {
    const data = bars([
      [100, 101, 99, 100.5], // 0 สัญญาณ: buy limit 99
      [100.5, 101, 99.8, 100], // ยังไม่ถึง
      [100, 100.2, 98.8, 99.5], // low 98.8 ≤ 99 → fill
      [99.5, 103.5, 99.4, 103], // TP 103
    ]);
    const t = simulate(data, [long(0, 98, 103, { entryType: 'limit', entry: 99 })], { tf: 'M15' }).trades[0]!;
    expect(t).toMatchObject({ entryIndex: 2, entry: 99, exitReason: 'tp' });
    expect(t.r).toBeCloseTo(4);
  });

  it('ราคาไปถึง TP ก่อนจะย่อมาเข้า → ยกเลิก', () => {
    const data = bars([
      [100, 101, 99.5, 100.5],
      [100.5, 103.5, 100, 103], // ถึง TP 103 ก่อน
      [103, 103, 98.5, 99], // ค่อยลงมา
    ]);
    const res = simulate(data, [long(0, 98, 103, { entryType: 'limit', entry: 99 })], { tf: 'M15' });
    expect(res.trades).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });

  it('แท่งที่ limit ถูกจับแล้วแตะ TP ด้วย → ยังไม่นับ TP (ไม่รู้ลำดับ)', () => {
    const data = bars([
      [100, 101, 99.5, 100.5],
      [100.5, 103.5, 98.8, 101], // ทั้งย่อถึง 99 และขึ้นถึง 103 ในแท่งเดียว
      [101, 103.2, 100.5, 103], // TP แท่งถัดไป
    ]);
    const t = simulate(data, [long(0, 98, 103, { entryType: 'limit', entry: 99 })], { tf: 'M15' }).trades[0]!;
    expect(t).toMatchObject({ entryIndex: 1, exitIndex: 2, exitReason: 'tp' });
  });

  it('limit ที่ยังรออยู่จองช่องไว้ — สัญญาณระหว่างนั้นถูกข้ามแม้สุดท้าย limit จะไม่ถูกจับ (กันแอบดูอนาคต)', () => {
    const data = bars(Array.from({ length: 8 }, () => [100, 100.5, 99.5, 100] as [number, number, number, number]));
    const res = simulate(
      data,
      [
        long(0, 98, 103, { entryType: 'limit', entry: 99, expiryBars: 3 }), // รอแท่ง 1–3 แล้วหมดอายุ
        long(2, 98, 103), // มาระหว่าง limit ยังรอ → ข้าม
        long(3, 98, 103), // แท่ง 3 = แท่งที่ limit หมดอายุ → รับได้ (เข้าแท่ง 4)
      ],
      { tf: 'M15' },
    );
    expect(res.trades.map((t) => t.signalIndex)).toEqual([3]);
    expect(res.skipped).toBe(2);
  });

  it('หมดอายุก่อนถึงราคา → ยกเลิก', () => {
    const data = bars(Array.from({ length: 8 }, () => [100, 100.5, 99.5, 100] as [number, number, number, number]));
    const res = simulate(data, [long(0, 98, 103, { entryType: 'limit', entry: 99, expiryBars: 3 })], { tf: 'M15' });
    expect(res.trades).toHaveLength(0);
  });
});

describe('computeStats', () => {
  const mk = (r: number, i: number): Trade => ({
    signalIndex: i,
    entryIndex: i,
    exitIndex: i + 1,
    entryTime: i,
    exitTime: i + 1,
    direction: i % 2 ? 'short' : 'long',
    entry: 1,
    sl: 0,
    tp: 2,
    exit: 1,
    exitReason: r > 0 ? 'tp' : 'sl',
    r,
    barsHeld: 2,
    reason: '',
  });

  it('คิด win rate, expectancy, PF, max drawdown, แพ้ติดกัน', () => {
    const s = computeStats([2, -1, -1, -1, 2, 2].map(mk), { riskPct: 1, initialBalance: 1000 });
    expect(s.trades).toBe(6);
    expect(s.winRate).toBeCloseTo(0.5);
    expect(s.expectancyR).toBeCloseTo(0.5);
    expect(s.totalR).toBeCloseTo(3);
    expect(s.profitFactor).toBeCloseTo(2);
    expect(s.maxDrawdownR).toBeCloseTo(3); // จาก +2 ลงไป −1
    expect(s.maxConsecLosses).toBe(3);
    expect(s.finalBalance).toBeCloseTo(1000 * 1.02 * 0.99 ** 3 * 1.02 * 1.02);
  });

  it('ไม่มีเทรด → ค่าเป็นศูนย์ไม่ error', () => {
    expect(computeStats([], { riskPct: 1, initialBalance: 1000 }).trades).toBe(0);
  });
});

describe('htfView', () => {
  it('แท่ง H1 ใช้ได้ตั้งแต่แท่ง M15 ที่ปิดตรงกับเวลาปิดของ H1', () => {
    const ltf = generateSampleCandles({ count: 12, timeframe: 'M15', startPrice: 100, startTime: 0 });
    const v = htfView(ltf, 'M15', 'H1');
    expect(v.candles).toHaveLength(3);
    expect(v.availableAt).toEqual([3, 7, 11]); // แท่ง M15 ที่ 3 ปิดตอน 01:00 = H1 แรกปิด
    expect(lastClosedHtf(v, 2)).toBe(-1);
    expect(lastClosedHtf(v, 3)).toBe(0);
    expect(lastClosedHtf(v, 10)).toBe(1);
  });

  it('แท่ง HTF สุดท้ายที่ยังไม่ครบ → Infinity', () => {
    const ltf = generateSampleCandles({ count: 10, timeframe: 'M15', startPrice: 100, startTime: 0 });
    expect(htfView(ltf, 'M15', 'H1').availableAt.at(-1)).toBe(Infinity);
  });
});

describe('randomBaseline', () => {
  it('seed เดิมได้ผลเดิม และคืนค่าสถิติครบ', () => {
    const data = generateSampleCandles({ count: 3000, timeframe: 'M15', startPrice: 2650, seed: 3 });
    const sigs: Signal[] = [];
    for (let i = 50; i < 2900; i += 60) sigs.push(long(i, data[i]!.close - 5, data[i]!.close + 10));
    const { trades } = simulate(data, sigs, { tf: 'M15' });
    const a = randomBaseline(data, trades, { tf: 'M15' }, { runs: 50, seed: 1 });
    const b = randomBaseline(data, trades, { tf: 'M15' }, { runs: 50, seed: 1 });
    expect(a).toEqual(b);
    expect(a.runs).toBe(50);
    expect(a.p5).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p95);
    expect(a.percentile).toBeGreaterThanOrEqual(0);
    expect(a.percentile).toBeLessThanOrEqual(100);
  });
});

describe('runBacktest', () => {
  it('แบ่ง in-sample / out-of-sample ตามเวลา 70/30', () => {
    const data = generateSampleCandles({ count: 2000, timeframe: 'M15', startPrice: 2650, seed: 7 });
    const sigs: Signal[] = [];
    for (let i = 20; i < 1990; i += 40) sigs.push(long(i, data[i]!.close - 4, data[i]!.close + 8));
    const res = runBacktest(data, sigs, { tf: 'M15', baselineRuns: 20 });
    expect(res.splitTime).toBe(data[1400]!.time);
    expect(res.inSample.trades + res.outOfSample.trades).toBe(res.stats.trades);
    expect(res.trades.every((t, k) => k === 0 || t.entryIndex > res.trades[k - 1]!.exitIndex - 1)).toBe(true);
    expect(res.equity).toHaveLength(res.trades.length + 1);
    expect(res.baseline?.runs).toBe(20);
  });
});
