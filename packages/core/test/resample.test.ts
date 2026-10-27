import { describe, expect, it } from 'vitest';
import { bucketStart, isBucketClosed, isUsDst, nyCloseBucketStart, resample } from '../src/resample';
import { generateSampleCandles } from '../src/sample-data';
import { TIMEFRAME_MS, type Candle } from '../src/types';

const M = 60_000;
const H = 60 * M;
const D = 24 * H;
const t0 = Date.UTC(2026, 9, 12); // จันทร์ 12 ต.ค. 2026 00:00 UTC

const c = (time: number, o: number, h: number, l: number, cl: number, v = 1): Candle => ({
  time,
  open: o,
  high: h,
  low: l,
  close: cl,
  volume: v,
});

describe('isUsDst', () => {
  it('ช่วงฤดูร้อน (ก.ค. 2026) เป็น EDT (true)', () => {
    expect(isUsDst(Date.UTC(2026, 6, 15, 12, 0))).toBe(true);
  });

  it('ช่วงฤดูหนาว (ม.ค. 2026) เป็น EST (false)', () => {
    expect(isUsDst(Date.UTC(2026, 0, 15, 12, 0))).toBe(false);
  });

  it('จุดเปลี่ยน มี.ค. 2026 (อาทิตย์ที่ 2: 8 มี.ค. 07:00 UTC)', () => {
    // 06:59:59 UTC ยังเป็น EST (false)
    expect(isUsDst(Date.UTC(2026, 2, 8, 6, 59, 59))).toBe(false);
    // 07:00:00 UTC เริ่มเป็น EDT (true)
    expect(isUsDst(Date.UTC(2026, 2, 8, 7, 0, 0))).toBe(true);
  });

  it('จุดเปลี่ยน พ.ย. 2026 (อาทิตย์แรก: 1 พ.ย. 06:00 UTC)', () => {
    // 05:59:59 UTC ยังเป็น EDT (true)
    expect(isUsDst(Date.UTC(2026, 10, 1, 5, 59, 59))).toBe(true);
    // 06:00:00 UTC กลับเป็น EST (false)
    expect(isUsDst(Date.UTC(2026, 10, 1, 6, 0, 0))).toBe(false);
  });
});

describe('bucketStart', () => {
  it('M15 ตัดทุก 15 นาที', () => {
    expect(bucketStart(t0 + 14 * M, 'M15')).toBe(t0);
    expect(bucketStart(t0 + 15 * M, 'M15')).toBe(t0 + 15 * M);
  });

  it('H4 ตัดที่ 00/04/08/... UTC', () => {
    expect(bucketStart(t0 + 5 * H + 30 * M, 'H4')).toBe(t0 + 4 * H);
  });

  it('D1 ตัดที่ 00:00 UTC เมื่อใช้ cutoff utc', () => {
    expect(bucketStart(t0 + 23 * H + 59 * M, 'D1')).toBe(t0);
    expect(bucketStart(t0 + 23 * H + 59 * M, 'D1', 'utc')).toBe(t0);
  });

  it('W1 เริ่มวันจันทร์', () => {
    expect(new Date(t0).getUTCDay()).toBe(1); // จันทร์
    expect(bucketStart(t0 + 6 * D + 23 * H, 'W1')).toBe(t0); // อาทิตย์ยังเป็นสัปดาห์เดียวกัน
    expect(bucketStart(t0 + 7 * D, 'W1')).toBe(t0 + 7 * D);
    expect(bucketStart(t0 - 1, 'W1')).toBe(t0 - 7 * D);
  });

  it('D1 แบบ NY Close ช่วง EDT (ฤดูร้อน) ตัดที่ 21:00 UTC (17:00 NY)', () => {
    // 14 ต.ค. 2026 เป็น EDT (17:00 NY = 21:00 UTC)
    const tBeforeCutoff = Date.UTC(2026, 9, 14, 20, 59); // ก่อน 21:00 -> เป็นแท่งของเมื่อวาน 21:00 UTC
    expect(bucketStart(tBeforeCutoff, 'D1', 'ny-close')).toBe(Date.UTC(2026, 9, 13, 21, 0));

    const tAtCutoff = Date.UTC(2026, 9, 14, 21, 0); // ตรง 21:00 -> เป็นแท่งของวันนี้ 21:00 UTC
    expect(bucketStart(tAtCutoff, 'D1', 'ny-close')).toBe(Date.UTC(2026, 9, 14, 21, 0));

    const tAfterCutoff = Date.UTC(2026, 9, 14, 22, 0); // หลัง 21:00 -> เป็นแท่งของวันนี้ 21:00 UTC
    expect(bucketStart(tAfterCutoff, 'D1', 'ny-close')).toBe(Date.UTC(2026, 9, 14, 21, 0));
  });

  it('D1 แบบ NY Close ช่วง EST (ฤดูหนาว) ตัดที่ 22:00 UTC (17:00 NY)', () => {
    // 14 ม.ค. 2026 เป็น EST (17:00 NY = 22:00 UTC)
    const tBeforeCutoff = Date.UTC(2026, 0, 14, 21, 59);
    expect(bucketStart(tBeforeCutoff, 'D1', 'ny-close')).toBe(Date.UTC(2026, 0, 13, 22, 0));

    const tAtCutoff = Date.UTC(2026, 0, 14, 22, 0);
    expect(bucketStart(tAtCutoff, 'D1', 'ny-close')).toBe(Date.UTC(2026, 0, 14, 22, 0));
  });

  it('อาทิตย์ค่ำกับจันทร์เช้า อยู่ในแท่ง Daily เดียวกันเมื่อตัดแบบ NY Close', () => {
    // ตลาดเปิดอาทิตย์ 18 ต.ค. 2026 เวลา 22:00 UTC
    const sunNight = Date.UTC(2026, 9, 18, 22, 0);
    // จันทร์ 19 ต.ค. 2026 เวลา 10:00 UTC
    const monMorning = Date.UTC(2026, 9, 19, 10, 0);

    expect(bucketStart(sunNight, 'D1', 'ny-close')).toBe(Date.UTC(2026, 9, 18, 21, 0));
    expect(bucketStart(monMorning, 'D1', 'ny-close')).toBe(Date.UTC(2026, 9, 18, 21, 0));
  });
});

describe('resample', () => {
  it('รวม M1 เป็น M5 ได้ OHLCV ถูกต้อง', () => {
    const m1 = [
      c(t0, 10, 12, 9, 11, 1),
      c(t0 + M, 11, 15, 10, 14, 2),
      c(t0 + 2 * M, 14, 14, 8, 9, 3),
      c(t0 + 5 * M, 9, 10, 7, 8, 4), // แท่ง M5 ถัดไป
    ];
    expect(resample(m1, 'M5')).toEqual([
      c(t0, 10, 15, 8, 9, 6),
      c(t0 + 5 * M, 9, 10, 7, 8, 4),
    ]);
  });

  it('ช่วงไม่มีข้อมูลไม่เติมแท่งว่าง', () => {
    const m1 = [c(t0, 1, 1, 1, 1), c(t0 + 3 * H, 2, 2, 2, 2)];
    expect(resample(m1, 'H1').map((x) => x.time)).toEqual([t0, t0 + 3 * H]);
  });

  it('ไม่แก้ไข input', () => {
    const m1 = [c(t0, 1, 2, 0, 1), c(t0 + M, 1, 3, 0, 2)];
    const copy = m1.map((x) => ({ ...x }));
    resample(m1, 'M5');
    expect(m1).toEqual(copy);
  });

  it('ข้อมูลไม่เรียงต้อง throw', () => {
    expect(() => resample([c(t0 + 10 * M, 1, 1, 1, 1), c(t0, 1, 1, 1, 1)], 'M5')).toThrow();
  });

  it('M1 → H1 ตรงกับ M1 → M15 → H1 (resample ซ้อนได้)', () => {
    const m1 = generateSampleCandles({ count: 3000, timeframe: 'M1', startPrice: 2650, startTime: t0 });
    const direct = resample(m1, 'H1');
    const viaM15 = resample(resample(m1, 'M15'), 'H1');
    expect(viaM15).toEqual(direct);
  });

  it('ข้อมูลเพิ่ม แท่งที่ปิดไปแล้วไม่เปลี่ยน (เปลี่ยนได้แค่แท่งสุดท้าย)', () => {
    const m1 = generateSampleCandles({ count: 2000, timeframe: 'M1', startPrice: 2650, startTime: t0 });
    const full = resample(m1, 'M30');
    for (const cut of [100, 777, 1500]) {
      const partial = resample(m1.slice(0, cut), 'M30');
      expect(partial.slice(0, -1)).toEqual(full.slice(0, partial.length - 1));
    }
  });

  it('D1 แบบ NY Close: แท่งวันอาทิตย์ค่ำรวมเข้ากับวันจันทร์ ไม่มีแท่งแยก', () => {
    const sun2200 = Date.UTC(2026, 9, 18, 22, 0); // อาทิตย์ 22:00 UTC
    const mon0800 = Date.UTC(2026, 9, 19, 8, 0); // จันทร์ 08:00 UTC
    const mon2000 = Date.UTC(2026, 9, 19, 20, 0); // จันทร์ 20:00 UTC (ก่อน 21:00 NY close)
    const tue0200 = Date.UTC(2026, 9, 20, 2, 0); // อังคาร 02:00 UTC

    const input = [
      c(sun2200, 2000, 2010, 1995, 2005, 50),
      c(mon0800, 2005, 2030, 2002, 2025, 80),
      c(mon2000, 2025, 2028, 2015, 2020, 30),
      c(tue0200, 2020, 2040, 2018, 2035, 60),
    ];

    // ถ้าตัดแบบ UTC จะได้ 3 แท่ง (อาทิตย์ 2 ชม., จันทร์ทั้งวัน, อังคาร)
    const utcRes = resample(input, 'D1', 'utc');
    expect(utcRes).toHaveLength(3);

    // ถ้าตัดแบบ NY Close จะได้ 2 แท่ง (จันทร์ ซึ่งรวมอาทิตย์ 22:00 ไว้ด้วย, และอังคาร)
    const nyRes = resample(input, 'D1', 'ny-close');
    expect(nyRes).toHaveLength(2);

    // แท่งแรก: รวม sun2200 + mon0800 + mon2000
    expect(nyRes[0]).toEqual({
      time: Date.UTC(2026, 9, 18, 21, 0),
      open: 2000, // ราคาเปิดของ sun2200
      high: 2030, // จุดสูงสุดของช่วง
      low: 1995, // จุดต่ำสุดของช่วง
      close: 2020, // ราคาปิดของ mon2000
      volume: 160, // 50 + 80 + 30
    });

    // แท่งที่สอง: tue0200
    expect(nyRes[1]).toEqual({
      time: Date.UTC(2026, 9, 19, 21, 0),
      open: 2020,
      high: 2040,
      low: 2018,
      close: 2035,
      volume: 60,
    });
  });

  it('resample M1 → H1 → D1 (ny-close) ได้ผลลัพธ์ตรงกับ M1 → D1 (ny-close)', () => {
    const sun2200 = Date.UTC(2026, 9, 18, 22, 0);
    const m1 = generateSampleCandles({ count: 1440 * 3, timeframe: 'M1', startPrice: 2650, startTime: sun2200 });
    const directD1 = resample(m1, 'D1', 'ny-close');
    const viaH1 = resample(resample(m1, 'H1'), 'D1', 'ny-close');

    expect(viaH1).toEqual(directD1);
  });
});

describe('isBucketClosed', () => {
  it('H4 ปิดเมื่อครบ 4 ชม.', () => {
    expect(isBucketClosed(t0, 'H4', t0 + 4 * H - 1)).toBe(false);
    expect(isBucketClosed(t0, 'H4', t0 + TIMEFRAME_MS.H4)).toBe(true);
  });

  it('D1 แบบ NY Close ปิดเมื่อครบ 24 ชม. จากเวลาเปิดแท่ง', () => {
    const d1Start = Date.UTC(2026, 9, 18, 21, 0);
    expect(isBucketClosed(d1Start, 'D1', d1Start + 24 * H - 1, 'ny-close')).toBe(false);
    expect(isBucketClosed(d1Start, 'D1', d1Start + 24 * H, 'ny-close')).toBe(true);
  });
});
