import type { Candle, Timeframe } from '../types';

/** สัญญาณจากท่าเทรด — รู้ผล ณ แท่ง `index` ปิด (เข้าออเดอร์ได้ตั้งแต่แท่งถัดไป) */
export interface Signal {
  index: number;
  direction: 'long' | 'short';
  /** market = เข้าที่ราคาเปิดแท่งถัดไป · limit = ตั้งรอที่ราคา entry */
  entryType: 'market' | 'limit';
  /** ราคาเข้า (limit) — market ใช้ราคาเปิดแท่งถัดไปแทน (ค่านี้ไว้แสดงผล) */
  entry: number;
  sl: number;
  tp: number;
  /** limit order หมดอายุหลังกี่แท่ง (ค่าเริ่มต้น 50) */
  expiryBars?: number;
  /** เหตุผลที่เข้า (ภาษาคน) */
  reason: string;
}

export type ExitReason = 'tp' | 'sl' | 'time' | 'eod';

export interface Trade {
  signalIndex: number;
  entryIndex: number;
  exitIndex: number;
  entryTime: number;
  exitTime: number;
  direction: 'long' | 'short';
  /** ราคาเข้าจริง (รวม spread แล้ว) */
  entry: number;
  sl: number;
  tp: number;
  exit: number;
  exitReason: ExitReason;
  /** กำไร/ขาดทุนเป็นเท่าของความเสี่ยง (1R = ระยะ entry→SL) */
  r: number;
  barsHeld: number;
  reason: string;
}

export interface BacktestOptions {
  tf: Timeframe;
  /** spread เป็นหน่วยราคา (points × point) — ราคาในข้อมูลถือเป็นราคา bid */
  spread?: number;
  /** ปิดสถานะเมื่อถือครบกี่แท่ง (0 = ไม่จำกัด) */
  maxBarsInTrade?: number;
  /** แท่ง TF ละเอียด (M1) ไว้แยกว่าแท่งที่โดนทั้ง SL และ TP อันไหนโดนก่อน */
  fine?: { candles: readonly Candle[]; tf: Timeframe };
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  /** ค่าเฉลี่ย R ต่อเทรด — ตัวชี้ว่ามี edge หรือไม่ (> 0 = ได้เปรียบ) */
  expectancyR: number;
  totalR: number;
  /** กำไรรวม ÷ ขาดทุนรวม (null = ยังไม่มีไม้แพ้) */
  profitFactor: number | null;
  maxDrawdownR: number;
  maxConsecLosses: number;
  avgBarsHeld: number;
  longs: number;
  shorts: number;
  longExpectancyR: number;
  shortExpectancyR: number;
  /** ยอดเงินสุดท้ายถ้าเสี่ยงคงที่ riskPct% ของยอดปัจจุบันต่อไม้ (ทบต้น) */
  finalBalance: number;
  maxDrawdownPct: number;
}

export interface EquityPoint {
  time: number;
  r: number;
  balance: number;
}

export interface BaselineResult {
  runs: number;
  mean: number;
  p5: number;
  p50: number;
  p95: number;
  /** เปอร์เซ็นไทล์ของ expectancy ท่านี้ เทียบกับการเข้าสุ่ม (0–100) */
  percentile: number;
}

export interface BacktestResult {
  trades: Trade[];
  /** สัญญาณที่ถูกข้าม (ติดสถานะอยู่ / limit ไม่ถูกจับ / ราคากระโดดข้าม) */
  skipped: number;
  stats: Stats;
  inSample: Stats;
  outOfSample: Stats;
  /** เวลาที่แบ่ง in-sample / out-of-sample */
  splitTime: number | null;
  equity: EquityPoint[];
  baseline: BaselineResult | null;
}
