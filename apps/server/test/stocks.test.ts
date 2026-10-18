import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSampleCandles, type Candle } from '@zonedee/core';
import { createApp } from '../src/app';
import { ingest } from '../src/ingest';
import { createScanner } from '../src/scanner';
import { CandleStore } from '../src/store';
import { UserSymbolStore, createSymbolRegistry } from '../src/user-symbols';
import { WatchlistStore } from '../src/watchlist';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16);

/** หุ้นที่ไซด์เวย์แล้ววันสุดท้ายพุ่ง (volume ×5, gap, ทะลุกรอบ) */
function popper(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 60; i++) out.push({ time: NOW - (60 - i) * DAY, open: 5, high: 5.2, low: 4.8, close: 5, volume: 2_000_000 });
  out.push({ time: NOW, open: 5.4, high: 6.2, low: 5.3, close: 6, volume: 10_000_000 });
  return out;
}
const quiet = () => generateSampleCandles({ count: 120, timeframe: 'D1', startPrice: 8, startTime: NOW - 119 * DAY, volatility: 0.01 }).map((c) => ({ ...c, volume: 3_000_000 }));

describe('scanner', () => {
  it('เรียงตัวที่มีสัญญาณขึ้นก่อน · ใช้ cache · ticker ผิดถูกตัดทิ้ง', async () => {
    let dailyCalls = 0;
    const scan = createScanner({
      screener: async () => [
        { symbol: 'QUIET', name: 'Quiet Co', marketCap: 5e8 },
        { symbol: 'POP', name: 'Pop Inc', marketCap: 3e8 },
      ],
      daily: async (s) => {
        dailyCalls++;
        if (s === 'BAD') throw new Error('Not Found');
        return s === 'POP' ? popper() : quiet();
      },
      watchlistSymbols: () => ['POP'],
      now: () => NOW,
    });
    const r = await scan({ source: 'small_cap_gainers' });
    expect(r.rows.map((x) => x.symbol)).toEqual(['POP', 'QUIET']);
    expect(r.rows[0]!.scan!.signals).toEqual(expect.arrayContaining(['volume', 'gap', 'breakout']));
    await scan({ source: 'watchlist' });
    expect(dailyCalls).toBe(2); // POP มาจาก cache

    const c = await scan({ source: 'custom', symbols: ['pop', 'bad', '!!', 'POP'] });
    expect(c.rows.map((x) => x.symbol).sort()).toEqual(['BAD', 'POP']);
    expect(c.rows.find((x) => x.symbol === 'BAD')!.error).toBe('Not Found');
  });

  it('Yahoo screener ล่ม → บอก error ไม่พัง', async () => {
    const scan = createScanner({
      screener: async () => {
        throw new Error('429');
      },
      daily: async () => [],
      watchlistSymbols: () => [],
    });
    const r = await scan({ source: 'day_gainers' });
    expect(r.rows).toEqual([]);
    expect(r.error).toContain('429');
  });
});

describe('user symbols + watchlist API', () => {
  let store: CandleStore;
  let users: UserSymbolStore;
  let watch: WatchlistStore;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    store = new CandleStore(':memory:');
    users = new UserSymbolStore(':memory:');
    watch = new WatchlistStore(':memory:');
    const registry = createSymbolRegistry(users);
    const app = createApp({
      store,
      registry,
      userSymbols: users,
      watchlist: watch,
      // จำลอง Yahoo: รู้จักแค่ SOFI กับ AAPL
      runFetch: async (cfg) => {
        if (!['SOFI', 'AAPL'].includes(cfg.symbol)) return { symbol: cfg.symbol, source: 'yahoo', total: 0, errors: ['Not Found'], durationMs: 0 };
        ingest(store, cfg, 'D1', generateSampleCandles({ count: 300, timeframe: 'D1', startPrice: 10, startTime: NOW - 299 * DAY }));
        return { symbol: cfg.symbol, source: 'yahoo', total: 300, errors: [], durationMs: 0 };
      },
    });
    server = await new Promise<Server>((r) => {
      const s = app.listen(0, () => r(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    store.close();
    users.close();
    watch.close();
  });

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  it('เพิ่มหุ้นใหม่เข้า watchlist → เพิ่ม symbol + ดึงข้อมูล + มีตัวเลขพอร์ต', async () => {
    const res = await send('POST', '/api/watchlist', { symbol: 'sofi', shares: 10, avgCost: 8 });
    expect(res.status).toBe(201);
    const symbols = (await (await fetch(`${base}/api/symbols`)).json()) as Json[];
    expect(symbols.find((s) => s.symbol === 'SOFI')).toMatchObject({ user: true, market: 'us-stock' });
    const rows = (await (await fetch(`${base}/api/watchlist`)).json()) as Json[];
    expect(rows[0].metrics.close).toBeGreaterThan(0);
    expect(rows[0].cost).toBe(80);
    expect(rows[0].value).toBeCloseTo(rows[0].metrics.close * 10);
    expect((await send('POST', '/api/watchlist', { symbol: 'SOFI' })).status).toBe(400); // ซ้ำ
  });

  it('ticker ที่ไม่มีจริง → 400 และไม่ค้างในรายการ · หุ้นในรายการหลักไม่ต้องเพิ่ม', async () => {
    const bad = await send('POST', '/api/user-symbols', { symbol: 'ZZZZ' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Json).error).toContain('ไม่เจอข้อมูล');
    expect(users.list()).toEqual([]);
    expect((await send('POST', '/api/watchlist', { symbol: 'AAPL' })).status).toBe(201);
    expect(users.list()).toEqual([]);
    // หุ้นหลักที่ยังไม่มีข้อมูล → ดึงให้ตอนเพิ่ม
    expect(store.latest('AAPL', 'D1', 1)).toHaveLength(1);
  });

  it('ลบหุ้นที่เพิ่มเองได้ (ถ้าไม่อยู่ใน watchlist) · ลบหุ้นหลักไม่ได้', async () => {
    await send('POST', '/api/user-symbols', { symbol: 'SOFI' });
    expect((await send('DELETE', '/api/user-symbols/AAPL')).status).toBe(400);
    expect((await send('DELETE', '/api/user-symbols/SOFI')).status).toBe(204);
    expect(store.latest('SOFI', 'D1', 5)).toEqual([]);
  });
});
