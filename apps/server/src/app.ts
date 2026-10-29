import express from 'express';
import {
  TIMEFRAME_MS,
  generateSampleCandles,
  isTimeframe,
  keyLevels,
  resample,
  seedFromString,
  summarizeStock,
  watchMetrics,
  type Candle,
  type D1Cutoff,
} from '@zonedee/core';
import {
  BacktestError,
  backtestCompare,
  backtestOne,
  backtestTune,
  backtestWalkForward,
  backtestMultiPair,
  strategyList,
  type BacktestRequest,
  type TuneRequest,
  type WalkForwardRequest,
  type MultiPairRequest,
} from './backtest';
import type { ContractInfo } from './contract';
import { JournalError, type JournalInput, type JournalStore } from './journal';
import { DEFAULT_LINE_PER_DAY, type AlertEngine } from './alerts/engine';
import type { LineNotifier } from './alerts/line';
import { AlertError, type AlertRuleInput, type AlertStore } from './alerts/store';
import type { FetchOptions } from './fetch-job';
import type { RunResult } from './fetch-runner';
import type { CandleStore } from './store';
import { POPULAR_US, SCAN_SOURCES, type ScanRequest, type ScanResponse } from './scanner';
import { searchYahoo } from './fetchers';
import { SYMBOLS, findSymbol, type SymbolConfig } from './symbols';
import { TICKER_RE, type SymbolRegistry, type UserSymbolStore } from './user-symbols';
import type { EarningsCache } from './earnings';
import type { FundamentalsCache } from './fundamentals';
import type { NewsCache } from './news';
import { watchRows, type WatchInput, type WatchlistStore } from './watchlist';

export interface AppDeps {
  store: CandleStore;
  /** สั่งดึงข้อมูลใหม่ของ symbol (ใช้ใน POST /api/fetch) */
  runFetch: (cfg: SymbolConfig, opts?: FetchOptions) => Promise<RunResult>;
  /** สเปกสัญญา + ข้อมูลบัญชี (ใช้ใน GET /api/contract) */
  getContract?: (cfg: SymbolConfig) => Promise<ContractInfo>;
  dbPath?: string;
  symbols?: SymbolConfig[];
  /** บันทึกการเทรด (Phase 8) */
  journal?: JournalStore;
  /** แจ้งเตือน (Phase 9) */
  alerts?: { store: AlertStore; engine: AlertEngine; line: LineNotifier; linePerDay?: number };
  /** รายชื่อ symbol ทั้งหมด (รวมที่ผู้ใช้เพิ่ม) — ไม่ส่ง = ใช้ symbols */
  registry?: SymbolRegistry;
  userSymbols?: UserSymbolStore;
  /** watchlist ลงทุน (Phase 11) */
  watchlist?: WatchlistStore;
  /** ตัวสแกนหุ้นซิ่ง (Phase 10) */
  scan?: (req: ScanRequest) => Promise<ScanResponse>;
  /** วันประกาศงบ (หน้าลงทุน + แจ้งเตือน) */
  earnings?: EarningsCache;
  /** ข้อมูลงบการเงินย่อและอัตราส่วนทางการเงิน */
  fundamentals?: FundamentalsCache;
  /** ข่าวสารและสรุป Sentiment หุ้น */
  news?: NewsCache;
}

export function createApp(deps: AppDeps) {
  const {
    store,
    runFetch,
    getContract,
    dbPath,
    symbols = SYMBOLS,
    journal,
    alerts,
    registry,
    userSymbols,
    watchlist,
    scan,
    earnings,
    fundamentals,
    news,
  } = deps;
  const app = express();
  // รูปกราฟใน journal ส่งมาเป็น data URL → เผื่อขนาดไว้
  app.use(express.json({ limit: '15mb' }));
  const listSymbols = () => registry?.list() ?? symbols;
  const find = (s: unknown) =>
    registry
      ? registry.find(String(s ?? ''))
      : symbols === SYMBOLS
        ? findSymbol(String(s ?? ''))
        : symbols.find((x) => x.symbol === String(s ?? '').toUpperCase());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, phase: 7, db: dbPath });
  });

  /** รายชื่อ symbol + TF ที่ดูได้ + มีข้อมูลจริงหรือยัง */
  app.get('/api/symbols', (_req, res) => {
    res.json(
      listSymbols().map((s) => {
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
          d1Cutoff: s.d1Cutoff ?? 'utc',
          user: registry?.isUser(s.symbol) ?? false,
          data: base ? { tf: base.timeframe, count: base.count, first: base.first, last: base.last } : null,
          coverage: Object.fromEntries(
            stats.map((x) => [x.timeframe, { first: x.first, last: x.last, count: x.count }]),
          ),
        };
      }),
    );
  });

  /**
   * GET /api/symbols/search?q=<query>
   * ค้นหา symbol จาก:
   * 1. Symbol ที่มีอยู่ในระบบแล้ว (ทั้งหลักและที่เพิ่มเอง)
   * 2. หุ้น US ยอดนิยม (POPULAR_US)
   * 3. ผลค้นหาจาก Yahoo Finance search (กรณีพิมพ์ตัวย่อหรือชื่อบริษัท)
   */
  app.get('/api/symbols/search', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json([]);
      return;
    }
    const qUpper = q.toUpperCase();
    const results: Array<{
      symbol: string;
      description: string;
      market: 'forex' | 'us-stock';
      isKnown: boolean;
      type?: string;
    }> = [];
    const seen = new Set<string>();

    // 1. ค้นใน symbol ที่ระบบมีอยู่แล้ว
    for (const s of listSymbols()) {
      if (s.symbol.includes(qUpper) || s.description.toLowerCase().includes(q.toLowerCase())) {
        seen.add(s.symbol);
        results.push({
          symbol: s.symbol,
          description: s.description,
          market: s.market,
          isKnown: true,
        });
      }
    }

    // 2. ค้นใน POPULAR_US (100 หุ้นใหญ่ยอดนิยม)
    for (const sym of POPULAR_US) {
      if (!seen.has(sym) && sym.includes(qUpper)) {
        seen.add(sym);
        results.push({
          symbol: sym,
          description: sym,
          market: 'us-stock',
          isKnown: false,
        });
      }
    }

    // 3. ค้นจาก Yahoo Finance (ถ้า q ยาว >= 2 ตัวอักษร)
    if (q.length >= 2) {
      try {
        const yResults = await searchYahoo(q, 8);
        for (const item of yResults) {
          if (!seen.has(item.symbol)) {
            seen.add(item.symbol);
            results.push({
              symbol: item.symbol,
              description: item.name,
              market: 'us-stock',
              isKnown: false,
              type: item.type,
            });
          }
        }
      } catch {
        // ออฟไลน์หรือมีปัญหาเครือข่าย ให้ข้าม Yahoo search
      }
    }

    res.json(results.slice(0, 25));
  });

  /**
   * GET /api/candles?symbol=XAUUSD&tf=M15&count=1000[&before=<UTC ms> | &after=<UTC ms>]
   * - อ่านจาก SQLite เรียงเก่า → ใหม่
   * - before = โหลดแท่งที่เก่ากว่าเวลานี้ (เลื่อนกราฟไปทางซ้าย)
   * - after = แท่งตั้งแต่เวลานี้ไป (replay ใช้เป็นแท่งอนาคตที่ซ่อนไว้)
   * - hasMore = น่าจะยังมีแท่งเก่ากว่านี้อีก
   * - ยังไม่มีข้อมูลจริง → ส่งข้อมูลจำลอง (source: 'sample')
   */
  app.get('/api/candles', (req, res) => {
    const cfg = find(req.query.symbol ?? 'XAUUSD');
    const tf = String(req.query.tf ?? 'M15').toUpperCase();
    const count = Math.min(Math.max(Number(req.query.count ?? 1000) || 1000, 10), 5000);
    const before = req.query.before ? Number(req.query.before) : undefined;
    const after = req.query.after ? Number(req.query.after) : undefined;
    const cutoffParam = req.query.cutoff ?? req.query.d1Cutoff;
    const cutoff: D1Cutoff =
      cutoffParam === 'ny-close' || cutoffParam === 'ny'
        ? 'ny-close'
        : cutoffParam === 'utc'
          ? 'utc'
          : (cfg?.d1Cutoff ?? 'utc');

    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${req.query.symbol}` });
      return;
    }
    if (!isTimeframe(tf) || !cfg.timeframes.includes(tf)) {
      res.status(400).json({ error: `${cfg.symbol} ไม่มี timeframe ${tf} (มี: ${cfg.timeframes.join(', ')})` });
      return;
    }

    // กรณี D1 แบบ NY Close ของตลาด Forex ให้คำนวณจาก H1 (หรือ M1) ที่มี
    if (tf === 'D1' && cutoff === 'ny-close' && cfg.market === 'forex') {
      const h1Count = count * 24 + 48;
      let sourceCandles: Candle[] = [];
      if (after !== undefined) {
        sourceCandles = store.after(cfg.symbol, 'H1', Math.max(0, after - 24 * 3600_000), h1Count);
        if (sourceCandles.length === 0) {
          sourceCandles = store.after(cfg.symbol, 'M1', Math.max(0, after - 24 * 3600_000), h1Count * 60);
        }
      } else {
        sourceCandles = store.latest(cfg.symbol, 'H1', h1Count, before ? before + 24 * 3600_000 : undefined);
        if (sourceCandles.length === 0) {
          sourceCandles = store.latest(cfg.symbol, 'M1', h1Count * 60, before ? before + 24 * 3600_000 : undefined);
        }
      }

      if (sourceCandles.length > 0) {
        let d1Candles = resample(sourceCandles, 'D1', 'ny-close');
        if (before !== undefined) {
          d1Candles = d1Candles.filter((c) => c.time < before);
        }
        if (after !== undefined) {
          d1Candles = d1Candles.filter((c) => c.time >= after);
        }
        const sliced = after !== undefined ? d1Candles.slice(0, count) : d1Candles.slice(-count);
        res.json({
          symbol: cfg.symbol,
          timeframe: tf,
          cutoff: 'ny-close',
          source: cfg.source,
          candles: sliced,
          hasMore: sliced.length === count,
        });
        return;
      }
    }

    if (after !== undefined) {
      const candles = store.after(cfg.symbol, tf, after, count);
      res.json({ symbol: cfg.symbol, timeframe: tf, source: cfg.source, candles, hasMore: candles.length === count });
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

  /** GET /api/strategies — ท่าทั้งหมด + ค่าที่ปรับได้ (UI สร้างฟอร์มจากตรงนี้) */
  app.get('/api/strategies', (_req, res) => {
    res.json(strategyList());
  });

  /**
   * POST /api/backtest  body: BacktestRequest (ดู src/backtest.ts)
   * strategy = 'all' → รันทุกท่าด้วยค่า default แล้วเรียงเทียบกัน
   * ใช้ข้อมูลที่อยู่ใน SQLite แล้วเท่านั้น (ไม่ดึงใหม่ — ไม่มีข้อมูลจำลอง)
   */
  app.post('/api/backtest', (req, res) => {
    const body = (req.body ?? {}) as BacktestRequest;
    const cfg = find(body.symbol);
    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${body.symbol}` });
      return;
    }
    try {
      res.json(body.strategy === 'all' ? backtestCompare(store, cfg, body) : backtestOne(store, cfg, body));
    } catch (err) {
      const status = err instanceof BacktestError ? err.status : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/backtest/tune  body: TuneRequest (ดู src/backtest.ts)
   * รัน Grid Search Optimization หาค่าพารามิเตอร์ที่ดีที่สุดของท่า
   */

  /**
   * POST /api/backtest/walk-forward  body: WalkForwardRequest (ดู src/backtest.ts)
   * รัน Walk-Forward Analysis แบ่งหน้าต่างเวลาเลื่อนไปเรื่อยๆ เพื่อตรวจสอบความทนทาน
   */
  app.post('/api/backtest/walk-forward', (req, res) => {
    const body = (req.body ?? {}) as WalkForwardRequest;
    const cfg = find(body.symbol);
    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${body.symbol}` });
      return;
    }
    try {
      res.json(backtestWalkForward(store, cfg, body));
    } catch (err) {
      const status = err instanceof BacktestError ? err.status : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  /**
   * POST /api/backtest/multi-pair  body: MultiPairRequest (ดู src/backtest.ts)
   * รัน Backtest รวมหลายคู่เงินเข้าเป็นพอร์ตโฟลิโอเดียว
   */
  app.post('/api/backtest/multi-pair', (req, res) => {
    const body = (req.body ?? {}) as MultiPairRequest;
    try {
      res.json(backtestMultiPair(store, listSymbols(), body));
    } catch (err) {
      const status = err instanceof BacktestError ? err.status : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  app.post('/api/backtest/tune', (req, res) => {
    const body = (req.body ?? {}) as TuneRequest;
    const cfg = find(body.symbol);
    if (!cfg) {
      res.status(404).json({ error: `ไม่รู้จัก symbol: ${body.symbol}` });
      return;
    }
    try {
      res.json(backtestTune(store, cfg, body));
    } catch (err) {
      const status = err instanceof BacktestError ? err.status : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  });

  // ── Journal (Phase 8) ─────────────────────────────────────────────────
  const withJournal =
    (fn: (j: JournalStore, req: express.Request, res: express.Response) => void) =>
    (req: express.Request, res: express.Response) => {
      if (!journal) {
        res.status(501).json({ error: 'server นี้ไม่ได้เปิดใช้ journal' });
        return;
      }
      try {
        fn(journal, req, res);
      } catch (err) {
        res.status(err instanceof JournalError ? err.status : 500).json({ error: (err as Error).message });
      }
    };
  const idOf = (req: express.Request) => Number(req.params.id);

  app.get('/api/journal', withJournal((j, _req, res) => res.json(j.list())));
  app.post('/api/journal', withJournal((j, req, res) => {
    const { image, ...input } = (req.body ?? {}) as JournalInput & { image?: string };
    let entry = j.create(input);
    if (image) entry = j.addImage(entry.id, image);
    res.status(201).json(entry);
  }));
  app.put('/api/journal/:id', withJournal((j, req, res) => res.json(j.update(idOf(req), req.body ?? {}))));
  app.delete('/api/journal/:id', withJournal((j, req, res) => {
    j.delete(idOf(req));
    res.status(204).end();
  }));
  app.post('/api/journal/:id/images', withJournal((j, req, res) => res.json(j.addImage(idOf(req), String(req.body?.dataUrl ?? '')))));
  app.delete('/api/journal/:id/images/:name', withJournal((j, req, res) => res.json(j.removeImage(idOf(req), String(req.params.name)))));
  app.get('/api/journal-images/:name', withJournal((j, req, res) => {
    const p = j.imagePath(String(req.params.name));
    if (!p) {
      res.status(404).json({ error: 'ไม่เจอรูป' });
      return;
    }
    res.sendFile(p);
  }));

  // ── แจ้งเตือน (Phase 9) ───────────────────────────────────────────────
  const withAlerts =
    (fn: (a: NonNullable<AppDeps['alerts']>, req: express.Request, res: express.Response) => unknown) =>
    async (req: express.Request, res: express.Response) => {
      if (!alerts) {
        res.status(501).json({ error: 'server นี้ไม่ได้เปิดใช้การแจ้งเตือน' });
        return;
      }
      try {
        await fn(alerts, req, res);
      } catch (err) {
        res.status(err instanceof AlertError ? err.status : 500).json({ error: (err as Error).message });
      }
    };

  app.get('/api/alerts/rules', withAlerts((a, _req, res) => res.json(a.store.rules())));
  app.post('/api/alerts/rules', withAlerts((a, req, res) => {
    const body = (req.body ?? {}) as AlertRuleInput;
    if (!find(body.symbol)) throw new AlertError(`ไม่รู้จัก symbol: ${body.symbol}`);
    res.status(201).json(a.store.createRule(body));
  }));
  app.put('/api/alerts/rules/:id', withAlerts((a, req, res) => res.json(a.store.updateRule(Number(req.params.id), req.body ?? {}))));
  app.delete('/api/alerts/rules/:id', withAlerts((a, req, res) => {
    a.store.deleteRule(Number(req.params.id));
    res.status(204).end();
  }));
  app.get('/api/alerts/events', withAlerts((a, req, res) => res.json(a.store.events(Number(req.query.since ?? 0) || 0))));
  app.delete('/api/alerts/events', withAlerts((a, _req, res) => {
    a.store.clearEvents();
    res.status(204).end();
  }));
  app.get('/api/alerts/status', withAlerts((a, _req, res) => {
    const off = 7 * 3_600_000;
    const dayStart = Math.floor((Date.now() + off) / 86_400_000) * 86_400_000 - off;
    res.json({
      line: { configured: a.line.configured },
      engine: a.engine.status(),
      linePerDay: a.linePerDay ?? DEFAULT_LINE_PER_DAY,
      lineSentToday: a.store.lineSentSince(dayStart),
    });
  }));
  app.get('/api/alerts/line-quota', withAlerts(async (a, _req, res) => {
    if (!a.line.configured) throw new AlertError('ยังไม่ได้ตั้งค่า LINE');
    res.json(await a.line.quota());
  }));
  app.post('/api/alerts/test-line', withAlerts(async (a, _req, res) => {
    if (!a.line.configured)
      throw new AlertError('ยังไม่ได้ตั้งค่า LINE — ใส่ LINE_CHANNEL_ACCESS_TOKEN และ LINE_USER_ID ใน .env แล้วเปิด server ใหม่');
    await a.line.push('✅ zonedee เชื่อม LINE สำเร็จ — การแจ้งเตือนจะส่งมาที่นี่');
    res.json({ ok: true });
  }));
  /** ตรวจทุกกฎเดี๋ยวนี้ (ไม่รอรอบ) */
  app.post('/api/alerts/check', withAlerts(async (a, _req, res) => res.json(await a.engine.tick(true))));

  // ── หุ้นที่ผู้ใช้เพิ่มเอง + watchlist + สแกน (Phase 10–11) ─────────────
  const fail = (res: express.Response, err: unknown, status = 400) =>
    res.status(status).json({ error: (err as Error).message });

  /** ให้แน่ใจว่ารู้จัก symbol นี้ (หุ้น US ที่ไม่มีในรายการ → เพิ่ม + ดึง D1 จาก Yahoo ทดสอบว่ามีจริง) */
  async function ensureSymbol(symbol: string, description = ''): Promise<SymbolConfig> {
    const s = symbol.trim().toUpperCase();
    const known = find(s);
    if (known) return known;
    if (!userSymbols) throw new Error(`ไม่รู้จัก symbol: ${s}`);
    if (!TICKER_RE.test(s)) throw new Error(`ticker ไม่ถูกต้อง: ${symbol}`);
    userSymbols.add(s, description);
    const cfg = find(s)!;
    const r = await runFetch(cfg).catch((e: Error) => ({ total: 0, errors: [e.message] }));
    if (r.total === 0 && store.latest(s, 'D1', 1).length === 0) {
      userSymbols.remove(s);
      throw new Error(`ไม่เจอข้อมูลของ ${s} ใน Yahoo${r.errors.length ? ` (${r.errors.join(' · ')})` : ''} — เช็กตัวสะกด ticker`);
    }
    return cfg;
  }

  app.get('/api/user-symbols', (_req, res) => res.json(userSymbols?.list() ?? []));
  app.post('/api/user-symbols', async (req, res) => {
    try {
      const cfg = await ensureSymbol(String(req.body?.symbol ?? ''), String(req.body?.description ?? ''));
      res.status(201).json({ symbol: cfg.symbol });
    } catch (err) {
      fail(res, err);
    }
  });
  app.delete('/api/user-symbols/:symbol', (req, res) => {
    const s = String(req.params.symbol).toUpperCase();
    if (!userSymbols || !registry?.isUser(s)) {
      res.status(400).json({ error: 'ลบได้เฉพาะหุ้นที่เพิ่มเอง' });
      return;
    }
    if (watchlist?.list().some((w) => w.symbol === s)) {
      res.status(400).json({ error: `${s} ยังอยู่ใน watchlist — เอาออกจาก watchlist ก่อน` });
      return;
    }
    userSymbols.remove(s);
    store.deleteSymbol(s);
    res.status(204).end();
  });

  app.get('/api/watchlist', (_req, res) =>
    res.json(
      watchlist
        ? watchRows(
            watchlist.list(),
            store,
            (s) => earnings?.get(s) ?? null,
            (s) => fundamentals?.get(s) ?? null,
          )
        : [],
    ),
  );
  app.post('/api/watchlist', async (req, res) => {
    if (!watchlist) return fail(res, new Error('ไม่ได้เปิดใช้ watchlist'), 501);
    try {
      const body = (req.body ?? {}) as WatchInput & { description?: string };
      const cfg = await ensureSymbol(String(body.symbol ?? ''), body.description);
      if (cfg.market !== 'us-stock') throw new Error('watchlist ลงทุนใช้กับหุ้น US');
      // หุ้นในรายการหลักที่ยังไม่เคยดึง → ดึง D1 ให้เลย
      if (store.latest(cfg.symbol, 'D1', 1).length === 0) await runFetch(cfg).catch(() => undefined);
      res.status(201).json(watchlist.add({ ...body, symbol: cfg.symbol }));
    } catch (err) {
      fail(res, err);
    }
  });
  app.put('/api/watchlist/:id', (req, res) => {
    if (!watchlist) return fail(res, new Error('ไม่ได้เปิดใช้ watchlist'), 501);
    try {
      const { symbol: _s, ...patch } = (req.body ?? {}) as WatchInput;
      res.json(watchlist.update(Number(req.params.id), patch));
    } catch (err) {
      fail(res, err, 404);
    }
  });
  app.delete('/api/watchlist/:id', (req, res) => {
    watchlist?.remove(Number(req.params.id));
    res.status(204).end();
  });
  /** ดึงราคาใหม่ของหุ้นทุกตัวใน watchlist (Yahoo D1) + วันประกาศงบ + งบการเงิน */
  app.post('/api/watchlist/refresh', async (_req, res) => {
    const errors: string[] = [];
    let updated = 0;
    const items = watchlist?.list() ?? [];
    if (earnings && items.length) {
      await earnings.refresh(items.map((w) => w.symbol)).catch((e: Error) => errors.push(`วันประกาศงบ: ${e.message}`));
    }
    if (fundamentals && items.length) {
      await fundamentals.refresh(items.map((w) => w.symbol)).catch((e: Error) => errors.push(`งบการเงิน: ${e.message}`));
    }
    for (const w of items) {
      const cfg = find(w.symbol);
      if (!cfg) continue;
      try {
        const r = await runFetch(cfg);
        if (r.errors.length) errors.push(`${w.symbol}: ${r.errors.join(' · ')}`);
        else updated++;
      } catch (err) {
        errors.push(`${w.symbol}: ${(err as Error).message}`);
      }
    }
    res.json({ updated, errors });
  });

  /** GET /api/fundamentals?symbol=AAPL — ข้อมูลงบการเงินย่อและสรุปวิเคราะห์ */
  app.get('/api/fundamentals', async (req, res) => {
    const symbol = String(req.query.symbol ?? '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: 'ต้องระบุ symbol' });
      return;
    }
    const data = fundamentals ? await fundamentals.ensure(symbol).catch(() => null) : null;
    const candles = store.latest(symbol, 'D1', 600);
    const metrics = watchMetrics(candles);
    const levels = keyLevels(candles);
    const earningsTime = earnings?.get(symbol) ?? null;
    const earningsDaysLeft =
      earningsTime !== null ? Math.ceil((earningsTime - Date.now()) / (24 * 3_600_000)) : null;

    const summary = metrics
      ? summarizeStock({
          symbol,
          metrics,
          levels,
          fundamentals: data,
          earningsDaysLeft,
        })
      : null;

    res.json({ symbol, fundamentals: data, summary });
  });

  /** GET /api/news?symbol=AAPL — ข่าวล่าสุดและสรุป Sentiment */
  app.get('/api/news', async (req, res) => {
    const symbol = String(req.query.symbol ?? '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: 'ต้องระบุ symbol' });
      return;
    }
    if (!news) {
      res.status(501).json({ error: 'ไม่ได้เปิดใช้บริการข่าว' });
      return;
    }
    const force = req.query.force === 'true';
    try {
      const summary = await news.getOrFetch(symbol, force);
      res.json(summary);
    } catch (err) {
      fail(res, err, 500);
    }
  });

  /** POST /api/news/summarize — เรียก AI (Gemini / Claude) สรุปข่าวเป็นภาษาไทย */
  app.post('/api/news/summarize', async (req, res) => {
    const body = (req.body ?? {}) as { symbol?: string; provider?: 'gemini' | 'claude' };
    const symbol = String(body.symbol ?? '').toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: 'ต้องระบุ symbol' });
      return;
    }
    if (!news) {
      res.status(501).json({ error: 'ไม่ได้เปิดใช้บริการข่าว' });
      return;
    }
    try {
      const { aiSummary, provider } = await news.summarizeWithAi(symbol, body.provider);
      res.json({ symbol, aiSummary, provider });
    } catch (err) {
      fail(res, err, 400);
    }
  });

  app.get('/api/scan/sources', (_req, res) => res.json(SCAN_SOURCES));
  app.post('/api/scan', async (req, res) => {
    if (!scan) return fail(res, new Error('ไม่ได้เปิดใช้ตัวสแกน'), 501);
    const body = (req.body ?? {}) as ScanRequest;
    if (!SCAN_SOURCES.some((x) => x.id === body.source)) return fail(res, new Error(`ไม่รู้จักแหล่ง: ${body.source}`));
    try {
      res.json(await scan(body));
    } catch (err) {
      fail(res, err, 500);
    }
  });

  return app;
}
