import express from 'express';
import { TIMEFRAME_MS, generateSampleCandles, isTimeframe, seedFromString } from '@zonedee/core';
import type { ContractInfo } from './contract';
import type { FetchOptions } from './fetch-job';
import type { RunResult } from './fetch-runner';
import type { CandleStore } from './store';
import { SYMBOLS, findSymbol, type SymbolConfig } from './symbols';

export interface AppDeps {
  store: CandleStore;
  /** สั่งดึงข้อมูลใหม่ของ symbol (ใช้ใน POST /api/fetch) */
  runFetch: (cfg: SymbolConfig, opts?: FetchOptions) => Promise<RunResult>;
  /** สเปกสัญญา + ข้อมูลบัญชี (ใช้ใน GET /api/contract) */
  getContract?: (cfg: SymbolConfig) => Promise<ContractInfo>;
  dbPath?: string;
  symbols?: SymbolConfig[];
}

export function createApp({ store, runFetch, getContract, dbPath, symbols = SYMBOLS }: AppDeps) {
  const app = express();
  const find = (s: unknown) =>
    symbols === SYMBOLS ? findSymbol(String(s ?? '')) : symbols.find((x) => x.symbol === String(s ?? '').toUpperCase());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, phase: 2, db: dbPath });
  });

  /** รายชื่อ symbol + TF ที่ดูได้ + มีข้อมูลจริงหรือยัง */
  app.get('/api/symbols', (_req, res) => {
    res.json(
      symbols.map((s) => {
        const stats = store.stats(s.symbol);
        // สรุปจาก native ที่ละเอียดที่สุดที่มีข้อมูล
        const base = s.natives
          .map((n) => stats.find((x) => x.timeframe === n.tf))
          .find((x) => x !== undefined);
        return {
          symbol: s.symbol,
          market: s.market,
          digits: s.digits,
          description: s.description,
          source: s.source,
          timeframes: s.timeframes,
          data: base ? { tf: base.timeframe, count: base.count, first: base.first, last: base.last } : null,
          coverage: Object.fromEntries(
            stats.map((x) => [x.timeframe, { first: x.first, last: x.last, count: x.count }]),
          ),
        };
      }),
    );
  });

  /**
   * GET /api/candles?symbol=XAUUSD&tf=M15&count=1000[&before=<UTC ms>]
   * - อ่านจาก SQLite เรียงเก่า → ใหม่
   * - before = โหลดแท่งที่เก่ากว่าเวลานี้ (เลื่อนกราฟไปทางซ้าย)
   * - hasMore = น่าจะยังมีแท่งเก่ากว่านี้อีก
   * - ยังไม่มีข้อมูลจริง → ส่งข้อมูลจำลอง (source: 'sample')
   */
  app.get('/api/candles', (req, res) => {
    const cfg = find(req.query.symbol ?? 'XAUUSD');
    const tf = String(req.query.tf ?? 'M15').toUpperCase();
    const count = Math.min(Math.max(Number(req.query.count ?? 1000) || 1000, 10), 5000);
    const before = req.query.before ? Number(req.query.before) : undefined;

    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${req.query.symbol}` });
      return;
    }
    if (!isTimeframe(tf) || !cfg.timeframes.includes(tf)) {
      res.status(400).json({ error: `${cfg.symbol} ไม่มี timeframe ${tf} (มี: ${cfg.timeframes.join(', ')})` });
      return;
    }

    const candles = store.latest(cfg.symbol, tf, count, before);
    if (candles.length > 0 || before !== undefined) {
      res.json({ symbol: cfg.symbol, timeframe: tf, source: cfg.source, candles, hasMore: candles.length === count });
      return;
    }

    const step = TIMEFRAME_MS[tf];
    res.json({
      symbol: cfg.symbol,
      timeframe: tf,
      source: 'sample',
      hasMore: false,
      candles: generateSampleCandles({
        count,
        timeframe: tf,
        startPrice: cfg.samplePrice,
        // ให้ข้อมูลจำลองจบที่เวลาปัจจุบัน
        startTime: Math.floor(Date.now() / step) * step - count * step,
        seed: seedFromString(`${cfg.symbol}:${tf}`),
        digits: cfg.digits,
        volatility: cfg.market === 'forex' ? 0.0015 : 0.004,
      }),
    });
  });

  /**
   * POST /api/fetch?symbol=XAUUSD — ดึงข้อมูลใหม่จากแหล่ง (ต่อจากของเดิม) เหมือน `npm run fetch -- --symbol`
   * ตอบเมื่อดึงเสร็จ: { symbol, source, total, errors[], durationMs }
   */
  app.post('/api/fetch', async (req, res) => {
    const cfg = find(req.query.symbol);
    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${req.query.symbol}` });
      return;
    }
    try {
      const result = await runFetch(cfg);
      const failed = result.errors.length > 0 && result.total === 0;
      res.status(failed ? 502 : 200).json(failed ? { ...result, error: result.errors.join(' · ') } : result);
    } catch (err) {
      res.status(502).json({ symbol: cfg.symbol, error: (err as Error).message });
    }
  });

  /** GET /api/contract?symbol=XAUUSD — สเปกสัญญาสำหรับเครื่องคิด lot (MT5 ถ้ามี ไม่งั้นค่ามาตรฐาน) */
  app.get('/api/contract', async (req, res) => {
    const cfg = find(req.query.symbol);
    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${req.query.symbol}` });
      return;
    }
    if (!getContract) {
      res.status(501).json({ error: 'server นี้ไม่ได้เปิดใช้ข้อมูลสัญญา' });
      return;
    }
    try {
      res.json(await getContract(cfg));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return app;
}
