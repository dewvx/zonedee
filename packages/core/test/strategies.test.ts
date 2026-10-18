import { describe, expect, it } from 'vitest';
import { generateSampleCandles } from '../src/sample-data';
import { STRATEGIES, confirmStates, fiboPrice, findCrtSetups, pickHtf, resolveParams } from '../src/strategies';
import type { StructureEvent } from '../src/structure/market-structure';
import type { Candle } from '../src/types';

const H = 3_600_000;
const htfBar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  time: i * 4 * H,
  open,
  high,
  low,
  close,
  volume: 1,
});

describe('ทุกท่า: สัญญาณถูกต้อง + ไม่แอบดูอนาคต', () => {
  const data = generateSampleCandles({ count: 6000, timeframe: 'M5', startPrice: 2650, seed: 5 });

  for (const s of STRATEGIES) {
    describe(s.id, () => {
      const full = s.generate({ candles: data, tf: 'M5' });

      it('มีสัญญาณบนข้อมูลจำลอง และ SL/TP อยู่ถูกฝั่ง', () => {
        expect(full.length).toBeGreaterThan(0);
        for (const sig of full) {
          const long = sig.direction === 'long';
          const ref = sig.entryType === 'limit' ? sig.entry : data[sig.index]!.close;
          expect(long ? sig.sl < ref && ref < sig.tp : sig.tp < ref && ref < sig.sl).toBe(true);
          expect(sig.index).toBeGreaterThanOrEqual(0);
          expect(sig.index).toBeLessThan(data.length);
          expect(sig.reason.length).toBeGreaterThan(0);
        }
        const idx = full.map((x) => x.index);
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
      });

      it('สัญญาณจากข้อมูลบางส่วน = สัญญาณจากข้อมูลทั้งหมด ณ จุดตัด', () => {
        for (const cut of [1500, 2777, 4100, 5200]) {
          const partial = s.generate({ candles: data.slice(0, cut + 1), tf: 'M5' });
          expect(partial.filter((x) => x.index <= cut)).toEqual(full.filter((x) => x.index <= cut));
        }
      });

      it('TF ที่ไม่มี TF ใหญ่กว่าให้ใช้ → ไม่พัง', () => {
        const w = generateSampleCandles({ count: 300, timeframe: 'W1', startPrice: 100, seed: 1 });
        expect(() => s.generate({ candles: w, tf: 'W1' })).not.toThrow();
      });
    });
  }
});

describe('confirmStates (ltfConfirm หน้า 8)', () => {
  const ev = (type: 'BOS' | 'CHoCH', direction: 'bull' | 'bear', i: number) =>
    ({ type, direction, confirmIndex: i }) as StructureEvent;
  const events = [ev('BOS', 'bear', 1), ev('CHoCH', 'bull', 3), ev('BOS', 'bull', 5), ev('BOS', 'bull', 7), ev('CHoCH', 'bear', 8)];
  const at = (i: number) => events.filter((e) => e.confirmIndex === i);

  it('CHoCH แล้ว BOS ทิศเดียวกัน = ยืนยัน · CHoCH สวนทางล้างสถานะ', () => {
    const { state, becameAt } = confirmStates(10, at);
    expect(state).toEqual([null, null, null, null, null, 'bull', 'bull', 'bull', null, null]);
    expect(becameAt[5]).toBe('bull');
    expect(becameAt.filter(Boolean)).toHaveLength(1);
  });

  it("โหมด 'choch' = แค่ CHoCH ก็ยืนยัน", () => {
    const { state } = confirmStates(10, at, 'choch');
    expect(state[3]).toBe('bull');
    expect(state[8]).toBe('bear');
  });
});

describe('findCrtSetups (ท่า 6)', () => {
  it('แท่งที่ 2 ไส้ทะลุยอดแท่งแรกแต่ปิดกลับในกรอบ = CRT ขาย เป้า CRTL', () => {
    const htf = [htfBar(0, 100, 110, 95, 105), htfBar(1, 105, 112, 101, 106)];
    expect(findCrtSetups(htf)).toEqual([
      { index: 1, direction: 'bear', crtHigh: 110, crtLow: 95, sweepExtreme: 112, target: 95 },
    ]);
  });

  it('กวาดก้นแล้วปิดกลับ = CRT ซื้อ เป้า CRTH', () => {
    const htf = [htfBar(0, 100, 110, 95, 105), htfBar(1, 104, 108, 93, 99)];
    expect(findCrtSetups(htf)[0]).toMatchObject({ direction: 'bull', target: 110, sweepExtreme: 93 });
  });

  it('ปิดนอกกรอบ (เบรกจริง) หรือทะลุทั้งสองฝั่ง → ไม่นับ', () => {
    expect(findCrtSetups([htfBar(0, 100, 110, 95, 105), htfBar(1, 105, 115, 104, 112)])).toEqual([]);
    expect(findCrtSetups([htfBar(0, 100, 110, 95, 105), htfBar(1, 105, 115, 90, 100)])).toEqual([]);
  });
});

describe('fiboPrice (sk Fibo)', () => {
  it('ขาขึ้น 100→200: retrace 0.618 = 138.2 · extension 1.618 = 261.8', () => {
    expect(fiboPrice(100, 200, 0.618, 'retrace')).toBeCloseTo(138.2);
    expect(fiboPrice(100, 200, 1.618, 'extension')).toBeCloseTo(261.8);
  });
  it('ขาลง 200→100: retrace 0.5 = 150 · extension 1.618 = 38.2', () => {
    expect(fiboPrice(200, 100, 0.5, 'retrace')).toBeCloseTo(150);
    expect(fiboPrice(200, 100, 1.618, 'extension')).toBeCloseTo(38.2);
  });
});

describe('pickHtf / resolveParams', () => {
  it('auto: M5→H1 · เลือกเองต้องใหญ่กว่า TF ที่เทรด', () => {
    expect(pickHtf('M5', 'auto')).toBe('H1');
    expect(pickHtf('H1', 'M15')).toBeNull();
    expect(pickHtf('M15', 'D1')).toBe('D1');
  });
  it('ค่าผิดชนิด/นอกช่วง → default หรือบีบเข้าช่วง', () => {
    const p = resolveParams(
      [
        { key: 'a', label: '', type: 'number', default: 2, min: 1, max: 5 },
        { key: 'b', label: '', type: 'select', default: 'x', options: [{ value: 'x', label: '' }] },
      ],
      { a: 99, b: 'zzz' },
    );
    expect(p.num('a')).toBe(5);
    expect(p.str('b')).toBe('x');
  });
});
