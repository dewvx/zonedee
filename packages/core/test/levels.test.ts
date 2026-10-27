import { describe, expect, it } from 'vitest';
import { keyLevels } from '../src/scan/key-levels';
import { rebalance } from '../src/scan/rebalance';
import { scanStock } from '../src/scan/stock-scan';
import type { Candle } from '../src/types';

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 0, 1);

/** แท่งจากเส้นทางราคา (ลากเส้นตรงระหว่างจุด ทีละ 1 แท่ง) ไส้ ±0.5 */
function path(points: number[], step = 4): Candle[] {
  const closes: number[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!;
    const b = points[k + 1]!;
    for (let s = 0; s < step; s++) closes.push(a + ((b - a) * s) / step);
  }
  closes.push(points.at(-1)!);
  return closes.map((c, i) => {
    const prev = i > 0 ? closes[i - 1]! : c;
    return { time: T0 + i * DAY, open: prev, high: Math.max(prev, c) + 0.5, low: Math.min(prev, c) - 0.5, close: c, volume: 1e6 };
  });
}

// ไซด์เวย์ 90 ↔ 110 หลายรอบ
//  110 ┤  /\    /\    /\
//  100 ┤ /  \  /  \  /  \  ...
//   90 ┤/    \/    \/    \/
// (ATR 14 ต้องมีข้อมูลก่อน swing แรกถึงจะนับ — เลยวนหลายรอบ)
const range = [100, 110, 90, 110, 90, 110, 90, 110, 90, 110, 90];
const opts = { swingLength: 2, breakWithinBars: 3 };

describe('keyLevels (แนวรับต้านแบบง่าย)', () => {
  it('อยู่กลางกรอบ → แนวรับ ~90 แนวต้าน ~110 ห่างราว ±10%', () => {
    const lv = keyLevels(path([...range, 100]), opts)!;
    expect(lv.close).toBe(100);
    expect(lv.supports[0]!.price).toBeCloseTo(89.5, 0);
    expect(lv.resistances[0]!.price).toBeCloseTo(110.5, 0);
    expect(lv.supports[0]!.distancePct).toBeLessThan(-9);
    expect(lv.resistances[0]!.distancePct).toBeGreaterThan(9);
    expect(lv.supports[0]!.touches).toBeGreaterThanOrEqual(2);
    expect(lv.status).toBe('between');
  });

  it('ลงมาใกล้ 90 → near-support', () => {
    const lv = keyLevels(path([...range, 105, 91.5]), opts)!;
    expect(lv.nearSupport).toBe(true);
    expect(lv.status).toBe('near-support');
  });

  it('ปิดทะลุ 110 → broke-resistance · ปิดหลุด 90 → broke-support', () => {
    const up = keyLevels(path([...range, 100, 109, 116], 2), opts)!;
    expect(up.brokeResistance).not.toBeNull();
    expect(up.status).toBe('broke-resistance');
    const down = keyLevels(path([...range, 100, 91, 84], 2), opts)!;
    expect(down.brokeSupport).not.toBeNull();
    expect(down.status).toBe('broke-support');
  });

  it('ตัวสแกนติดป้ายใกล้แนวรับ / ทะลุแนวต้าน (ใช้ swing D1 ค่าเริ่มต้น)', () => {
    const near = scanStock(path([...range, 105, 91.5], 6))!;
    expect(near.levels?.status).toBe('near-support');
    expect(near.signals).toContain('near-support');
    // ขึ้นช้าๆ มาที่ 108 แล้ว 2 แท่งสุดท้ายพุ่งทะลุ 110 (ภายใน 3 แท่ง)
    const base = path([...range, 100, 108], 6);
    const up = scanStock([...base, ...[109, 115].map((c, k) => ({ ...base.at(-1)!, time: base.at(-1)!.time + (k + 1) * DAY, open: k ? 109 : 108, high: c + 0.5, low: (k ? 109 : 108) - 0.5, close: c }))])!;
    expect(up.signals).toContain('broke-resistance');
    expect(up.signals).not.toContain('near-support');
  });

  it('ข้อมูลไม่พอ → null', () => {
    expect(keyLevels(path([100]).slice(0, 1))).toBeNull();
  });

  it('ไม่แอบดูอนาคต: keyLevels ที่ asOf = คำนวณจากข้อมูลถึง asOf', () => {
    const c = path([...range, 100, 109, 116, 104, 95, 99], 3);
    for (const cut of [16, 30, 38, 45, c.length - 2]) {
      expect(keyLevels(c, opts, cut)).toEqual(keyLevels(c.slice(0, cut + 1), opts));
    }
  });
});

describe('rebalance', () => {
  const items = [
    { symbol: 'VOO', value: 700, price: 500, targetPct: 60 },
    { symbol: 'QQQ', value: 300, price: 400, targetPct: 40 },
  ];

  it('DCA ซื้ออย่างเดียว: เงินลงตัวที่ต่ำกว่าเป้า', () => {
    // รวมหลังเติม 1,200 → VOO เป้า 720 (ขาด 20), QQQ เป้า 480 (ขาด 180) → ขาดรวม 200 = งบพอดี
    const r = rebalance(items, { budget: 200 })!;
    expect(r.rows.map((x) => +x.trade.toFixed(2))).toEqual([20, 180]);
    expect(r.rows[1]!.shares).toBeCloseTo(0.45);
    expect(r.rows[0]!.afterPct).toBeCloseTo(60);
  });

  it('งบน้อยกว่าที่ขาด → แบ่งตามสัดส่วนที่ขาด ไม่มีการขาย', () => {
    // หลังเติม 1,050 → VOO 630 (เกิน), QQQ 420 (ขาด 120) → ใส่ QQQ ทั้งหมด 50
    const r = rebalance(items, { budget: 50 })!;
    expect(r.rows.map((x) => +x.trade.toFixed(2))).toEqual([0, 50]);
    expect(r.rows.every((x) => x.trade >= 0)).toBe(true);
  });

  it('ปรับเต็ม (allowSell): ขายตัวที่เกิน ซื้อตัวที่ขาด', () => {
    const r = rebalance(items, { budget: 0, allowSell: true })!;
    expect(r.rows.map((x) => +x.trade.toFixed(2))).toEqual([-100, 100]);
  });

  it('เป้ารวมไม่ถึง 100 → normalize · ไม่ใส่เป้า = ไม่ร่วม · ไม่มีเป้าเลย = null', () => {
    const r = rebalance([...items.map((i) => ({ ...i, targetPct: i.targetPct / 2 })), { symbol: 'X', value: 50, price: 1, targetPct: null }], { budget: 200 })!;
    expect(r.targetSum).toBe(50);
    expect(r.rows.map((x) => x.symbol)).toEqual(['VOO', 'QQQ']);
    expect(r.rows[0]!.targetPct).toBeCloseTo(60);
    expect(rebalance(items.map((i) => ({ ...i, targetPct: null })), { budget: 100 })).toBeNull();
  });
});
