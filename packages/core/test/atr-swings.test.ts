import { describe, expect, it } from 'vitest';
import { atr } from '../src/indicators/atr';
import { detectSwings } from '../src/structure/swings';
import { hasEqualBodiesAtPivot } from '../src/structure/equal-bodies';
import { generateSampleCandles } from '../src/sample-data';
import type { Candle } from '../src/types';

/** แท่งจากราคา [open, high, low, close] เวลาห่าง 1 นาที */
const bars = (rows: [number, number, number, number][]): Candle[] =>
  rows.map(([open, high, low, close], i) => ({ time: i * 60_000, open, high, low, close, volume: 1 }));

describe('atr (Wilder)', () => {
  it('seed ด้วยค่าเฉลี่ย TR แล้วต่อแบบ RMA', () => {
    // TR: [2, 3, 4, 2] (แท่งแรก = high-low, แท่งต่อไปเทียบกับ close ก่อนหน้า)
    const c = bars([
      [10, 11, 9, 10],
      [10, 13, 10, 12], // max(3, |13-10|, |10-10|) = 3
      [12, 12, 8, 9], // max(4, 0, 4) = 4
      [9, 10, 8, 9], // max(2, 1, 1) = 2
    ]);
    const out = atr(c, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(3); // (2+3+4)/3
    expect(out[3]).toBeCloseTo((3 * 2 + 2) / 3);
  });

  it('ไม่แอบดูอนาคต', () => {
    const c = generateSampleCandles({ count: 200, timeframe: 'M5', startPrice: 2650 });
    const full = atr(c, 14);
    for (const cut of [13, 50, 199]) expect(atr(c.slice(0, cut + 1), 14)[cut]).toBe(full[cut]);
  });
});

describe('detectSwings', () => {
  //            idx: 0   1   2   3   4   5   6   7   8
  // high:           10  11  12  15  12  11  13  12  11
  // low:             8   9  10  13  10   7   9  10   9
  //                          ▲ swing high @3   ▼ swing low @5
  //                                                ▲ swing high @6 (13 > 11,12 ซ้าย และ ≥ 12,11 ขวา)
  const c = bars([
    [9, 10, 8, 9],
    [9, 11, 9, 10],
    [10, 12, 10, 11],
    [11, 15, 13, 14],
    [14, 12, 10, 11],
    [11, 11, 7, 8],
    [8, 13, 9, 12],
    [12, 12, 10, 11],
    [11, 11, 9, 10],
  ]);

  it('หา swing high/low ด้วย N แท่งซ้ายขวา และยืนยันที่แท่ง j+N', () => {
    const s = detectSwings(c, { swingLength: 2 });
    expect(s).toEqual([
      { kind: 'high', pivotIndex: 3, confirmIndex: 5, price: 15, time: 3 * 60_000 },
      { kind: 'low', pivotIndex: 5, confirmIndex: 7, price: 7, time: 5 * 60_000 },
      { kind: 'high', pivotIndex: 6, confirmIndex: 8, price: 13, time: 6 * 60_000 },
    ]);
  });

  it('ยอดเท่ากันติดกัน นับเป็น swing เดียว (ตัวแรก)', () => {
    const flat = bars([
      [1, 2, 1, 1],
      [1, 3, 1, 1],
      [1, 5, 1, 1],
      [1, 5, 1, 1],
      [1, 3, 1, 1],
      [1, 2, 1, 1],
    ]);
    const highs = detectSwings(flat, { swingLength: 2 }).filter((x) => x.kind === 'high');
    expect(highs.map((x) => x.pivotIndex)).toEqual([2]);
  });

  it('ข้อมูลยังไม่ครบ N แท่งขวา → ยังไม่นับ', () => {
    expect(detectSwings(c.slice(0, 5), { swingLength: 2 })).toEqual([]);
  });

  it('ไม่แอบดูอนาคต', () => {
    const data = generateSampleCandles({ count: 400, timeframe: 'M5', startPrice: 2650, seed: 3 });
    const full = detectSwings(data, { swingLength: 3 });
    for (const cut of [10, 77, 200, 399]) {
      const partial = detectSwings(data.slice(0, cut + 1), { swingLength: 3 });
      expect(partial).toEqual(full.filter((s) => s.confirmIndex <= cut));
    }
  });
});

describe('hasEqualBodiesAtPivot (กฎ "เนื้อเท่ากัน 2 แท่ง" ของริวเรน)', () => {
  it('ยอด: แท่งเขียวปิด = แท่งแดงถัดไปเปิด → จริง', () => {
    const c = bars([
      [10, 11, 9, 10],
      [10, 15, 10, 14], // เขียว ปิด 14
      [14, 15.5, 11, 12], // แดง เปิด 14 ← เนื้อชนกันที่ 14
      [12, 13, 10, 11],
    ]);
    expect(hasEqualBodiesAtPivot(c, 2, 'high', 0.05)).toBe(true);
  });

  it('ยอด: เนื้อไม่ชนกัน → เท็จ', () => {
    const c = bars([
      [10, 11, 9, 10],
      [10, 15, 10, 13],
      [14, 15.5, 11, 12],
      [12, 13, 10, 11],
    ]);
    expect(hasEqualBodiesAtPivot(c, 2, 'high', 0.05)).toBe(false);
  });

  it('ก้น: แท่งแดงปิด = แท่งเขียวถัดไปเปิด (อยู่ใน tolerance)', () => {
    const c = bars([
      [12, 13, 11, 12],
      [12, 12, 8, 9], // แดง ปิด 9
      [9.03, 11, 7.5, 10.5], // เขียว เปิด 9.03
      [10.5, 11, 10, 10.8],
    ]);
    expect(hasEqualBodiesAtPivot(c, 2, 'low', 0.05)).toBe(true);
    expect(hasEqualBodiesAtPivot(c, 2, 'low', 0.01)).toBe(false);
  });
});
