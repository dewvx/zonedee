import { describe, expect, it } from 'vitest';
import { calcPosition, roundToStep, type ContractSpec } from '../src/risk/position';
import { rMultiple } from '../src/risk/r-multiple';

const EURUSD: ContractSpec = {
  symbol: 'EURUSD',
  contractSize: 100_000,
  tickSize: 0.00001,
  tickValue: 1, // 0.00001 × 100,000 = $1 ต่อ tick ต่อ 1 lot
  volumeMin: 0.01,
  volumeStep: 0.01,
  volumeMax: 100,
  digits: 5,
  marginMode: 'quote', // margin = lots × contract × ราคา / leverage
  unit: 'lot',
};

const GOLD: ContractSpec = {
  symbol: 'GOLD',
  contractSize: 100,
  tickSize: 0.01,
  tickValue: 1, // 0.01 × 100 oz = $1
  volumeMin: 0.01,
  volumeStep: 0.01,
  volumeMax: 50,
  digits: 2,
  marginMode: 'quote',
  unit: 'lot',
};

describe('roundToStep', () => {
  it('ปัดลงตาม step และไม่เพี้ยนทศนิยม', () => {
    expect(roundToStep(0.0333, 0.01)).toBe(0.03);
    expect(roundToStep(0.1, 0.01)).toBe(0.1);
    expect(roundToStep(0.29999999, 0.01)).toBe(0.29);
    expect(roundToStep(1.23456, 0.0001)).toBe(1.2345);
  });
});

describe('calcPosition', () => {
  it('ตัวอย่างในหนังสือ Braron: ทุน $1,000 เสี่ยง 2% SL 20 pips EURUSD → 0.10 lot', () => {
    const r = calcPosition({ spec: EURUSD, balance: 1000, riskPct: 2, entry: 1.1, sl: 1.098, tp: 1.104 });
    expect(r.valid).toBe(true);
    expect(r.direction).toBe('long');
    expect(r.riskAmount).toBeCloseTo(20);
    expect(r.slPoints).toBe(200);
    expect(r.slPips).toBeCloseTo(20);
    expect(r.lossPerLot).toBeCloseTo(200);
    expect(r.lots).toBe(0.1);
    expect(r.actualRisk).toBeCloseTo(20);
    expect(r.rr).toBeCloseTo(2);
    expect(r.profit).toBeCloseTo(40);
  });

  it('ทอง: ทุน $1,000 เสี่ยง 1% SL $3 (300 points) → 0.03 lot, ความเสี่ยงจริง $9', () => {
    const r = calcPosition({ spec: GOLD, balance: 1000, riskPct: 1, entry: 4621, sl: 4618, tp: 4630 });
    expect(r.slPoints).toBe(300);
    expect(r.lots).toBe(0.03);
    expect(r.actualRisk).toBeCloseTo(9);
    expect(r.actualRiskPct).toBeCloseTo(0.9);
    expect(r.rr).toBeCloseTo(3);
    expect(r.profit).toBeCloseTo(27);
  });

  it('ขาย (short): SL อยู่เหนือ entry', () => {
    const r = calcPosition({ spec: GOLD, balance: 10_000, riskPct: 1, entry: 4621, sl: 4626, tp: 4611 });
    expect(r.direction).toBe('short');
    expect(r.valid).toBe(true);
    expect(r.lots).toBe(0.2); // $100 / ($5 × 100) = 0.2
    expect(r.rr).toBeCloseTo(2);
  });

  it('spread ถูกนับเข้าความเสี่ยง', () => {
    const noSpread = calcPosition({ spec: GOLD, balance: 10_000, riskPct: 1, entry: 4621, sl: 4618 });
    const withSpread = calcPosition({ spec: GOLD, balance: 10_000, riskPct: 1, entry: 4621, sl: 4618, spreadPoints: 30 });
    expect(withSpread.lossPerLot).toBeCloseTo(noSpread.lossPerLot + 30);
    expect(withSpread.lots).toBeLessThan(noSpread.lots);
  });

  it('ต่ำกว่า lot ขั้นต่ำ → lots = 0 พร้อมคำเตือนและความเสี่ยงถ้าใช้ lot ขั้นต่ำ', () => {
    const r = calcPosition({ spec: GOLD, balance: 100, riskPct: 1, entry: 4621, sl: 4611 });
    expect(r.lots).toBe(0);
    expect(r.minLotRisk).toBeCloseTo(10); // 0.01 lot × 1,000 ticks × $1
    expect(r.warnings.join(' ')).toMatch(/lot ขั้นต่ำ/);
  });

  it('TP ผิดฝั่ง → ไม่ valid', () => {
    const r = calcPosition({ spec: GOLD, balance: 1000, riskPct: 1, entry: 4621, sl: 4618, tp: 4615 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/TP/);
  });

  it('SL = entry → ไม่ valid', () => {
    expect(calcPosition({ spec: GOLD, balance: 1000, riskPct: 1, entry: 4621, sl: 4621 }).valid).toBe(false);
  });

  it('R:R ต่ำกว่า minRR → เตือน', () => {
    const r = calcPosition({ spec: GOLD, balance: 1000, riskPct: 1, entry: 4621, sl: 4618, tp: 4624, minRR: 2 });
    expect(r.rr).toBeCloseTo(1);
    expect(r.warnings.join(' ')).toMatch(/R:R/);
  });

  it('margin: quote = lots × contract × ราคา / leverage · base = lots × contract / leverage', () => {
    const g = calcPosition({ spec: GOLD, balance: 10_000, riskPct: 1, entry: 4000, sl: 3995, leverage: 1000 });
    expect(g.lots).toBe(0.2);
    expect(g.margin).toBeCloseTo((0.2 * 100 * 4000) / 1000);
    const jpy = calcPosition({
      spec: { ...EURUSD, symbol: 'USDJPY', tickSize: 0.001, tickValue: 100 / 150, digits: 3, marginMode: 'base' },
      balance: 10_000,
      riskPct: 1,
      entry: 150,
      sl: 149.5,
      leverage: 500,
    });
    expect(jpy.margin).toBeCloseTo((jpy.lots * 100_000) / 500);
  });

  it('หุ้น (ไม่มี leverage): เงินที่ต้องใช้ = จำนวนหุ้น × ราคา', () => {
    const stock: ContractSpec = {
      symbol: 'AAPL',
      contractSize: 1,
      tickSize: 0.01,
      tickValue: 0.01,
      volumeMin: 0.0001,
      volumeStep: 0.0001,
      volumeMax: 1_000_000,
      digits: 2,
      marginMode: 'quote',
      unit: 'share',
    };
    const r = calcPosition({ spec: stock, balance: 1000, riskPct: 2, entry: 200, sl: 190, leverage: 1 });
    expect(r.lots).toBe(2); // เสี่ยง $20 / $10 ต่อหุ้น
    expect(r.margin).toBeCloseTo(400);
  });
});


describe('rMultiple (journal)', () => {
  it('buy เข้า 100 SL 98 ออก 105 = +2.5R · ออก 98 = −1R', () => {
    expect(rMultiple('long', 100, 98, 105)).toBeCloseTo(2.5);
    expect(rMultiple('long', 100, 98, 98)).toBeCloseTo(-1);
  });
  it('sell เข้า 100 SL 102 ออก 97 = +1.5R', () => {
    expect(rMultiple('short', 100, 102, 97)).toBeCloseTo(1.5);
  });
  it('ไม่มี SL → null', () => {
    expect(rMultiple('long', 100, null, 105)).toBeNull();
    expect(rMultiple('long', 100, 100, 105)).toBeNull();
  });
});
