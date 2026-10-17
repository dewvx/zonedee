import { describe, expect, it } from 'vitest';
import { computeZones } from '../src/zones/sr-zones';
import { generateSampleCandles } from '../src/sample-data';
import type { Candle } from '../src/types';

const bars = (rows: [number, number, number, number][]): Candle[] =>
  rows.map(([open, high, low, close], i) => ({ time: i * 60_000, open, high, low, close, volume: 1 }));

/** แท่งนิ่งๆ ช่วงราคา [mid-1, mid+1] ไว้เติมให้ ATR อุ่นเครื่อง (ATR ≈ 2) */
const flat = (n: number, mid: number): [number, number, number, number][] =>
  Array.from({ length: n }, () => [mid, mid + 1, mid - 1, mid] as [number, number, number, number]);

// ใช้ค่าที่ทำให้เทสต์คุมได้ง่าย
const cfg = { atrPeriod: 3, swingLength: 2, zoneMergeAtr: 0.5, zoneWidthAtr: 0.2, maxZones: 10 };

describe('computeZones', () => {
  /*
   * ยอด 2 ครั้งที่ ~110 → โซนแนวต้านเดียว แตะ 2 ครั้ง
   *            ▲110        ▲110.4
   *   100 ____/  \__100__/  \____100
   */
  const doubleTop = bars([
    ...flat(5, 100),
    [100, 104, 99, 103],
    [103, 110, 102, 108], // swing high 110
    [108, 106, 101, 102],
    [102, 103, 99, 100],
    [100, 101, 99, 100],
    [100, 104, 99, 103],
    [103, 110.4, 102, 108], // swing high 110.4 (ห่าง 0.4 < 0.5×ATR) → รวมโซน
    [108, 106, 101, 102],
    [102, 103, 99, 100],
    [100, 101, 99, 100],
  ]);

  it('ยอดใกล้กัน 2 ครั้งรวมเป็นโซนแนวต้านเดียว แตะ 2 ครั้ง', () => {
    const zones = computeZones(doubleTop, cfg);
    const res = zones.filter((z) => z.role === 'resistance');
    expect(res).toHaveLength(1);
    expect(res[0]!.touches).toBe(2);
    expect(res[0]!.bottom).toBeLessThan(110);
    expect(res[0]!.top).toBeGreaterThan(110.4);
    expect(res[0]!.state).toBe('tested');
  });

  it('ปิดทะลุแนวต้าน → กลายเป็นแนวรับ (RBS) สถานะ flipped', () => {
    const breakout = bars([
      ...doubleTop.map((c) => [c.open, c.high, c.low, c.close] as [number, number, number, number]),
      [100, 108, 99, 107],
      [107, 115, 106, 114], // ปิด 114 > ขอบบนโซน → เบรก
      [114, 116, 112, 115],
    ]);
    const zone = computeZones(breakout, cfg).find((z) => z.origin === 'high' && z.touches === 2)!;
    expect(zone.role).toBe('support');
    expect(zone.state).toBe('flipped');
    expect(zone.label).toBe('RBS');
  });

  it('ทะลุซ้ำหลังกลับขั้วแล้ว → โซนถูกทิ้ง', () => {
    const rows = [
      ...doubleTop.map((c) => [c.open, c.high, c.low, c.close] as [number, number, number, number]),
      [100, 108, 99, 107],
      [107, 115, 106, 114], // เบรกขึ้น → RBS
      [114, 116, 112, 115],
      [115, 115, 100, 101], // ปิด 101 < ขอบล่าง → เบรกลงอีก → ทิ้ง
      [101, 102, 98, 99],
    ] as [number, number, number, number][];
    const zones = computeZones(bars(rows), cfg);
    expect(zones.find((z) => z.touches === 2 && z.origin === 'high')).toBeUndefined();
  });

  it('maxZones จำกัดจำนวน และผลเรียงจากราคาสูง → ต่ำ', () => {
    const data = generateSampleCandles({ count: 800, timeframe: 'M15', startPrice: 2650, seed: 9 });
    const zones = computeZones(data, { maxZones: 5 });
    expect(zones.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < zones.length; i++) expect(zones[i - 1]!.center).toBeGreaterThanOrEqual(zones[i]!.center);
  });

  it('โซนที่แสดงไม่ซ้อนทับกันถ้าบทบาทเดียวกัน', () => {
    const data = generateSampleCandles({ count: 3000, timeframe: 'M15', startPrice: 2650, seed: 77, volatility: 0.004 });
    const zones = computeZones(data, { maxZones: 30 });
    for (const role of ['resistance', 'support'] as const) {
      const list = zones.filter((z) => z.role === role).sort((a, b) => a.bottom - b.bottom);
      for (let i = 1; i < list.length; i++) expect(list[i]!.bottom).toBeGreaterThan(list[i - 1]!.top);
    }
  });

  it('แบ่งโควต้าโซนทั้งเหนือและใต้ราคา', () => {
    const data = generateSampleCandles({ count: 3000, timeframe: 'M15', startPrice: 2650, seed: 77, volatility: 0.004 });
    const price = data.at(-1)!.close;
    const all = computeZones(data, { maxZones: 50 });
    const picked = computeZones(data, { maxZones: 6 });
    const aboveAvail = all.filter((z) => z.center >= price).length;
    const belowAvail = all.filter((z) => z.center < price).length;
    expect(picked.filter((z) => z.center >= price).length).toBe(Math.min(aboveAvail, Math.max(3, 6 - belowAvail)));
    expect(picked.filter((z) => z.center < price).length).toBe(Math.min(belowAvail, Math.max(3, 6 - aboveAvail)));
  });

  it('ryuMode เอาเฉพาะโซนที่มีเนื้อเท่ากัน', () => {
    const data = generateSampleCandles({ count: 1500, timeframe: 'M15', startPrice: 2650, seed: 4, digits: 1 });
    const zones = computeZones(data, { ryuMode: true, maxZones: 50 });
    expect(zones.every((z) => z.equalBodies)).toBe(true);
  });

  it('ไม่แอบดูอนาคต: โซน ณ แท่ง cut จากข้อมูลทั้งหมด = จากข้อมูลถึง cut', () => {
    const data = generateSampleCandles({ count: 1000, timeframe: 'M15', startPrice: 2650, seed: 21 });
    for (const cut of [100, 333, 640, 999]) {
      expect(computeZones(data, {}, cut)).toEqual(computeZones(data.slice(0, cut + 1), {}));
    }
  });

  it('ข้อมูลน้อยกว่าที่ ATR ต้องใช้ → ไม่มีโซน', () => {
    expect(computeZones(doubleTop.slice(0, 3), { atrPeriod: 14 })).toEqual([]);
  });
});
