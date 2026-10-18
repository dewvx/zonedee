import type { Signal } from '../backtest/types';
import type { DetectorConfig } from '../config';
import type { Candle, Timeframe } from '../types';

export type ParamValue = number | boolean | string;

/** คำอธิบายค่าที่ปรับได้ของท่า (UI สร้างฟอร์มจากตรงนี้) */
export interface ParamSpec {
  key: string;
  label: string;
  help?: string;
  type: 'number' | 'boolean' | 'select';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export interface StrategyInput {
  /** แท่งของ TF ที่เทรด (TF เล็กสุดของท่า) */
  candles: readonly Candle[];
  tf: Timeframe;
  /** ค่า detector (swingLength, breakBy, ...) — ไม่ส่ง = DEFAULTS */
  cfg?: Partial<DetectorConfig>;
  /** ค่าของท่า — ไม่ส่ง = default ใน params */
  params?: Record<string, ParamValue>;
}

export interface StrategyDef {
  id: string;
  name: string;
  /** มาจากไฟล์ไหน */
  source: 'ริวเรน' | 'Braron' | 'ทั่วไป';
  /** อธิบาย flow ที่โค้ดทำจริง (ภาษาคน) */
  description: string;
  /** TF ที่ใช้ได้ */
  timeframes: Timeframe[];
  params: ParamSpec[];
  /**
   * สร้างสัญญาณแบบ causal: สัญญาณที่ index i ใช้ข้อมูลแค่แท่ง 0..i
   * (เทสต์: สัญญาณจากข้อมูลบางส่วน = สัญญาณจากข้อมูลทั้งหมดที่ index ≤ จุดตัด)
   */
  generate(input: StrategyInput): Signal[];
}
