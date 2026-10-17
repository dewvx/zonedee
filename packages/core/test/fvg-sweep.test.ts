import { describe, expect, it } from 'vitest';
import { detectFVGs } from '../src/structure/fvg';
import { detectSweeps } from '../src/structure/sweeps';
import { generateSampleCandles } from '../src/sample-data';
import type { Candle } from '../src/types';

const bars = (rows: [number, number, number, number][]): Candle[] =>
  rows.map(([open, high, low, close], i) => ({ time: i * 60_000, open, high, low, close, volume: 1 }));

/*
 *  bull FVG: high[0]=11 < low[2]=12 → ช่อง 11–12 (เกิดที่แท่ง 2)
 *  bar 4 low 11.5 เข้ามาในช่อง → partial · bar 5 low 10.5 ≤ 11 → filled
 *  bear FVG: low[3]=13 > high[5]=12.5 → ช่อง 12.5–13 (เกิดที่แท่ง 5)
 */
const FVG_FIXTURE = bars([
  [10, 11, 9, 10.5],
  [10.5, 14, 10.4, 13.8],
  [13.8, 15, 12, 14.5],
  [14.5, 15, 13, 14],
  [14, 14.2, 11.5, 12],
  [12, 12.5, 10.5, 11],
]);
const fcfg = { fvgMinAtr: 0, atrPeriod: 1 };

describe('detectFVGs', () => {
  const bull = (state: string, filledIndex: number | null) => ({
    id: 'fvg-bull-2',
    direction: 'bull',
    top: 12,
    bottom: 11,
    startIndex: 0,
    startTime: 0,
    confirmIndex: 2,
    state,
    filledIndex,
  });

  it('เกิดช่องว่าง → open', () => {
    expect(detectFVGs(FVG_FIXTURE, fcfg, 3)).toEqual([bull('open', null)]);
  });

  it('ราคาเข้ามาบางส่วน → partial', () => {
    expect(detectFVGs(FVG_FIXTURE, fcfg, 4)).toEqual([bull('partial', null)]);
  });

  it('ราคาปิดช่องทั้งหมด → filled · ช่องขาลงใหม่ → open', () => {
    expect(detectFVGs(FVG_FIXTURE, fcfg)).toEqual([
      bull('filled', 5),
      {
        id: 'fvg-bear-5',
        direction: 'bear',
        top: 13,
        bottom: 12.5,
        startIndex: 3,
        startTime: 3 * 60_000,
        confirmIndex: 5,
        state: 'open',
        filledIndex: null,
      },
    ]);
  });

  it('ช่องเล็กกว่า fvgMinAtr × ATR ไม่นับ', () => {
    expect(detectFVGs(FVG_FIXTURE, { fvgMinAtr: 5, atrPeriod: 1 })).toEqual([]);
  });

  it('ไม่แอบดูอนาคต', () => {
    const data = generateSampleCandles({ count: 1500, timeframe: 'M5', startPrice: 2650, seed: 15 });
    expect(detectFVGs(data).length).toBeGreaterThan(5);
    for (const cut of [100, 555, 1499]) {
      expect(detectFVGs(data, {}, cut)).toEqual(detectFVGs(data.slice(0, cut + 1), {}));
    }
  });
});

/*
 * swingLength = 1
 *  swing high @1 = 13 → bar 4 ไส้ขึ้นไป 13.6 แต่ปิด 12.8 → sweep (กวาดฝั่ง buy-side ก่อนลง)
 *  swing low  @3 = 10.5 → bar 6 ไส้ลงไป 10.2 แต่ปิด 10.9 → sweep (กวาดฝั่ง sell-side ก่อนขึ้น)
 *  bar 5 ไส้เกิน 13 อีกรอบ แต่ swing นั้นถูกกวาดไปแล้ว → ไม่นับซ้ำ
 */
const SWEEP_FIXTURE = bars([
  [10, 11, 9, 10],
  [10, 13, 10, 12],
  [12, 12.5, 11, 11.5],
  [11.5, 12, 10.5, 11],
  [11, 13.6, 10.8, 12.8],
  [12.8, 13.2, 12, 12.2],
  [12.2, 12.4, 10.2, 10.9],
]);

describe('detectSweeps', () => {
  it('ไส้ทะลุ swing แต่ปิดกลับเข้ามา = sweep (นับครั้งเดียวต่อ swing)', () => {
    expect(detectSweeps(SWEEP_FIXTURE, { swingLength: 1 })).toEqual([
      { direction: 'bear', level: 13, swingIndex: 1, index: 4, time: 4 * 60_000, confirmIndex: 4 },
      { direction: 'bull', level: 10.5, swingIndex: 3, index: 6, time: 6 * 60_000, confirmIndex: 6 },
    ]);
  });

  it('ปิดทะลุ = เบรก ไม่ใช่ sweep', () => {
    const rows = SWEEP_FIXTURE.map((c) => [c.open, c.high, c.low, c.close] as [number, number, number, number]);
    rows[4] = [11, 13.6, 10.8, 13.4]; // ปิด 13.4 > 13
    expect(detectSweeps(bars(rows), { swingLength: 1 }).filter((s) => s.direction === 'bear')).toEqual([]);
  });

  it('ไม่แอบดูอนาคต', () => {
    const data = generateSampleCandles({ count: 1500, timeframe: 'M5', startPrice: 2650, seed: 16 });
    const full = detectSweeps(data);
    expect(full.length).toBeGreaterThan(3);
    for (const cut of [90, 700, 1499]) {
      expect(detectSweeps(data.slice(0, cut + 1))).toEqual(full.filter((e) => e.confirmIndex <= cut));
    }
  });
});
