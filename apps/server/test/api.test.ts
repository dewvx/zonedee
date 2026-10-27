import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSampleCandles } from '@zonedee/core';
import { createApp } from '../src/app';
import { createFetchRunner } from '../src/fetch-runner';
import type { Fetchers } from '../src/fetch-job';
import { ingest } from '../src/ingest';
import { CandleStore } from '../src/store';
import { findSymbol, type SymbolConfig } from '../src/symbols';
import { NewsCache } from '../src/news';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const MON = Date.UTC(2026, 9, 12);
const gold: SymbolConfig = {
  ...findSymbol('XAUUSD')!,
  source: 'mt5',
  sourceSymbol: 'GOLD',
  natives: [{ tf: 'M1', maxDays: 3650, chunkDays: 30 }],
  defaultHistoryDays: 2,
};
const eur: SymbolConfig = { ...gold, symbol: 'EURUSD', sourceSymbol: 'EURUSD' };

let store: CandleStore;
let server: Server;
let base: string;
let fetchCalls = 0;
let failMt5 = false;

beforeEach(async () => {
  store = new CandleStore(':memory:');
  fetchCalls = 0;
  failMt5 = false;
  const fetchers: Fetchers = {
    mt5: async (_s, tf, from, to) => {
      fetchCalls++;
      await new Promise((r) => setTimeout(r, 30));
      if (failMt5) throw new Error('เชื่อมต่อ MT5 ไม่ได้');
      const count = Math.floor((to.getTime() - from.getTime()) / 60_000);
      return generateSampleCandles({ count, timeframe: tf, startPrice: 2650, startTime: from.getTime() - (from.getTime() % 60_000) });
    },
  };
  const app = createApp({
    store,
    runFetch: createFetchRunner(store, fetchers),
    symbols: [gold, eur],
    news: new NewsCache(':memory:'),
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  store.close();
});

describe('GET /api/candles', () => {
  it('ยังไม่มีข้อมูล → sample', async () => {
    const res = await (await fetch(`${base}/api/candles?symbol=XAUUSD&tf=M15&count=50`)).json() as Json;
    expect(res.source).toBe('sample');
    expect(res.candles).toHaveLength(50);
    expect(res.hasMore).toBe(false);
  });

  it('มีข้อมูล → อ่านจาก DB และโหลดย้อนหลังด้วย before จนหมด', async () => {
    const m1 = generateSampleCandles({ count: 300, timeframe: 'M1', startPrice: 2650, startTime: MON });
    ingest(store, gold, 'M1', m1);

    const first = await (await fetch(`${base}/api/candles?symbol=XAUUSD&tf=M1&count=100`)).json() as Json;
    expect(first.source).toBe('mt5');
    expect(first.candles.map((c: { time: number }) => c.time)).toEqual(m1.slice(200).map((c) => c.time));
    expect(first.hasMore).toBe(true);

    const older = await (
      await fetch(`${base}/api/candles?symbol=XAUUSD&tf=M1&count=150&before=${first.candles[0].time}`)
    ).json() as Json;
    expect(older.candles.map((c: { time: number }) => c.time)).toEqual(m1.slice(50, 200).map((c) => c.time));

    const rest = await (
      await fetch(`${base}/api/candles?symbol=XAUUSD&tf=M1&count=150&before=${older.candles[0].time}`)
    ).json() as Json;
    expect(rest.candles).toHaveLength(50);
    expect(rest.hasMore).toBe(false);
  });

  it('TF ที่ symbol ไม่มี → 400', async () => {
    const res = await fetch(`${base}/api/candles?symbol=XAUUSD&tf=M2`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/fetch', () => {
  it('ดึงแล้วข้อมูลเข้า DB', async () => {
    const res = await fetch(`${base}/api/fetch?symbol=XAUUSD`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.symbol).toBe('XAUUSD');
    expect(body.total).toBeGreaterThan(0);
    expect(store.lastTime('XAUUSD', 'M1')).not.toBeNull();
    expect(store.lastTime('XAUUSD', 'H1')).not.toBeNull();
  });

  it('กดซ้ำพร้อมกัน symbol เดียวกัน → ดึงรอบเดียว', async () => {
    await Promise.all([
      fetch(`${base}/api/fetch?symbol=XAUUSD`, { method: 'POST' }),
      fetch(`${base}/api/fetch?symbol=XAUUSD`, { method: 'POST' }),
      fetch(`${base}/api/fetch?symbol=XAUUSD`, { method: 'POST' }),
    ]);
    expect(fetchCalls).toBe(1);
  });

  it('คนละ symbol ดึงแยกกัน', async () => {
    await Promise.all([
      fetch(`${base}/api/fetch?symbol=XAUUSD`, { method: 'POST' }),
      fetch(`${base}/api/fetch?symbol=EURUSD`, { method: 'POST' }),
    ]);
    expect(fetchCalls).toBe(2);
  });

  it('แหล่งข้อมูลพัง → 502 พร้อมข้อความ', async () => {
    failMt5 = true;
    const res = await fetch(`${base}/api/fetch?symbol=XAUUSD`, { method: 'POST' });
    expect(res.status).toBe(502);
    expect(((await res.json()) as Json).error).toContain('MT5');
  });

  it('symbol ไม่รู้จัก → 404', async () => {
    expect((await fetch(`${base}/api/fetch?symbol=NOPE`, { method: 'POST' })).status).toBe(404);
  });
});

describe('backtest API', () => {
  const seed = () => ingest(store, gold, 'M1', generateSampleCandles({ count: 20_000, timeframe: 'M1', startPrice: 2650, startTime: MON, seed: 9 }));
  const post = (body: unknown) =>
    fetch(`${base}/api/backtest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('GET /api/strategies → รายชื่อท่า + params', async () => {
    const list = (await (await fetch(`${base}/api/strategies`)).json()) as Json[];
    expect(list.map((s) => s.id)).toContain('sk-fibo');
    expect(list[0].params.length).toBeGreaterThan(0);
    expect(list[0].generate).toBeUndefined();
  });

  it('ยังไม่มีข้อมูล → 422 บอกให้ดึงก่อน (ไม่ใช้ข้อมูลจำลอง)', async () => {
    const res = await post({ symbol: 'XAUUSD', tf: 'M5', strategy: 'ema-cross' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error).toContain('ดึงข้อมูล');
  });

  it('รันท่าเดียว: มีเทรด สถิติ เส้น equity และใช้ M1 แยก SL/TP', async () => {
    seed();
    const res = await post({ symbol: 'XAUUSD', tf: 'M5', strategy: 'sk-fibo', baselineRuns: 20, spreadPoints: 30 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.meta).toMatchObject({ symbol: 'XAUUSD', tf: 'M5', strategy: 'sk-fibo', fineData: true, spreadPoints: 30 });
    expect(body.meta.bars).toBeGreaterThan(3000);
    expect(body.result.stats.trades).toBeGreaterThan(0);
    expect(body.result.equity.length).toBe(body.result.trades.length + 1);
    expect(body.result.baseline.runs).toBe(20);
  });

  it("strategy 'all' → ตารางเทียบทุกท่า เรียงตาม expectancy", async () => {
    seed();
    const body = (await (await post({ symbol: 'XAUUSD', tf: 'M15', strategy: 'all', baselineRuns: 10 })).json()) as Json;
    expect(body.rows.length).toBeGreaterThanOrEqual(5);
    const exp = body.rows.map((r: Json) => r.stats.expectancyR);
    expect(exp).toEqual([...exp].sort((a: number, b: number) => b - a));
  });

  it('ท่า/TF ผิด → 400', async () => {
    seed();
    expect((await post({ symbol: 'XAUUSD', tf: 'M5', strategy: 'nope' })).status).toBe(400);
    expect((await post({ symbol: 'XAUUSD', tf: 'M7', strategy: 'crt' })).status).toBe(400);
  });

  it('POST /api/backtest/tune → รัน Grid Search ส่งคืน rows และ best combination', async () => {
    seed();
    const tunePost = (body: unknown) =>
      fetch(`${base}/api/backtest/tune`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const res = await tunePost({
      symbol: 'XAUUSD',
      tf: 'M5',
      strategy: 'ema-cross',
      grid: {
        swingLength: [2, 3],
        rr: [1.5, 2.0],
      },
      topBaselineRuns: 10,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.strategy).toBe('ema-cross');
    expect(body.totalCombinations).toBe(4);
    expect(body.rows.length).toBe(4);
    expect(body.rows[0].expectancyR).toBeDefined();
  });
});

describe('GET /api/candles?after', () => {
  it('คืนแท่งตั้งแต่เวลานั้นไป เรียงเก่า → ใหม่', async () => {
    ingest(store, gold, 'M1', generateSampleCandles({ count: 300, timeframe: 'M1', startPrice: 2650, startTime: MON }));
    const res = (await (await fetch(`${base}/api/candles?symbol=XAUUSD&tf=M5&count=10&after=${MON + 30 * 60_000}`)).json()) as Json;
    expect(res.candles).toHaveLength(10);
    expect(res.candles[0].time).toBe(MON + 30 * 60_000);
    expect(res.hasMore).toBe(true);
  });
});

describe('News API', () => {
  it('GET /api/news ไม่มี symbol → 400', async () => {
    const res = await fetch(`${base}/api/news`);
    expect(res.status).toBe(400);
  });

  it('GET /api/news ส่งคืนโครงสร้าง StockNewsSummary', async () => {
    const res = await fetch(`${base}/api/news?symbol=AAPL`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.symbol).toBe('AAPL');
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.overallSentiment).toBeDefined();
    expect(body.headlineSummary).toBeDefined();
  });

  it('POST /api/news/summarize ไม่มี symbol → 400', async () => {
    const res = await fetch(`${base}/api/news/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
