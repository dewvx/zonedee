import {
  RUN_DEFAULTS,
  STRATEGIES,
  TIMEFRAME_MS,
  getStrategy,
  isTimeframe,
  runBacktest,
  type BacktestResult,
  type Candle,
  type DetectorConfig,
  type ParamValue,
  type Stats,
  type Timeframe,
} from '@zonedee/core';
import type { CandleStore } from './store';
import type { SymbolConfig } from './symbols';

/**
 * spread ทั่วไปของบัญชี XM Standard (points) — ค่าประมาณ ใช้เมื่อไม่ได้ระบุ
 * ของจริงดูในแผงคำนวณ lot (ดึงจาก MT5) แล้วกรอกเองได้
 */
export const TYPICAL_SPREAD_POINTS: Record<string, number> = {
  XAUUSD: 35,
  EURUSD: 16,
  GBPUSD: 20,
  USDJPY: 20,
};

export interface BacktestRequest {
  symbol: string;
  tf: string;
  /** id ของท่า หรือ 'all' = รันทุกท่าด้วยค่า default แล้วสรุปเทียบกัน */
  strategy: string;
  params?: Record<string, ParamValue>;
  cfg?: Partial<DetectorConfig>;
  /** ช่วงข้อมูล (UTC ms) — ไม่ส่ง = ทั้งหมดที่มี */
  from?: number;
  to?: number;
  spreadPoints?: number;
  riskPct?: number;
  initialBalance?: number;
  maxBarsInTrade?: number;
  oosFraction?: number;
  baselineRuns?: number;
  seed?: number;
}

export interface BacktestMeta {
  symbol: string;
  tf: Timeframe;
  strategy: string;
  strategyName: string;
  bars: number;
  from: number | null;
  to: number | null;
  signals: number;
  spreadPoints: number;
  /** มีแท่ง M1 ไว้แยกแท่งที่โดนทั้ง SL/TP ไหม (D10) */
  fineData: boolean;
  durationMs: number;
}

export interface BacktestResponse {
  meta: BacktestMeta;
  result: BacktestResult;
}

export interface CompareRow {
  strategy: string;
  strategyName: string;
  source: string;
  signals: number;
  stats: Stats;
  outOfSample: Stats;
  percentile: number | null;
}

export interface CompareResponse {
  meta: Omit<BacktestMeta, 'strategy' | 'strategyName' | 'signals'>;
  rows: CompareRow[];
}

export class BacktestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** ข้อมูลสูงสุดต่อการรัน (กันเครื่องค้าง) — M1 ปีกว่าๆ */
const MAX_BARS = 600_000;
/** แท่ง M1 สูงสุดที่โหลดมาช่วยแยก SL/TP (เกินนี้ข้าม → นับเป็น SL ตาม D10) */
const MAX_FINE_BARS = 800_000;

interface Loaded {
  tf: Timeframe;
  candles: Candle[];
  fine: Candle[] | null;
  spreadPoints: number;
  spread: number;
}

function load(store: CandleStore, cfg: SymbolConfig, req: BacktestRequest): Loaded {
  const tf = String(req.tf ?? '').toUpperCase();
  if (!isTimeframe(tf) || !cfg.timeframes.includes(tf)) {
    throw new BacktestError(`${cfg.symbol} ไม่มี timeframe ${req.tf} (มี: ${cfg.timeframes.join(', ')})`);
  }
  const from = Number.isFinite(req.from) ? req.from! : 0;
  const to = Number.isFinite(req.to) ? req.to! : Date.now() + TIMEFRAME_MS.W1;
  let candles = store.range(cfg.symbol, tf, from, to);
  if (candles.length > MAX_BARS) candles = candles.slice(-MAX_BARS);
  if (candles.length < 100) {
    throw new BacktestError(
      `ข้อมูล ${cfg.symbol} ${tf} มีแค่ ${candles.length} แท่ง — ดึงข้อมูลก่อน (ปุ่ม ⟳ อัปเดต หรือ npm run fetch)`,
      422,
    );
  }
  // แท่ง M1 ช่วงเดียวกัน ไว้แยกแท่งที่โดนทั้ง SL และ TP (D10)
  let fine: Candle[] | null = null;
  if (tf !== 'M1' && cfg.timeframes.includes('M1')) {
    const f = store.range(cfg.symbol, 'M1', candles[0]!.time, candles.at(-1)!.time + TIMEFRAME_MS[tf] - 1);
    if (f.length > 0 && f.length <= MAX_FINE_BARS) fine = f;
  }
  const spreadPoints = Number.isFinite(req.spreadPoints)
    ? Math.max(0, req.spreadPoints!)
    : (TYPICAL_SPREAD_POINTS[cfg.symbol] ?? 0);
  return { tf, candles, fine, spreadPoints, spread: spreadPoints * 10 ** -cfg.digits };
}

function runOne(d: Loaded, req: BacktestRequest, strategyId: string, params?: Record<string, ParamValue>) {
  const strat = getStrategy(strategyId);
  if (!strat) throw new BacktestError(`ไม่รู้จักท่า: ${strategyId} (มี: ${STRATEGIES.map((s) => s.id).join(', ')})`);
  const signals = strat.generate({ candles: d.candles, tf: d.tf, cfg: req.cfg, params });
  const result = runBacktest(d.candles, signals, {
    tf: d.tf,
    spread: d.spread,
    maxBarsInTrade: req.maxBarsInTrade ?? 0,
    fine: d.fine ? { candles: d.fine, tf: 'M1' } : undefined,
    riskPct: req.riskPct ?? RUN_DEFAULTS.riskPct,
    initialBalance: req.initialBalance ?? RUN_DEFAULTS.initialBalance,
    oosFraction: req.oosFraction ?? RUN_DEFAULTS.oosFraction,
    baselineRuns: req.baselineRuns ?? RUN_DEFAULTS.baselineRuns,
    seed: req.seed ?? RUN_DEFAULTS.seed,
  });
  return { strat, signals, result };
}

const baseMeta = (cfg: SymbolConfig, d: Loaded, started: number) => ({
  symbol: cfg.symbol,
  tf: d.tf,
  bars: d.candles.length,
  from: d.candles[0]?.time ?? null,
  to: d.candles.at(-1)?.time ?? null,
  spreadPoints: d.spreadPoints,
  fineData: d.fine !== null,
  durationMs: Date.now() - started,
});

/** backtest ท่าเดียว — ใช้ข้อมูลจาก SQLite (ไม่ดึงใหม่) */
export function backtestOne(store: CandleStore, cfg: SymbolConfig, req: BacktestRequest): BacktestResponse {
  const started = Date.now();
  const d = load(store, cfg, req);
  const { strat, signals, result } = runOne(d, req, req.strategy, req.params);
  return {
    meta: { ...baseMeta(cfg, d, started), strategy: strat.id, strategyName: strat.name, signals: signals.length },
    result,
  };
}

/** รันทุกท่า (ค่า default) บนข้อมูลชุดเดียวกัน แล้วเรียงตาม expectancy */
export function backtestCompare(store: CandleStore, cfg: SymbolConfig, req: BacktestRequest): CompareResponse {
  const started = Date.now();
  const d = load(store, cfg, req);
  const rows: CompareRow[] = STRATEGIES.filter((s) => s.timeframes.includes(d.tf)).map((s) => {
    const { signals, result } = runOne(d, { ...req, baselineRuns: req.baselineRuns ?? 100 }, s.id);
    return {
      strategy: s.id,
      strategyName: s.name,
      source: s.source,
      signals: signals.length,
      stats: result.stats,
      outOfSample: result.outOfSample,
      percentile: result.baseline?.percentile ?? null,
    };
  });
  rows.sort((a, b) => b.stats.expectancyR - a.stats.expectancyR);
  return { meta: baseMeta(cfg, d, started), rows };
}

/** รายชื่อท่าสำหรับ UI (ไม่มีฟังก์ชัน) */
export const strategyList = () =>
  STRATEGIES.map(({ id, name, source, description, timeframes, params }) => ({
    id,
    name,
    source,
    description,
    timeframes,
    params,
  }));
