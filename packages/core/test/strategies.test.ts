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

describe('ท่า 4 AMD (Accumulation Manipulation Distribution)', () => {
  it('โหมด Asian Session: สะสมใน Asian (00-07) → London (07-13) sweep Low → กลับตัวขึ้น → เกิด Buy Signal', () => {
    // วันที่ 2026-01-05 (Monday) 00:00 UTC
    const baseTime = Date.UTC(2026, 0, 5, 0, 0, 0);
    const m15 = 15 * 60_000;
    const testCandles: Candle[] = [];

    // 1. Asian Session: 00:00 - 07:00 UTC (28 แท่ง M15) อยู่ในช่วง 2000 - 2060
    for (let i = 0; i < 28; i++) {
      testCandles.push({
        time: baseTime + i * m15,
        open: 2020,
        high: 2060,
        low: 2000,
        close: 2030,
        volume: 10,
      });
    }

    // 2. London Manipulation: แท่งที่ 28 (07:00 UTC) แทงไส้หลุด 1990 แล้วปิดกลับที่ 2005
    testCandles.push({
      time: baseTime + 28 * m15,
      open: 2010,
      high: 2015,
      low: 1990, // sweep Asian Low (2000)
      close: 2005, // ปิดกลับเข้ามาในกรอบ
      volume: 20,
    });

    // 3. Distribution: แท่งที่ 29 (07:15 UTC) ดีดกลับตัวขึ้นปิดสูงกว่าแท่ง sweep
    testCandles.push({
      time: baseTime + 29 * m15,
      open: 2005,
      high: 2025,
      low: 2002,
      close: 2020, // close > 2015
      volume: 25,
    });

    const amdStrat = STRATEGIES.find((s) => s.id === 'amd')!;
    const signals = amdStrat.generate({
      candles: testCandles,
      tf: 'M15',
      params: { mode: 'session', entryMode: 'market', tpMode: 'opposite_range' },
    });

    expect(signals.length).toBeGreaterThan(0);
    const sig = signals[0]!;
    expect(sig.direction).toBe('long');
    expect(sig.sl).toBeLessThan(1990); // SL อยู่ใต้จุดต่ำสุดของไส้ที่ sweep
    expect(sig.tp).toBeGreaterThanOrEqual(2050); // TP อยู่ที่ Asian High
    expect(sig.reason).toContain('ท่า 4 AMD');
  });

  it('โหมด Consolidation: สะสมกรอบแคบ → sweep High → แท่งถัดไปกลับตัวลง → เกิด Sell Signal', () => {
    const baseTime = Date.UTC(2026, 0, 5, 12, 0, 0);
    const m5 = 5 * 60_000;
    const testCandles: Candle[] = [];

    // 20 แท่งแรก วิ่งในกรอบแคบ 100 - 105
    for (let i = 0; i < 22; i++) {
      testCandles.push({
        time: baseTime + i * m5,
        open: 102,
        high: 105,
        low: 100,
        close: 103,
        volume: 5,
      });
    }

    // แท่งที่ 23: sweep High ไปแตะ 108 แล้วปิดที่ 104
    testCandles.push({
      time: baseTime + 22 * m5,
      open: 103,
      high: 108,
      low: 102,
      close: 104,
      volume: 15,
    });

    // แท่งที่ 24: ทุบกลับตัวลงปิดที่ 101 (close < 102)
    testCandles.push({
      time: baseTime + 23 * m5,
      open: 104,
      high: 104.5,
      low: 100.5,
      close: 101,
      volume: 20,
    });

    const amdStrat = STRATEGIES.find((s) => s.id === 'amd')!;
    const signals = amdStrat.generate({
      candles: testCandles,
      tf: 'M5',
      params: { mode: 'consolidation', entryMode: 'market', tpMode: 'opposite_range' },
    });

    expect(signals.length).toBeGreaterThan(0);
    const sig = signals[0]!;
    expect(sig.direction).toBe('short');
    expect(sig.sl).toBeGreaterThan(108); // SL อยู่เหนือปลายไส้ sweep
    expect(sig.tp).toBeLessThanOrEqual(100); // TP อยู่ที่กรอบล่าง
  });
});

