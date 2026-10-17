import { TIMEFRAME_MS, type Candle, type Timeframe } from './types';

/**
 * สร้างแท่งเทียนจำลอง (random walk) แบบ deterministic — seed เดิมได้กราฟเดิมทุกครั้ง
 * ใช้ใน Phase 0 ระหว่างยังไม่มีข้อมูลจริง และใช้ทำ fixture ในเทสต์
 */
export interface SampleOptions {
  count: number;
  timeframe: Timeframe;
  startPrice: number;
  /** เวลาเปิดของแท่งแรก (UTC ms) */
  startTime?: number;
  /** ความผันผวนต่อแท่ง เป็นสัดส่วนของราคา เช่น 0.002 = 0.2% */
  volatility?: number;
  seed?: number;
  /** จำนวนทศนิยมที่ปัดราคา */
  digits?: number;
}

/** PRNG ขนาดเล็กที่ให้ผลซ้ำได้ (mulberry32) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** แปลงข้อความ (เช่นชื่อ symbol) เป็น seed ตัวเลข */
export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateSampleCandles(opts: SampleOptions): Candle[] {
  const {
    count,
    timeframe,
    startPrice,
    volatility = 0.002,
    seed = 42,
    digits = 2,
  } = opts;
  const step = TIMEFRAME_MS[timeframe];
  const startTime = opts.startTime ?? Math.floor(Date.UTC(2026, 0, 5) / step) * step;
  const rand = mulberry32(seed);
  const round = (v: number) => Number(v.toFixed(digits));

  const candles: Candle[] = [];
  let price = startPrice;
  // drift ค่อยๆ เปลี่ยนทิศ ให้กราฟมีเทรนด์และไซด์เวย์สลับกันเหมือนของจริง
  let drift = 0;

  for (let i = 0; i < count; i++) {
    if (i % 40 === 0) drift = (rand() - 0.5) * volatility * 0.6;
    const open = price;
    const change = open * (drift + (rand() - 0.5) * 2 * volatility);
    const close = Math.max(open + change, open * 0.5);
    const wickUp = Math.abs(change) * rand() + open * volatility * rand() * 0.5;
    const wickDown = Math.abs(change) * rand() + open * volatility * rand() * 0.5;
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;

    candles.push({
      time: startTime + i * step,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(100 + rand() * 900),
    });
    price = close;
  }
  return candles;
}
