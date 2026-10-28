import type {
  KeyLevels,
  ScanOptions,
  StockScan,
  WatchMetrics,
  BacktestResult,
  Candle,
  ContractSpec,
  D1Cutoff,
  DetectorConfig,
  GridSearchRow,
  Market,
  ParamSpec,
  ParamValue,
  Stats,
  Timeframe,
  FundamentalData,
  StockSummaryResult,
  StockNewsItem,
  StockNewsSummary,
} from '@zonedee/core';

export type DataSourceName = 'dukascopy' | 'yahoo' | 'mt5';

export interface SymbolSummary {
  symbol: string;
  market: Market;
  digits: number;
  description: string;
  source: DataSourceName;
  timeframes: Timeframe[];
  d1Cutoff?: D1Cutoff;
  /** null = ยังไม่ได้ดึงข้อมูลจริง */
  data: { tf: Timeframe; count: number; first: number; last: number } | null;
  /** ช่วงข้อมูลที่มีของแต่ละ TF */
  coverage: Partial<Record<Timeframe, { first: number; last: number; count: number }>>;
  /** หุ้นที่ผู้ใช้เพิ่มเอง (ลบได้) */
  user?: boolean;
}

export interface CandlesResponse {
  symbol: string;
  timeframe: Timeframe;
  cutoff?: D1Cutoff;
  source: DataSourceName | 'sample';
  candles: Candle[];
  /** น่าจะยังมีแท่งเก่ากว่านี้ให้โหลดอีก */
  hasMore: boolean;
}

export interface FetchRunResult {
  symbol: string;
  source: string;
  total: number;
  errors: string[];
  durationMs: number;
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fetchSymbols = () => request<SymbolSummary[]>('/api/symbols');

export interface SymbolSearchResult {
  symbol: string;
  description: string;
  market: Market;
  isKnown: boolean;
  type?: string;
}

export const searchSymbols = (q: string) =>
  request<SymbolSearchResult[]>(`/api/symbols/search?q=${encodeURIComponent(q)}`);

export const fetchCandles = (
  symbol: string,
  tf: Timeframe,
  count = 1000,
  before?: number,
  cutoff?: D1Cutoff,
) =>
  request<CandlesResponse>(
    `/api/candles?symbol=${symbol}&tf=${tf}&count=${count}${before !== undefined ? `&before=${before}` : ''}${cutoff ? `&cutoff=${cutoff}` : ''}`,
  );

/** แท่งตั้งแต่เวลา `after` ไป (replay) */
export const fetchCandlesAfter = (symbol: string, tf: Timeframe, after: number, count = 200) =>
  request<CandlesResponse>(`/api/candles?symbol=${symbol}&tf=${tf}&count=${count}&after=${after}`);

/** สั่ง server ดึงข้อมูลใหม่จากแหล่ง (เหมือน npm run fetch -- --symbol X) */
export const triggerFetch = (symbol: string) =>
  request<FetchRunResult>(`/api/fetch?symbol=${symbol}`, { method: 'POST' });

/** สเปกสัญญา + ข้อมูลบัญชี (MT5 ถ้าเปิดอยู่ ไม่งั้นค่ามาตรฐาน) */
export interface ContractInfo {
  spec: ContractSpec;
  leverage: number | null;
  balance: number | null;
  accountCurrency: string;
  spreadPoints: number | null;
  source: 'mt5' | 'static';
  note?: string;
}

export const fetchContract = (symbol: string) => request<ContractInfo>(`/api/contract?symbol=${symbol}`);

// ── Backtest (Phase 6–7) ──────────────────────────────────────────────

export interface StrategyInfo {
  id: string;
  name: string;
  source: string;
  description: string;
  timeframes: Timeframe[];
  params: ParamSpec[];
}

export const fetchStrategies = () => request<StrategyInfo[]>('/api/strategies');

export interface BacktestRequest {
  symbol: string;
  tf: Timeframe;
  strategy: string;
  params?: Record<string, ParamValue>;
  cfg?: Partial<DetectorConfig>;
  from?: number;
  to?: number;
  spreadPoints?: number;
  riskPct?: number;
  initialBalance?: number;
  maxBarsInTrade?: number;
  oosFraction?: number;
  baselineRuns?: number;
  enableSwap?: boolean;
  swapLong?: number;
  swapShort?: number;
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
  swapLong?: number;
  swapShort?: number;
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

const postJson = <T>(url: string, body: unknown) =>
  request<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const runBacktest = (req: BacktestRequest) => postJson<BacktestResponse>('/api/backtest', req);
export const runCompare = (req: Omit<BacktestRequest, 'strategy'>) =>
  postJson<CompareResponse>('/api/backtest', { ...req, strategy: 'all' });

export interface TuneRequest extends BacktestRequest {
  grid?: Record<string, ParamValue[]>;
  maxCombinations?: number;
  topBaselineRuns?: number;
  minSignificantTrades?: number;
}

export interface TuneResponse {
  meta: BacktestMeta;
  strategy: string;
  strategyName: string;
  totalCombinations: number;
  testedCombinations: number;
  best: GridSearchRow | null;
  rows: GridSearchRow[];
}

export const runTune = (req: TuneRequest) => postJson<TuneResponse>('/api/backtest/tune', req);

// ── Journal (Phase 8) ─────────────────────────────────────────────────

export type JournalStatus = 'plan' | 'open' | 'closed' | 'cancelled';

export interface JournalEntry {
  id: number;
  createdAt: number;
  updatedAt: number;
  symbol: string;
  tf: Timeframe | null;
  direction: 'long' | 'short';
  status: JournalStatus;
  entryTime: number | null;
  entryPrice: number | null;
  sl: number | null;
  tp: number | null;
  lots: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  pnl: number | null;
  r: number | null;
  strategy: string;
  signalTime: number | null;
  setup: string;
  lesson: string;
  emotion: string;
  followedPlan: boolean | null;
  tags: string[];
  images: string[];
}

export type JournalInput = Partial<Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'r' | 'images'>>;

export const fetchJournal = () => request<JournalEntry[]>('/api/journal');
export const createJournal = (input: JournalInput & { image?: string }) => postJson<JournalEntry>('/api/journal', input);
export const updateJournal = (id: number, input: JournalInput) =>
  request<JournalEntry>(`/api/journal/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
export const deleteJournal = async (id: number) => {
  const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`ลบไม่ได้ (HTTP ${res.status})`);
};
export const addJournalImage = (id: number, dataUrl: string) =>
  postJson<JournalEntry>(`/api/journal/${id}/images`, { dataUrl });
export const removeJournalImage = (id: number, name: string) =>
  request<JournalEntry>(`/api/journal/${id}/images/${name}`, { method: 'DELETE' });
export const journalImageUrl = (name: string) => `/api/journal-images/${name}`;

// ── แจ้งเตือน (Phase 9) ───────────────────────────────────────────────

export type PriceCondition = 'cross-above' | 'cross-below' | 'touch';
export type LevelCondition = 'near-support' | 'near-resistance' | 'broke-support' | 'broke-resistance';

export interface AlertRule {
  id: number;
  createdAt: number;
  updatedAt: number;
  name: string;
  enabled: boolean;
  symbol: string;
  tf: Timeframe;
  kind: 'strategy' | 'price' | 'level' | 'earnings';
  strategy: string;
  params: Record<string, ParamValue>;
  swingLength: number | null;
  breakBy: 'close' | 'wick' | null;
  condition: PriceCondition;
  price: number | null;
  once: boolean;
  levelCondition: LevelCondition;
  daysBefore: number;
  notifyLine: boolean;
  lastCheckedBar: number | null;
  lastFiredAt: number | null;
  lastError: string | null;
}

export type AlertRuleInput = Partial<Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>>;

export interface AlertEvent {
  id: number;
  ruleId: number;
  ruleName: string;
  symbol: string;
  tf: Timeframe;
  barTime: number;
  firedAt: number;
  message: string;
  signal: { direction: 'long' | 'short'; entryType: 'market' | 'limit'; entry: number; sl: number; tp: number; reason: string } | null;
  strategy: string;
  line: 'sent' | 'failed' | 'off' | 'capped';
  lineError: string | null;
}

export interface AlertStatus {
  line: { configured: boolean };
  engine: { running: boolean; lastTick: number | null; lastTickMs: number | null; checked: number; fired: number; errors: string[] };
  linePerDay: number;
  lineSentToday: number;
}

const putJson = <T>(url: string, body: unknown) =>
  request<T>(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = async (url: string) => {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
};

export const fetchAlertRules = () => request<AlertRule[]>('/api/alerts/rules');
export const createAlertRule = (input: AlertRuleInput) => postJson<AlertRule>('/api/alerts/rules', input);
export const updateAlertRule = (id: number, input: AlertRuleInput) => putJson<AlertRule>(`/api/alerts/rules/${id}`, input);
export const deleteAlertRule = (id: number) => del(`/api/alerts/rules/${id}`);
export const fetchAlertEvents = (since = 0) => request<AlertEvent[]>(`/api/alerts/events?since=${since}`);
export const clearAlertEvents = () => del('/api/alerts/events');
export const fetchAlertStatus = () => request<AlertStatus>('/api/alerts/status');
export const fetchLineQuota = () => request<{ limit: number | null; used: number }>('/api/alerts/line-quota');
export const testLine = () => postJson<{ ok: true }>('/api/alerts/test-line', {});
export const checkAlertsNow = () => postJson<AlertStatus['engine']>('/api/alerts/check', {});

// ── หุ้น: เพิ่มเอง / watchlist / สแกน (Phase 10–11) ─────────────────────

export const addUserSymbol = (symbol: string, description = '') =>
  postJson<{ symbol: string }>('/api/user-symbols', { symbol, description });
export const removeUserSymbol = (symbol: string) => del(`/api/user-symbols/${symbol}`);

export interface WatchItem {
  id: number;
  symbol: string;
  shares: number | null;
  avgCost: number | null;
  dcaMonthly: number | null;
  targetPct: number | null;
  note: string;
  addedAt: number;
}
export interface WatchRow extends WatchItem {
  metrics: WatchMetrics | null;
  levels: KeyLevels | null;
  /** ข้อมูลงบการเงินย่อและอัตราส่วนทางการเงิน */
  fundamentals: FundamentalData | null;
  /** สรุปวิเคราะห์หุ้นอัตโนมัติภาษาไทย */
  summary: StockSummaryResult | null;
  /** วันประกาศงบครั้งถัดไป (UTC ms) */
  earnings: number | null;
  value: number | null;
  cost: number | null;
  pnl: number | null;
  pnlPct: number | null;
}
export type WatchInput = Partial<Omit<WatchItem, 'id' | 'addedAt'>>;

export const fetchWatchlist = () => request<WatchRow[]>('/api/watchlist');
export const addWatch = (input: WatchInput) => postJson<WatchItem>('/api/watchlist', input);
export const updateWatch = (id: number, input: WatchInput) => putJson<WatchItem>(`/api/watchlist/${id}`, input);
export const removeWatch = (id: number) => del(`/api/watchlist/${id}`);
export const refreshWatchlist = () => postJson<{ updated: number; errors: string[] }>('/api/watchlist/refresh', {});

export interface FundamentalsResponse {
  symbol: string;
  fundamentals: FundamentalData | null;
  summary: StockSummaryResult | null;
}

export const fetchFundamentals = (symbol: string) =>
  request<FundamentalsResponse>(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`);

export const fetchNews = (symbol: string, force = false) =>
  request<StockNewsSummary>(`/api/news?symbol=${encodeURIComponent(symbol)}${force ? '&force=true' : ''}`);

export const summarizeNewsWithAi = (symbol: string, provider?: 'gemini' | 'claude') =>
  postJson<{ symbol: string; aiSummary: string; provider: 'gemini' | 'claude' }>('/api/news/summarize', {
    symbol,
    provider,
  });

export interface ScanSource {
  id: string;
  label: string;
}
export interface ScanRow {
  symbol: string;
  name: string;
  marketCap: number | null;
  scan: StockScan | null;
  error: string | null;
}
export interface ScanResponse {
  source: string;
  scannedAt: number;
  rows: ScanRow[];
  error: string | null;
}
export const fetchScanSources = () => request<ScanSource[]>('/api/scan/sources');
export const runScan = (req: { source: string; symbols?: string[]; count?: number; options?: Partial<ScanOptions> }) =>
  postJson<ScanResponse>('/api/scan', req);
