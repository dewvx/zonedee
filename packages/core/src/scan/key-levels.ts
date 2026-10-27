import { computeZones, type Zone } from '../zones/sr-zones';
import type { Candle } from '../types';

/**
 * ค่าตั้งต้นของ "แนวรับต้านแบบง่าย" สำหรับหุ้นลงทุน (D1) — docs/rules.md หัวข้อ แนวรับต้านแบบง่าย
 * ใช้ตัวหาโซนตัวเดียวกับกราฟ แต่ swing กว้างกว่าและโซนหนากว่า ให้ได้แค่ระดับสำคัญไม่กี่เส้น
 */
export const LEVEL_DEFAULTS = {
  /** swing ต้องเป็นยอด/ก้นของกี่แท่งซ้าย-ขวา (D1: 5 ≈ 1 สัปดาห์) */
  swingLength: 5,
  /** รวม swing ที่ห่างกันไม่เกินนี้เป็นระดับเดียว (× ATR) */
  zoneMergeAtr: 0.5,
  /** ความหนาขั้นต่ำของระดับ (× ATR) */
  zoneWidthAtr: 0.3,
  /** โซนที่เอามาพิจารณาทั้งหมด (แบ่งเหนือ/ใต้ราคา) */
  maxZones: 12,
  /** แสดงฝั่งละกี่ระดับ */
  perSide: 3,
  /** ห่างจากระดับไม่เกินกี่ % ถึงนับว่า "ใกล้" */
  nearPct: 3,
  /** ทะลุ/หลุดภายในกี่แท่งล่าสุด */
  breakWithinBars: 3,
};
export type LevelOptions = typeof LEVEL_DEFAULTS;

export interface KeyLevel {
  /** ระดับราคา (กลางโซน) */
  price: number;
  top: number;
  bottom: number;
  /** ราคาเคยกลับตัวที่ระดับนี้กี่ครั้ง */
  touches: number;
  /** 1 = เบา · 2 = กลาง · 3 = แข็ง (จำนวนครั้งที่แตะ + กลับขั้วแล้ว) */
  strength: 1 | 2 | 3;
  /** ห่างจากราคาปิดล่าสุดกี่ % (บวก = อยู่เหนือราคา) */
  distancePct: number;
  /** R / S / RBS / SBR แบบเดียวกับบนกราฟ */
  label: Zone['label'];
}

export type LevelStatus = 'broke-resistance' | 'broke-support' | 'near-support' | 'near-resistance' | 'between';

export interface KeyLevels {
  time: number;
  close: number;
  /** ใต้ราคา เรียงจากใกล้ → ไกล */
  supports: KeyLevel[];
  /** เหนือราคา เรียงจากใกล้ → ไกล */
  resistances: KeyLevel[];
  nearSupport: boolean;
  nearResistance: boolean;
  /** แนวรับที่เพิ่งหลุด (ปิดต่ำกว่าขอบล่าง ภายใน breakWithinBars แท่ง) */
  brokeSupport: KeyLevel | null;
  /** แนวต้านที่เพิ่งทะลุ (ปิดเหนือขอบบน ภายใน breakWithinBars แท่ง) */
  brokeResistance: KeyLevel | null;
  /** สรุปสถานะเดียว: ทะลุ > หลุด > ใกล้แนวรับ > ใกล้แนวต้าน > อยู่กลาง */
  status: LevelStatus;
}

function toLevel(z: Zone, close: number): KeyLevel {
  const s = z.touches + (z.state === 'flipped' ? 1 : 0);
  return {
    price: z.center,
    top: z.top,
    bottom: z.bottom,
    touches: z.touches,
    strength: s >= 3 ? 3 : s === 2 ? 2 : 1,
    distancePct: ((z.center - close) / close) * 100,
    label: z.label,
  };
}

function split(zones: Zone[], close: number) {
  const supports = zones.filter((z) => z.center < close).sort((a, b) => b.center - a.center);
  const resistances = zones.filter((z) => z.center >= close).sort((a, b) => a.center - b.center);
  return { supports, resistances };
}

/**
 * แนวรับต้านสำคัญรอบราคาปัจจุบัน ณ แท่ง asOf (default แท่งสุดท้าย) — ข้อมูลประกอบ ไม่ใช่คำแนะนำซื้อขาย
 * - ระดับมาจาก computeZones (swing D1 รวมเป็นโซน) แบ่งเป็นใต้ราคา = แนวรับ / เหนือราคา = แนวต้าน
 * - ทะลุ/หลุด: เทียบราคาปิดล่าสุดกับระดับที่ใกล้ที่สุด ณ breakWithinBars แท่งก่อน
 * causal: ใช้แค่แท่ง 0..asOf
 */
export function keyLevels(
  candles: readonly Candle[],
  options: Partial<LevelOptions> = {},
  asOf: number = candles.length - 1,
): KeyLevels | null {
  const o = { ...LEVEL_DEFAULTS, ...options };
  if (asOf < 1 || asOf >= candles.length) return null;
  const cfg = {
    swingLength: o.swingLength,
    zoneMergeAtr: o.zoneMergeAtr,
    zoneWidthAtr: o.zoneWidthAtr,
    maxZones: o.maxZones,
  };
  const last = candles[asOf]!;
  const close = last.close;
  const now = split(computeZones(candles, cfg, asOf), close);
  const supports = now.supports.slice(0, o.perSide).map((z) => toLevel(z, close));
  const resistances = now.resistances.slice(0, o.perSide).map((z) => toLevel(z, close));

  const nearSupport = supports.length > 0 && Math.abs(supports[0]!.distancePct) <= o.nearPct;
  const nearResistance = resistances.length > 0 && Math.abs(resistances[0]!.distancePct) <= o.nearPct;

  let brokeSupport: KeyLevel | null = null;
  let brokeResistance: KeyLevel | null = null;
  const before = asOf - o.breakWithinBars;
  if (before >= 1) {
    const prevClose = candles[before]!.close;
    const then = split(computeZones(candles, cfg, before), prevClose);
    const s = then.supports[0];
    const r = then.resistances[0];
    if (s && close < s.bottom) brokeSupport = toLevel(s, close);
    if (r && close > r.top) brokeResistance = toLevel(r, close);
  }

  const status: LevelStatus = brokeResistance
    ? 'broke-resistance'
    : brokeSupport
      ? 'broke-support'
      : nearSupport
        ? 'near-support'
        : nearResistance
          ? 'near-resistance'
          : 'between';

  return { time: last.time, close, supports, resistances, nearSupport, nearResistance, brokeSupport, brokeResistance, status };
}

export const LEVEL_STATUS_TH: Record<LevelStatus, string> = {
  'broke-resistance': 'ทะลุแนวต้าน',
  'broke-support': 'หลุดแนวรับ',
  'near-support': 'ใกล้แนวรับ',
  'near-resistance': 'ใกล้แนวต้าน',
  between: 'อยู่ระหว่างกลาง',
};
