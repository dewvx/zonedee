import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSampleCandles, getStrategy, type Candle } from '@zonedee/core';
import { closedOnly, createAlertEngine, evaluateRule, isDue } from '../src/alerts/engine';
import { createLineNotifier, type LineNotifier } from '../src/alerts/line';
import { AlertStore, type AlertRule } from '../src/alerts/store';
import { ingest } from '../src/ingest';
import { CandleStore } from '../src/store';
import { findSymbol } from '../src/symbols';

const M = 60_000;
const T0 = Date.UTC(2026, 9, 12); // จันทร์
const bars = (closes: number[], tfMs = 15 * M): Candle[] =>
  closes.map((c, i) => ({ time: T0 + i * tfMs, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 }));

const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({
  id: 1,
  createdAt: 0,
  updatedAt: 0,
  name: 'test',
  enabled: true,
  symbol: 'XAUUSD',
  tf: 'M15',
  kind: 'price',
  strategy: '',
  params: {},
  swingLength: null,
  breakBy: null,
  condition: 'cross-above',
  price: 100,
  once: true,
  notifyLine: true,
  lastCheckedBar: null,
  lastFiredAt: null,
  lastError: null,
  ...patch,
});

describe('evaluateRule — ราคา', () => {
  const data = bars([98, 99, 99.5, 101, 102]);

  it('ครั้งแรกไม่แจ้งของเก่า แค่จำแท่งล่าสุด', () => {
    const r = evaluateRule(rule(), data, 2);
    expect(r.fires).toEqual([]);
    expect(r.lastCheckedBar).toBe(data[4]!.time);
  });

  it('ปิดเหนือระดับในแท่งใหม่ → แจ้ง', () => {
    const r = evaluateRule(rule({ lastCheckedBar: data[2]!.time }), data, 2);
    expect(r.fires).toHaveLength(1);
    expect(r.fires[0]!.barTime).toBe(data[3]!.time);
    expect(r.fires[0]!.message).toContain('ปิดเหนือ 100.00');
  });

  it('ปิดใต้ / แตะ', () => {
    const down = bars([102, 101, 99]);
    expect(evaluateRule(rule({ condition: 'cross-below', lastCheckedBar: down[0]!.time }), down, 2).fires).toHaveLength(1);
    expect(evaluateRule(rule({ condition: 'touch', price: 101.2, once: false, lastCheckedBar: down[0]!.time }), down, 2).fires).toHaveLength(1);
  });

  it('เหตุการณ์เก่าเกิน 3 แท่ง (server ปิดไปนาน) → ไม่แจ้ง', () => {
    const long = bars([98, 101, 102, 103, 104, 105, 106]);
    expect(evaluateRule(rule({ lastCheckedBar: long[0]!.time }), long, 2).fires).toEqual([]);
  });
});

describe('evaluateRule — ท่า', () => {
  it('แจ้งเฉพาะสัญญาณที่แท่งใหม่กว่าที่ตรวจล่าสุด ด้วยข้อมูลเดียวกับ backtest', () => {
    const data = generateSampleCandles({ count: 3000, timeframe: 'M15', startPrice: 2650, seed: 5, startTime: T0 });
    const sigs = getStrategy('sk-fibo')!.generate({ candles: data, tf: 'M15' });
    const target = sigs.at(-1)!;
    const upto = data.slice(0, target.index + 1);
    const r = evaluateRule(
      rule({ kind: 'strategy', strategy: 'sk-fibo', price: null, lastCheckedBar: upto.at(-2)!.time }),
      upto,
      2,
    );
    expect(r.fires).toHaveLength(1);
    expect(r.fires[0]!.signal).toMatchObject({ direction: target.direction, entry: target.entry, sl: target.sl, tp: target.tp });
    expect(r.fires[0]!.message).toContain('ไม่ได้ส่งออเดอร์');
  });
});

describe('closedOnly / isDue', () => {
  it('ตัดแท่งที่ยังไม่ปิดทิ้ง', () => {
    const data = bars([1, 2, 3]);
    expect(closedOnly(data, { tf: 'M15' }, data[2]!.time + 5 * M)).toHaveLength(2);
    expect(closedOnly(data, { tf: 'M15' }, data[2]!.time + 15 * M)).toHaveLength(3);
  });
  it('ถึงเวลาตรวจเมื่อแท่งถัดไปปิดแล้ว', () => {
    expect(isDue(rule({ lastCheckedBar: T0 }), T0 + 29 * M)).toBe(false);
    expect(isDue(rule({ lastCheckedBar: T0 }), T0 + 30 * M)).toBe(true);
    expect(isDue(rule({ enabled: false }), T0)).toBe(false);
  });
});

describe('LINE notifier', () => {
  it('ส่ง push ด้วย token + userId และแปลง error เป็นภาษาคน', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = createLineNotifier({ token: 'TKN', userId: 'U123' }, (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    await ok.push('hello');
    expect(calls[0]!.url).toBe('https://api.line.me/v2/bot/message/push');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer TKN');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ to: 'U123', messages: [{ type: 'text', text: 'hello' }] });

    const bad = createLineNotifier({ token: 'x', userId: 'U' }, (async () =>
      new Response(JSON.stringify({ message: 'Authentication failed' }), { status: 401 })) as typeof fetch);
    await expect(bad.push('x')).rejects.toThrow(/token ผิด/);
    expect(createLineNotifier(null).configured).toBe(false);
  });
});

describe('alert engine', () => {
  let store: CandleStore;
  let alerts: AlertStore;
  let sent: string[];
  let now: number;
  const gold = findSymbol('XAUUSD')!;
  const line: LineNotifier = {
    configured: true,
    push: async (t) => {
      sent.push(t);
    },
    quota: async () => ({ limit: 200, used: 0 }),
  };

  beforeEach(() => {
    store = new CandleStore(':memory:');
    alerts = new AlertStore(':memory:');
    sent = [];
  });
  afterEach(() => {
    store.close();
    alerts.close();
  });

  it('รอบแรกจำจุดเริ่ม → ราคาข้ามระดับในแท่งใหม่ → แจ้งในแอป + LINE แล้วปิดกฎ (once)', async () => {
    const m1 = (closes: number[], from: number): Candle[] =>
      closes.map((c, i) => ({ time: from + i * M, open: c, high: c + 0.1, low: c - 0.1, close: c, volume: 1 }));
    ingest(store, gold, 'M1', m1(Array.from({ length: 60 }, () => 2600), T0));
    now = T0 + 60 * M;
    let fetches = 0;
    const engine = createAlertEngine({
      store,
      alerts,
      line,
      findSymbol,
      now: () => now,
      runFetch: async () => {
        fetches++;
        return { symbol: 'XAUUSD', source: 'mt5', total: 0, errors: [], durationMs: 0 };
      },
    });
    const r = alerts.createRule({ symbol: 'XAUUSD', tf: 'M15', kind: 'price', condition: 'cross-above', price: 2605 });
    await engine.tick();
    expect(alerts.rule(r.id)!.lastCheckedBar).toBe(T0 + 45 * M);
    expect(alerts.events()).toHaveLength(0);

    // แท่ง M15 ถัดไปปิดเหนือ 2605
    ingest(store, gold, 'M1', m1(Array.from({ length: 15 }, () => 2610), T0 + 60 * M));
    now = T0 + 75 * M;
    const st = await engine.tick();
    expect(st.fired).toBe(1);
    expect(fetches).toBe(2);
    const ev = alerts.events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ ruleId: r.id, line: 'sent', barTime: T0 + 60 * M });
    expect(sent[0]).toContain('ปิดเหนือ 2605.00');
    expect(alerts.rule(r.id)!.enabled).toBe(false);
  });

  it('ดึงข้อมูลใหม่ไม่ได้ → ยังตรวจด้วยข้อมูลเดิม และบอก error ไว้ที่กฎ', async () => {
    ingest(store, gold, 'M1', generateSampleCandles({ count: 120, timeframe: 'M1', startPrice: 2600, startTime: T0 }));
    const engine = createAlertEngine({
      store,
      alerts,
      line,
      findSymbol,
      now: () => T0 + 200 * M,
      runFetch: async () => {
        throw new Error('เชื่อมต่อ MT5 ไม่ได้');
      },
    });
    const r = alerts.createRule({ symbol: 'XAUUSD', tf: 'M5', kind: 'strategy', strategy: 'ema-cross' });
    await engine.tick();
    expect(alerts.rule(r.id)!.lastError).toContain('MT5');
    expect(alerts.rule(r.id)!.lastCheckedBar).not.toBeNull();
  });

  it('กฎผิด → error ตอนสร้าง', () => {
    expect(() => alerts.createRule({ symbol: 'XAUUSD', tf: 'M15', kind: 'strategy', strategy: 'nope' })).toThrow(/ไม่รู้จักท่า/);
    expect(() => alerts.createRule({ symbol: 'XAUUSD', tf: 'M15', kind: 'price' })).toThrow(/ราคา/);
  });
});

describe('alerts API', () => {
  it('สร้าง/แก้/ลบกฎ + สถานะ + ตรวจเดี๋ยวนี้', async () => {
    const { createApp } = await import('../src/app');
    const store = new CandleStore(':memory:');
    const alerts = new AlertStore(':memory:');
    const line = createLineNotifier(null);
    const runFetch = async () => ({ symbol: '', source: '', total: 0, errors: [], durationMs: 0 });
    const engine = createAlertEngine({ store, alerts, line, findSymbol, runFetch });
    const app = createApp({ store, runFetch, alerts: { store: alerts, engine, line } });
    const server = await new Promise<import('node:http').Server>((r) => {
      const s = app.listen(0, () => r(s));
    });
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    const send = (method: string, path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    try {
      const created = (await (await send('POST', '/api/alerts/rules', { symbol: 'XAUUSD', tf: 'M15', kind: 'strategy', strategy: 'crt' })).json()) as AlertRule;
      expect(created).toMatchObject({ symbol: 'XAUUSD', enabled: true, notifyLine: true, name: 'XAUUSD M15 ท่า 6 · CRT' });
      const upd = (await (await send('PUT', `/api/alerts/rules/${created.id}`, { enabled: false })).json()) as AlertRule;
      expect(upd.enabled).toBe(false);
      expect((await send('POST', '/api/alerts/rules', { symbol: 'NOPE', tf: 'M15', kind: 'price', price: 1 })).status).toBe(400);
      const status = (await (await fetch(`${base}/api/alerts/status`)).json()) as { line: { configured: boolean } };
      expect(status.line.configured).toBe(false);
      expect((await send('POST', '/api/alerts/test-line')).status).toBe(400);
      expect((await send('POST', '/api/alerts/check')).status).toBe(200);
      expect((await send('DELETE', `/api/alerts/rules/${created.id}`)).status).toBe(204);
      expect(await (await fetch(`${base}/api/alerts/rules`)).json()).toEqual([]);
    } finally {
      await new Promise((r) => server.close(r));
      store.close();
      alerts.close();
    }
  });
});
