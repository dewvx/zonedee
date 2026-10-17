import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TIMEFRAME_MS, generateSampleCandles, resample, type Candle } from '@zonedee/core';
import { CandleStore } from '../src/store';
import { ingest } from '../src/ingest';
import { fetchSymbol, resolveFrom, type Fetchers } from '../src/fetch-job';
import { mapDukascopyItems } from '../src/fetchers/dukascopy';
import { mapYahooQuotes } from '../src/fetchers/yahoo';
import { parseMt5Output } from '../src/fetchers/mt5';
import { findSymbol, parentNative, type SymbolConfig } from '../src/symbols';

const DAY = 24 * 60 * 60_000;
const MON = Date.UTC(2026, 9, 12); // จันทร์
const aapl = findSymbol('AAPL')!;

/** symbol forex แบบ native M1 อย่างเดียว (เหมือน mt5 / dukascopy) */
const fxM1: SymbolConfig = {
  ...findSymbol('XAUUSD')!,
  source: 'mt5',
  sourceSymbol: 'GOLD',
  natives: [{ tf: 'M1', maxDays: 3650, chunkDays: 7 }],
};
/** symbol forex แบบ Yahoo: native M1 / M5 / H1 */
const fxYahoo: SymbolConfig = {
  ...findSymbol('XAUUSD')!,
  source: 'yahoo',
  sourceSymbol: 'GC=F',
  natives: [
    { tf: 'M1', maxDays: 29, chunkDays: 7 },
    { tf: 'M5', maxDays: 59, chunkDays: 59 },
    { tf: 'H1', maxDays: 729, chunkDays: 729 },
  ],
};

let store: CandleStore;
beforeEach(() => {
  store = new CandleStore(':memory:');
});
afterEach(() => store.close());

describe('CandleStore', () => {
  it('upsert แล้วอ่านกลับได้ เรียงเก่า → ใหม่', () => {
    const candles = generateSampleCandles({ count: 50, timeframe: 'M1', startPrice: 2650, startTime: MON });
    store.upsert('XAUUSD', 'M1', candles);
    expect(store.latest('XAUUSD', 'M1', 1000)).toEqual(candles);
    expect(store.latest('XAUUSD', 'M1', 5)).toEqual(candles.slice(-5));
    expect(store.lastTime('XAUUSD', 'M1')).toBe(candles.at(-1)!.time);
  });

  it('upsert ซ้ำ = อัปเดต ไม่เพิ่มแถว', () => {
    const [a] = generateSampleCandles({ count: 1, timeframe: 'M1', startPrice: 2650, startTime: MON });
    store.upsert('XAUUSD', 'M1', [a!]);
    store.upsert('XAUUSD', 'M1', [{ ...a!, close: 9999 }]);
    const rows = store.latest('XAUUSD', 'M1', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.close).toBe(9999);
  });

  it('latest ด้วย before = โหลดย้อนหลังต่อ', () => {
    const candles = generateSampleCandles({ count: 20, timeframe: 'M1', startPrice: 2650, startTime: MON });
    store.upsert('XAUUSD', 'M1', candles);
    expect(store.latest('XAUUSD', 'M1', 5, candles[10]!.time)).toEqual(candles.slice(5, 10));
  });

  it('deleteSymbol ลบทุก TF ของ symbol นั้นเท่านั้น', () => {
    const c = generateSampleCandles({ count: 5, timeframe: 'M1', startPrice: 1, startTime: MON });
    store.upsert('XAUUSD', 'M1', c);
    store.upsert('XAUUSD', 'H1', c);
    store.upsert('EURUSD', 'M1', c);
    expect(store.deleteSymbol('XAUUSD')).toBe(10);
    expect(store.lastTime('XAUUSD', 'M1')).toBeNull();
    expect(store.lastTime('EURUSD', 'M1')).not.toBeNull();
  });
});

describe('parentNative', () => {
  it('native M1 อย่างเดียว: ทุก TF มาจาก M1', () => {
    expect(parentNative(fxM1, 'M1', TIMEFRAME_MS)).toBeNull();
    expect(parentNative(fxM1, 'H4', TIMEFRAME_MS)).toBe('M1');
    expect(parentNative(fxM1, 'W1', TIMEFRAME_MS)).toBe('M1');
  });

  it('Yahoo: เลือก native ที่ใหญ่สุดที่หารลงตัว', () => {
    expect(parentNative(fxYahoo, 'M5', TIMEFRAME_MS)).toBeNull();
    expect(parentNative(fxYahoo, 'M10', TIMEFRAME_MS)).toBe('M5');
    expect(parentNative(fxYahoo, 'M30', TIMEFRAME_MS)).toBe('M5');
    expect(parentNative(fxYahoo, 'H2', TIMEFRAME_MS)).toBe('H1');
    expect(parentNative(fxYahoo, 'D1', TIMEFRAME_MS)).toBe('H1');
    expect(parentNative(fxYahoo, 'W1', TIMEFRAME_MS)).toBe('H1');
  });
});

describe('ingest', () => {
  it('native M1: สร้าง TF อื่นครบ ตรงกับ resample ตรงๆ', () => {
    const m1 = generateSampleCandles({ count: 3 * 1440, timeframe: 'M1', startPrice: 2650, startTime: MON });
    ingest(store, fxM1, 'M1', m1);
    for (const tf of ['M5', 'M10', 'M15', 'H1', 'H2', 'H4', 'D1', 'W1'] as const) {
      expect(store.latest('XAUUSD', tf, 100_000)).toEqual(resample(m1, tf));
    }
  });

  it('ingest ทีละก้อนได้ผลเท่ากับ ingest ทีเดียว (แท่งรอยต่อรวมถูก)', () => {
    const m1 = generateSampleCandles({ count: 2 * 1440, timeframe: 'M1', startPrice: 2650, startTime: MON });
    ingest(store, fxM1, 'M1', m1.slice(0, 1000));
    ingest(store, fxM1, 'M1', m1.slice(1000, 2100));
    ingest(store, fxM1, 'M1', m1.slice(2100));
    expect(store.latest('XAUUSD', 'H4', 1000)).toEqual(resample(m1, 'H4'));
    expect(store.latest('XAUUSD', 'D1', 1000)).toEqual(resample(m1, 'D1'));
  });

  it('Yahoo: H1 สร้าง H2/H4/D1/W1, M5 สร้าง M10/M15/M30, M1 ไม่สร้างอะไร', () => {
    const h1 = generateSampleCandles({ count: 24 * 10, timeframe: 'H1', startPrice: 2650, startTime: MON });
    const m5 = generateSampleCandles({ count: 12 * 24, timeframe: 'M5', startPrice: 2650, startTime: MON });
    const m1 = generateSampleCandles({ count: 60, timeframe: 'M1', startPrice: 2650, startTime: MON });
    const r1 = ingest(store, fxYahoo, 'M1', m1);
    const r5 = ingest(store, fxYahoo, 'M5', m5);
    const rh = ingest(store, fxYahoo, 'H1', h1);
    expect(Object.keys(r1.derived)).toEqual([]);
    expect(Object.keys(r5.derived).sort()).toEqual(['M10', 'M15', 'M30']);
    expect(Object.keys(rh.derived).sort()).toEqual(['D1', 'H2', 'H4', 'W1']);
    expect(store.latest('XAUUSD', 'H4', 1000)).toEqual(resample(h1, 'H4'));
    expect(store.latest('XAUUSD', 'M15', 1000)).toEqual(resample(m5, 'M15'));
  });

  it('หุ้น: native D1 สร้าง W1 แต่ไม่สร้าง TF เล็กกว่า', () => {
    const d1 = generateSampleCandles({ count: 30, timeframe: 'D1', startPrice: 230, startTime: MON });
    ingest(store, aapl, 'D1', d1);
    expect(store.latest('AAPL', 'W1', 100)).toEqual(resample(d1, 'W1'));
    expect(store.latest('AAPL', 'H1', 100)).toEqual([]);
  });
});

describe('fetchSymbol', () => {
  const now = MON + 10 * DAY;

  it('ครั้งแรกดึงย้อนหลังตาม days แบ่งเป็นก้อนตาม chunkDays', async () => {
    const calls: [number, number][] = [];
    const fetchers: Fetchers = {
      mt5: async (_s, tf, from, to) => {
        calls.push([from.getTime(), to.getTime()]);
        return generateSampleCandles({ count: 60, timeframe: tf, startPrice: 2650, startTime: from.getTime() });
      },
    };
    const res = await fetchSymbol(store, fxM1, fetchers, { days: 10, now });
    expect(calls).toEqual([
      [MON, MON + 7 * DAY],
      [MON + 7 * DAY, now],
    ]);
    expect(res).toEqual({ total: 120, errors: [] });
  });

  it('ไม่ย้อนเกิน maxDays ของแหล่งข้อมูล', () => {
    const m1 = fxYahoo.natives[0]!; // maxDays 29
    expect(resolveFrom(store, fxYahoo, m1, { days: 365, now })).toBe(now - 29 * DAY);
    expect(resolveFrom(store, fxYahoo, m1, { from: 0, now })).toBe(now - 29 * DAY);
  });

  it('ครั้งต่อไปดึงต่อจากแท่งล่าสุดของ native นั้น', () => {
    const m1 = generateSampleCandles({ count: 10, timeframe: 'M1', startPrice: 2650, startTime: now - DAY });
    ingest(store, fxYahoo, 'M1', m1);
    expect(resolveFrom(store, fxYahoo, fxYahoo.natives[0]!, { now })).toBe(m1.at(-1)!.time);
    // M5 ยังไม่มีข้อมูล → ย้อนหลังตาม default แต่ไม่เกิน 59 วัน
    expect(resolveFrom(store, fxYahoo, fxYahoo.natives[1]!, { now })).toBe(now - 59 * DAY);
  });

  it('native ชุดหนึ่งพัง ชุดอื่นยังดึงต่อ', async () => {
    const fetchers: Fetchers = {
      yahoo: async (_s, tf, from) => {
        if (tf === 'M1') throw new Error('1m data not available');
        return generateSampleCandles({ count: 3, timeframe: tf, startPrice: 2650, startTime: from.getTime() - (from.getTime() % TIMEFRAME_MS[tf]) });
      },
    };
    const res = await fetchSymbol(store, fxYahoo, fetchers, { days: 3, now });
    expect(res.errors).toEqual(['M1: 1m data not available']);
    expect(store.lastTime('XAUUSD', 'H1')).not.toBeNull();
    expect(store.lastTime('XAUUSD', 'M5')).not.toBeNull();
  });

  it('ไม่มี fetcher ของแหล่งนั้น → throw', async () => {
    await expect(fetchSymbol(store, fxM1, {}, { now })).rejects.toThrow(/mt5/);
  });
});

describe('mappers', () => {
  it('Dukascopy: ตัดแถวที่ข้อมูลเสีย, volume หายเป็น 0', () => {
    const out = mapDukascopyItems([
      { timestamp: MON, open: 1, high: 2, low: 0.5, close: 1.5 },
      { timestamp: MON + 60_000, open: Number.NaN, high: 2, low: 1, close: 1 },
      { timestamp: MON + 120_000, open: 1, high: 1, low: 1, close: 1, volume: 7 },
    ]);
    expect(out).toEqual<Candle[]>([
      { time: MON, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 },
      { time: MON + 120_000, open: 1, high: 1, low: 1, close: 1, volume: 7 },
    ]);
  });

  it('Yahoo D1: ปัดเวลาเป็น 00:00 UTC และข้ามแถว null', () => {
    const out = mapYahooQuotes(
      [
        { date: new Date(MON + 13.5 * 3600_000), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
        { date: new Date(MON + DAY + 13.5 * 3600_000), open: null, high: null, low: null, close: null, volume: null },
      ],
      'D1',
    );
    expect(out).toEqual([{ time: MON, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }]);
  });

  it('Yahoo intraday: แถวซ้ำเวลาเดียวกันใช้แถวหลัง, volume null → 0', () => {
    const out = mapYahooQuotes(
      [
        { date: new Date(MON), open: 1, high: 2, low: 0.5, close: 1.5, volume: null },
        { date: new Date(MON + 30_000), open: 1, high: 3, low: 0.5, close: 2, volume: null },
      ],
      'M1',
    );
    expect(out).toEqual([{ time: MON, open: 1, high: 3, low: 0.5, close: 2, volume: 0 }]);
  });

  it('MT5: อ่าน JSON lines (รองรับ \\r\\n ของ Windows)', () => {
    const out = parseMt5Output(`{"t":${MON},"o":1,"h":2,"l":0.5,"c":1.5,"v":10}\r\n\r\n`);
    expect(out).toEqual([{ time: MON, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
  });
});
