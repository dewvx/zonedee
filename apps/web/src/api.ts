import type { Candle, ContractSpec, Market, Timeframe } from '@zonedee/core';

export type DataSourceName = 'dukascopy' | 'yahoo' | 'mt5';

export interface SymbolSummary {
  symbol: string;
  market: Market;
  digits: number;
  description: string;
  source: DataSourceName;
  timeframes: Timeframe[];
  /** null = ยังไม่ได้ดึงข้อมูลจริง */
  data: { tf: Timeframe; count: number; first: number; last: number } | null;
  /** ช่วงข้อมูลที่มีของแต่ละ TF */
  coverage: Partial<Record<Timeframe, { first: number; last: number; count: number }>>;
}

export interface CandlesResponse {
  symbol: string;
  timeframe: Timeframe;
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const fetchSymbols = () => request<SymbolSummary[]>('/api/symbols');

export const fetchCandles = (symbol: string, tf: Timeframe, count = 1000, before?: number) =>
  request<CandlesResponse>(
    `/api/candles?symbol=${symbol}&tf=${tf}&count=${count}${before !== undefined ? `&before=${before}` : ''}`,
  );

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
