import { describe, expect, it } from 'vitest';
import { detectStructure } from '../src/structure/market-structure';
import { detectBoBoxes } from '../src/structure/bo-boxes';
import { detectOrderBlocks } from '../src/structure/order-blocks';
import { generateSampleCandles } from '../src/sample-data';
import type { Candle } from '../src/types';

const bars = (rows: [number, number, number, number][]): Candle[] =>
  rows.map(([open, high, low, close], i) => ({ time: i * 60_000, open, high, low, close, volume: 1 }));

/*
 * swingLength = 1
 *  idx: 0    1    2    3     4    5     6     7    8    9    10    11   12
 *  high 11   13  [15]  14    13   14    16   [17] 16.8  15   14   14.5 14.2
 *  low   9   10   11   12   [11]  11.2  13    15   14   13  [12.5] 13   10
 *  close10   12   14   12.5 11.5  13.5 15.8  16.5 14.5 13.2 13.8  14   10.5
 *
 *  bar 6 ปิด 15.8 > swing high 15 (@2) → BOS ขาขึ้น (ยังไม่มีเทรนด์ = BOS)
 *        ฐาน = low ต่ำสุดระหว่าง @2..@6 = 11 (@4)
 *  bar 12 ปิด 10.5 < swing low 12.5 (@10) ขณะเทรนด์ขึ้น → CHoCH ขาลง
 *        ฐาน = high สูงสุดระหว่าง @10..@12 = 14.5 (@11)
 */
const FIXTURE = bars([
  [10, 11, 9, 10],
  [10, 13, 10, 12],
  [12, 15, 11, 14],
  [14, 14, 12, 12.5],
  [12.5, 13, 11, 11.5],
  [11.5, 14, 11.2, 13.5],
  [13.5, 16, 13, 15.8],
  [15.8, 17, 15, 16.5],
  [16.5, 16.8, 14, 14.5],
  [14.5, 15, 13, 13.2],
  [13.2, 14, 12.5, 13.8],
  [13.8, 14.5, 13, 14],
  [14, 14.2, 10, 10.5],
]);
const cfg = { swingLength: 1, atrPeriod: 1, obImpulseAtr: 0 };

describe('detectStructure (BOS / CHoCH)', () => {
  it('BOS ขาขึ้น แล้ว CHoCH ขาลง พร้อมฐานของขาที่เบรก', () => {
    expect(detectStructure(FIXTURE, cfg)).toEqual([
      {
        type: 'BOS',
        direction: 'bull',
        level: 15,
        swingIndex: 2,
        swingTime: 2 * 60_000,
        breakIndex: 6,
        breakTime: 6 * 60_000,
        confirmIndex: 6,
        originIndex: 4,
        originPrice: 11,
      },
      {
        type: 'CHoCH',
        direction: 'bear',
        level: 12.5,
        swingIndex: 10,
        swingTime: 10 * 60_000,
        breakIndex: 12,
        breakTime: 12 * 60_000,
        confirmIndex: 12,
        originIndex: 11,
        originPrice: 14.5,
      },
    ]);
  });

  it("breakBy = 'close': ไส้ทะลุแต่ปิดไม่ทะลุ → ยังไม่เบรก / 'wick' → เบรก", () => {
    const rows = FIXTURE.slice(0, 7).map((c) => [c.open, c.high, c.low, c.close] as [number, number, number, number]);
    rows[6] = [13.5, 16, 13, 14.8]; // ไส้ 16 > 15 แต่ปิด 14.8
    const data = bars(rows);
    expect(detectStructure(data, cfg)).toEqual([]);
    expect(detectStructure(data, { ...cfg, breakBy: 'wick' })).toHaveLength(1);
  });

  it('ไม่แอบดูอนาคต', () => {
    const data = generateSampleCandles({ count: 1500, timeframe: 'M5', startPrice: 2650, seed: 12 });
    const full = detectStructure(data);
    expect(full.length).toBeGreaterThan(5);
    for (const cut of [50, 400, 901, 1499]) {
      expect(detectStructure(data.slice(0, cut + 1))).toEqual(full.filter((e) => e.confirmIndex <= cut));
      expect(detectStructure(data, {}, cut)).toEqual(full.filter((e) => e.confirmIndex <= cut));
    }
  });
});

describe('detectBoBoxes (กรอบ Bo buy / Bo sell — D5)', () => {
  it('กรอบ Bo buy = จาก swing high ที่ถูกเบรก ลงไปถึงฐาน · ราคากลับมาแตะ = tested', () => {
    expect(detectBoBoxes(FIXTURE, cfg, 11)).toEqual([
      {
        id: 'bull-2',
        direction: 'bull',
        top: 15,
        bottom: 11,
        startTime: 2 * 60_000,
        createdIndex: 6,
        state: 'tested', // bar 8 low 14 เข้ามาในกรอบ
        eventType: 'BOS',
      },
    ]);
  });

  it('ปิดทะลุขอบล่าง → กรอบ buy หมดอายุ · กรอบ sell ใหม่เกิด', () => {
    expect(detectBoBoxes(FIXTURE, cfg)).toEqual([
      {
        id: 'bear-10',
        direction: 'bear',
        top: 14.5,
        bottom: 12.5,
        startTime: 10 * 60_000,
        createdIndex: 12,
        state: 'fresh',
        eventType: 'CHoCH',
      },
    ]);
  });

  it('ไม่แอบดูอนาคต', () => {
    const data = generateSampleCandles({ count: 1500, timeframe: 'M5', startPrice: 2650, seed: 13 });
    for (const cut of [120, 777, 1499]) {
      expect(detectBoBoxes(data, {}, cut)).toEqual(detectBoBoxes(data.slice(0, cut + 1), {}));
    }
  });
});

describe('detectOrderBlocks', () => {
  it('OB ขาขึ้น = แท่งแดงสุดท้ายที่ฐาน (@4) · ราคากลับมาแตะ = tested', () => {
    expect(detectOrderBlocks(FIXTURE, cfg, 11)).toEqual([
      { id: 'ob-bull-4', direction: 'bull', top: 13, bottom: 11, index: 4, startTime: 4 * 60_000, createdIndex: 6, state: 'tested' },
    ]);
  });

  it('ปิดทะลุ OB → ทิ้ง · OB ขาลง = แท่งเขียวสุดท้ายที่ฐาน (@11)', () => {
    expect(detectOrderBlocks(FIXTURE, cfg)).toEqual([
      { id: 'ob-bear-11', direction: 'bear', top: 14.5, bottom: 13, index: 11, startTime: 11 * 60_000, createdIndex: 12, state: 'fresh' },
    ]);
  });

  it('การวิ่งไม่แรงพอ (obImpulseAtr สูง) → ไม่นับเป็น OB', () => {
    expect(detectOrderBlocks(FIXTURE, { ...cfg, obImpulseAtr: 100 })).toEqual([]);
  });

  it('ไม่แอบดูอนาคต', () => {
    const data = generateSampleCandles({ count: 1500, timeframe: 'M5', startPrice: 2650, seed: 14 });
    for (const cut of [200, 640, 1499]) {
      expect(detectOrderBlocks(data, {}, cut)).toEqual(detectOrderBlocks(data.slice(0, cut + 1), {}));
    }
  });
});
