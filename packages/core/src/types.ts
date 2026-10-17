/**
 * แท่งเทียน 1 แท่ง
 * - time = เวลาเปิดแท่ง เป็น UTC milliseconds (ทั้งโปรเจกต์ใช้หน่วยนี้หน่วยเดียว)
 * - volume ของ forex คือ tick volume ไม่ใช่วอลุ่มจริง
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const TIMEFRAMES = ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1', 'W1'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M10: 10 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H2: 2 * 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
  W1: 7 * 24 * 60 * 60_000,
};

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(value);
}

/** ประเภทตลาด — ใช้แยกโหมดของแอป */
export type Market = 'forex' | 'us-stock';

export interface SymbolInfo {
  symbol: string;
  market: Market;
  /** จำนวนทศนิยมที่ใช้แสดงราคา */
  digits: number;
  description: string;
}
