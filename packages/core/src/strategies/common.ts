import type { Signal } from '../backtest/types';
import { DEFAULTS, type DetectorConfig } from '../config';
import { atr } from '../indicators/atr';
import { detectStructure, type StructureEvent } from '../structure/market-structure';
import { detectSwings, type SwingPoint } from '../structure/swings';
import { TIMEFRAME_MS, type Candle, type Timeframe } from '../types';
import type { ParamSpec, ParamValue, StrategyInput } from './types';

export type Dir = 'bull' | 'bear';

// ── ค่าที่หลายท่าใช้ร่วมกัน ──────────────────────────────────────────

export const P_SL_BUFFER: ParamSpec = {
  key: 'slBufferAtr',
  label: 'เผื่อ SL (× ATR)',
  help: 'วาง SL เลยระดับออกไปอีกเท่านี้ของ ATR กันโดนไส้',
  type: 'number',
  default: 0.1,
  min: 0,
  max: 3,
  step: 0.05,
};
export const P_MIN_RR: ParamSpec = {
  key: 'minRR',
  label: 'R:R ขั้นต่ำ',
  help: 'ข้ามสัญญาณที่ TP ใกล้เกินเมื่อเทียบกับ SL (Braron แนะนำ 1:2)',
  type: 'number',
  default: 1,
  min: 0,
  max: 10,
  step: 0.1,
};
export const P_TP_MODE: ParamSpec = {
  key: 'tpMode',
  label: 'วาง TP',
  type: 'select',
  default: 'rr',
  options: [
    { value: 'rr', label: 'เท่าของความเสี่ยง (R:R)' },
    { value: 'swing', label: 'swing ล่าสุดฝั่งกำไร' },
  ],
};
export const P_RR: ParamSpec = {
  key: 'rr',
  label: 'TP = กี่ R',
  help: 'ใช้เมื่อวาง TP แบบ R:R',
  type: 'number',
  default: 2,
  min: 0.5,
  max: 10,
  step: 0.5,
};
export const P_ENTRY: ParamSpec = {
  key: 'entryMode',
  label: 'วิธีเข้า (D8)',
  type: 'select',
  default: 'limit',
  options: [
    { value: 'limit', label: 'ตั้ง limit รอที่โซน' },
    { value: 'market', label: 'เข้าทันทีหลังยืนยัน' },
  ],
};
export const P_EXPIRY: ParamSpec = {
  key: 'expiryBars',
  label: 'limit หมดอายุ (แท่ง)',
  type: 'number',
  default: 30,
  min: 1,
  max: 500,
  step: 1,
};
export const P_HTF: ParamSpec = {
  key: 'htf',
  label: 'TF ใหญ่',
  type: 'select',
  default: 'auto',
  options: [
    { value: 'auto', label: 'อัตโนมัติ' },
    { value: 'M15', label: 'M15' },
    { value: 'M30', label: 'M30' },
    { value: 'H1', label: 'H1' },
    { value: 'H2', label: 'H2' },
    { value: 'H4', label: 'H4' },
    { value: 'D1', label: 'D1' },
  ],
};

/** รวมค่าที่ส่งมากับ default (ค่าที่ผิดชนิด/นอกช่วง → default) */
export function resolveParams(specs: readonly ParamSpec[], given: Record<string, ParamValue> = {}) {
  const out: Record<string, ParamValue> = {};
  for (const p of specs) {
    const v = given[p.key];
    if (p.type === 'number') {
      const ok = typeof v === 'number' && Number.isFinite(v);
      out[p.key] = ok ? Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v)) : p.default;
    } else if (p.type === 'boolean') out[p.key] = typeof v === 'boolean' ? v : p.default;
    else out[p.key] = typeof v === 'string' && p.options?.some((o) => o.value === v) ? v : p.default;
  }
  return {
    num: (k: string) => out[k] as number,
    bool: (k: string) => out[k] as boolean,
    str: (k: string) => out[k] as string,
  };
}

/** TF ใหญ่อัตโนมัติสำหรับท่า 2 TF (ตามตัวอย่างในไฟล์: H2→M5, 2h→M1, M10→M1, D1→M15) */
export const AUTO_HTF: Partial<Record<Timeframe, Timeframe>> = {
  M1: 'M15',
  M5: 'H1',
  M10: 'H1',
  M15: 'H4',
  M30: 'H4',
  H1: 'D1',
  H2: 'D1',
  H4: 'D1',
  D1: 'W1',
};

/** TF ใหญ่ที่จะใช้ — null ถ้าไม่ใหญ่กว่า TF ที่เทรด */
export function pickHtf(tf: Timeframe, choice: string): Timeframe | null {
  const htf = (choice === 'auto' ? AUTO_HTF[tf] : choice) as Timeframe | undefined;
  if (!htf || !(htf in TIMEFRAME_MS) || TIMEFRAME_MS[htf] <= TIMEFRAME_MS[tf]) return null;
  return htf;
}

// ── บริบทที่คำนวณครั้งเดียวต่อการรันท่า ───────────────────────────────

export interface Ctx {
  candles: readonly Candle[];
  n: number;
  cfg: DetectorConfig;
  atr: (number | null)[];
  swings: SwingPoint[];
  events: StructureEvent[];
  /** event ที่ยืนยันที่แท่ง i */
  eventsAt: (i: number) => StructureEvent[];
  /** swing ล่าสุดที่ยืนยันแล้ว ณ แท่ง i */
  latestSwing: (i: number, kind: 'high' | 'low') => SwingPoint | null;
}

export function makeCtx(input: StrategyInput): Ctx {
  const cfg = { ...DEFAULTS, ...input.cfg };
  const candles = input.candles;
  const swings = detectSwings(candles, { swingLength: cfg.swingLength });
  const events = detectStructure(candles, cfg);
  const byConfirm = new Map<number, StructureEvent[]>();
  for (const e of events) {
    const list = byConfirm.get(e.confirmIndex) ?? [];
    list.push(e);
    byConfirm.set(e.confirmIndex, list);
  }
  const highs = swings.filter((s) => s.kind === 'high');
  const lows = swings.filter((s) => s.kind === 'low');
  return {
    candles,
    n: candles.length,
    cfg,
    atr: atr(candles, cfg.atrPeriod),
    swings,
    events,
    eventsAt: (i) => byConfirm.get(i) ?? [],
    latestSwing: (i, kind) => lastByConfirm(kind === 'high' ? highs : lows, i),
  };
}

/** ตัวสุดท้ายที่ confirmIndex ≤ i (list เรียงตาม confirmIndex) */
function lastByConfirm(list: readonly SwingPoint[], i: number): SwingPoint | null {
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.confirmIndex <= i) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? list[ans]! : null;
}

/**
 * `ltfConfirm` (โครงสร้างหน้า 8 ของริวเรน): เห็น CHoCH แล้วตามด้วย BOS ทิศเดียวกัน
 * คืนสถานะหลังจบแท่ง i แต่ละแท่ง — CHoCH ทิศใหม่ล้างสถานะเดิม
 * mode 'choch' = แค่ CHoCH ก็นับ
 */
export function confirmStates(
  n: number,
  eventsAt: (i: number) => readonly StructureEvent[],
  mode: 'choch+bos' | 'choch' = 'choch+bos',
): { state: (Dir | null)[]; becameAt: (Dir | null)[] } {
  const state: (Dir | null)[] = new Array(n).fill(null);
  const becameAt: (Dir | null)[] = new Array(n).fill(null);
  let pending: Dir | null = null;
  let confirmed: Dir | null = null;
  for (let i = 0; i < n; i++) {
    const before: Dir | null = confirmed;
    for (const e of eventsAt(i)) {
      if (e.type === 'CHoCH') {
        if (mode === 'choch') confirmed = e.direction;
        else {
          pending = e.direction;
          if (confirmed !== e.direction) confirmed = null;
        }
      } else if (pending === e.direction) {
        confirmed = e.direction;
        pending = null;
      }
    }
    state[i] = confirmed;
    if (confirmed && confirmed !== before) becameAt[i] = confirmed;
  }
  return { state, becameAt };
}

/** low ต่ำสุด / high สูงสุด ในช่วง [from, to] */
export function extremeIn(candles: readonly Candle[], from: number, to: number, kind: 'low' | 'high'): number {
  let v = kind === 'low' ? Infinity : -Infinity;
  for (let k = Math.max(0, from); k <= to; k++) {
    const c = candles[k]!;
    v = kind === 'low' ? Math.min(v, c.low) : Math.max(v, c.high);
  }
  return v;
}

/** TP แบบ swing: swing ล่าสุดฝั่งกำไรที่ยังอยู่เลยราคาเข้า (ไม่มี → null) */
export function swingTarget(ctx: Ctx, i: number, dir: Dir, entry: number): number | null {
  const s = ctx.latestSwing(i, dir === 'bull' ? 'high' : 'low');
  if (!s) return null;
  return dir === 'bull' ? (s.price > entry ? s.price : null) : s.price < entry ? s.price : null;
}

export interface SignalDraft {
  index: number;
  dir: Dir;
  entryType: 'market' | 'limit';
  /** limit = ราคาตั้งรอ · market = ราคาอ้างอิง (ราคาปิดแท่งสัญญาณ) */
  entry: number;
  sl: number;
  tp: number;
  expiryBars?: number;
  reason: string;
}

/** ตรวจ SL/TP อยู่ถูกฝั่งและ R:R ถึงขั้นต่ำ → Signal (ไม่ผ่าน = null) */
export function finalize(d: SignalDraft, minRR: number): Signal | null {
  const long = d.dir === 'bull';
  if (![d.entry, d.sl, d.tp].every(Number.isFinite)) return null;
  if (long ? !(d.sl < d.entry && d.entry < d.tp) : !(d.tp < d.entry && d.entry < d.sl)) return null;
  const rr = Math.abs(d.tp - d.entry) / Math.abs(d.entry - d.sl);
  if (rr < minRR) return null;
  return {
    index: d.index,
    direction: long ? 'long' : 'short',
    entryType: d.entryType,
    entry: d.entry,
    sl: d.sl,
    tp: d.tp,
    ...(d.entryType === 'limit' ? { expiryBars: d.expiryBars ?? 30 } : {}),
    reason: d.reason,
  };
}

/** TP ตามโหมด: R:R หรือ swing */
export function targetFor(
  ctx: Ctx,
  i: number,
  dir: Dir,
  entry: number,
  sl: number,
  mode: string,
  rr: number,
): number | null {
  if (mode === 'swing') return swingTarget(ctx, i, dir, entry);
  const risk = Math.abs(entry - sl);
  return dir === 'bull' ? entry + rr * risk : entry - rr * risk;
}

export const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : x.toPrecision(6));
