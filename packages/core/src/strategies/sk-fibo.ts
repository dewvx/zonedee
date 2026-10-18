import type { Signal } from '../backtest/types';
import { P_MIN_RR, P_SL_BUFFER, extremeIn, finalize, fmt, makeCtx, resolveParams } from './common';
import type { SwingPoint } from '../structure/swings';
import type { ParamSpec, StrategyDef } from './types';

/** swing ตัวแรกชนิด kind ที่ pivotIndex ≥ from (swings เรียงตาม pivotIndex) */
function firstSwingFrom(swings: readonly SwingPoint[], from: number, kind: 'high' | 'low'): SwingPoint | null {
  let lo = 0;
  let hi = swings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (swings[mid]!.pivotIndex < from) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < swings.length; k++) if (swings[k]!.kind === kind) return swings[k]!;
  return null;
}

/** ระดับ Fibo ที่ใช้ (docs/rules.md: sk Fibo) */
export const FIBO_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 0.886, 1, 1.618, 1.809, 2] as const;

/**
 * ราคาที่ระดับ Fibo ของขา low→high (ขาขึ้น) — retracement วัดจาก high ลงมา, extension วัดจาก low ขึ้นไป
 * ขาลงกลับด้าน: ส่ง from = high, to = low
 */
export function fiboPrice(from: number, to: number, level: number, kind: 'retrace' | 'extension'): number {
  const range = to - from;
  return kind === 'retrace' ? to - level * range : from + level * range;
}

const params: ParamSpec[] = [
  {
    key: 'entryLevel',
    label: 'ระดับเข้า',
    help: 'buy1 = 0.5–0.618 · buy2 = 0.786–0.886',
    type: 'select',
    default: '0.618',
    options: [
      { value: '0.5', label: '0.5 (buy1 บน)' },
      { value: '0.618', label: '0.618 (buy1 ล่าง)' },
      { value: '0.786', label: '0.786 (buy2 บน)' },
      { value: '0.886', label: '0.886 (buy2 ล่าง)' },
    ],
  },
  {
    key: 'tpExt',
    label: 'TP Fibo Extension',
    help: 'หนังสือใช้ 1.618–2.0',
    type: 'number',
    default: 1.618,
    min: 1.1,
    max: 3,
    step: 0.001,
  },
  {
    key: 'after',
    label: 'หลังการเบรกแบบไหน',
    type: 'select',
    default: 'any',
    options: [
      { value: 'any', label: 'BOS และ CHoCH' },
      { value: 'BOS', label: 'เฉพาะ BOS' },
      { value: 'CHoCH', label: 'เฉพาะ CHoCH' },
    ],
  },
  { key: 'expiryBars', label: 'limit หมดอายุ (แท่ง)', type: 'number', default: 30, min: 1, max: 500, step: 1 },
  P_SL_BUFFER,
  P_MIN_RR,
];

/**
 * sk Fibo ของ Braron (docs/rules.md ชั้นที่ 3)
 * 1. เกิด BOS ขึ้น → ขาที่เบรกเริ่มจากฐาน (originPrice)
 * 2. รอ swing high ตัวแรกหลังแท่งเบรกยืนยัน = ยอดของขา (ใช้ high สูงสุดจากฐานถึงยอด)
 *    ระหว่างนั้นถ้าปิดต่ำกว่าฐาน = ขาพัง ไม่เข้า
 * 3. ตั้ง buy limit ที่ระดับ retracement (ค่าเริ่มต้น 0.618) · SL ใต้ฐาน (Fibo 1) · TP = extension 1.618 ของขา
 * ฝั่ง sell กลับด้าน
 */
export const skFibo: StrategyDef = {
  id: 'sk-fibo',
  name: 'sk Fibo (buy1/buy2)',
  source: 'Braron',
  description:
    'หลังเบรกโครงสร้าง ลาก Fibo จากฐานถึงยอดของขาที่เบรก แล้วตั้ง limit รอที่ 0.5–0.618 (buy1) หรือ 0.786–0.886 (buy2) · SL ใต้ฐาน · TP extension 1.618',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1', 'W1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const ctx = makeCtx(input);
    const { candles } = ctx;
    const level = Number(p.str('entryLevel'));
    const after = p.str('after');
    const out: Signal[] = [];
    const used = new Set<number>();

    for (const e of ctx.events) {
      if (after !== 'any' && e.type !== after) continue;
      const bull = e.direction === 'bull';
      // swing ตัวแรกฝั่งยอดของขา ที่ pivot อยู่ตั้งแต่แท่งเบรกเป็นต้นไป
      const top = firstSwingFrom(ctx.swings, e.breakIndex, bull ? 'high' : 'low');
      if (!top || used.has(top.pivotIndex)) continue;
      const c = top.confirmIndex;
      // ขาพังก่อนยอดยืนยัน: ปิดเลยฐาน หรือมีการเบรกสวนทาง
      let broken = false;
      for (let k = e.breakIndex + 1; k <= c && !broken; k++) {
        const close = candles[k]!.close;
        if (bull ? close < e.originPrice : close > e.originPrice) broken = true;
      }
      if (broken) continue;
      let opposite = false;
      for (let k = e.breakIndex + 1; k <= c && !opposite; k++)
        opposite = ctx.eventsAt(k).some((x) => x.direction !== e.direction);
      if (opposite) continue;
      used.add(top.pivotIndex);

      const a = ctx.atr[c];
      if (a == null) continue;
      const legFrom = e.originPrice; // จุดเริ่มขา (ฐาน)
      const legTo = extremeIn(candles, e.originIndex, top.pivotIndex, bull ? 'high' : 'low'); // ยอดของขา
      const buf = p.num('slBufferAtr') * a;
      const entry = fiboPrice(legFrom, legTo, level, 'retrace');
      const sl = bull ? legFrom - buf : legFrom + buf;
      const tp = fiboPrice(legFrom, legTo, p.num('tpExt'), 'extension');
      const sig = finalize(
        {
          index: c,
          dir: e.direction,
          entryType: 'limit',
          entry,
          sl,
          tp,
          expiryBars: p.num('expiryBars'),
          reason: `${e.type} ${bull ? 'ขึ้น' : 'ลง'} → Fibo ${fmt(legFrom)}→${fmt(legTo)} รอที่ ${level}`,
        },
        p.num('minRR'),
      );
      if (sig) out.push(sig);
    }
    return out.sort((x, y) => x.index - y.index);
  },
};
