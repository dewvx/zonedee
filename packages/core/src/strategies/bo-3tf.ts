import type { Signal } from '../backtest/types';
import { htfView, lastClosedHtf } from '../mtf';
import { detectBoBoxHistory, type BoBoxLife } from '../structure/bo-boxes';
import type { Timeframe } from '../types';
import { P_ENTRY, P_EXPIRY, P_MIN_RR, P_SL_BUFFER, finalize, fmt, makeCtx, resolveParams } from './common';
import type { ParamSpec, StrategyDef } from './types';

/**
 * ชุด TF ของ Braron: TF เล็ก (ที่เทรด) → [TF กลาง, TF ใหญ่]
 * จากหนังสือ: M30-M15-M5, H4-H1-M30, W1-D1-H4, M15-M5-M1 · M10, M15, H1, H2 เราเติมเอง (D13)
 */
export const BO3_SETS: Partial<Record<Timeframe, [Timeframe, Timeframe]>> = {
  M1: ['M5', 'M15'],
  M5: ['M15', 'M30'],
  M10: ['M30', 'H1'],
  M15: ['M30', 'H1'],
  M30: ['H1', 'H4'],
  H1: ['H4', 'D1'],
  H2: ['H4', 'D1'],
  H4: ['D1', 'W1'],
};

const params: ParamSpec[] = [
  { ...P_ENTRY, help: 'limit = รอราคากลับมาทดสอบขอบกรอบ TF เล็ก (เส้น BO) · market = เข้าทันทีที่กรอบเกิด' },
  P_EXPIRY,
  P_SL_BUFFER,
  P_MIN_RR,
];

const aliveAt = (b: BoBoxLife, i: number) => b.createdIndex <= i && (b.expiredIndex === null || b.expiredIndex > i);

/**
 * Bo buy / Bo sell 3 TF ของ Braron (docs/rules.md ชั้นที่ 3, D5 ✅)
 * buy: มีกรอบเขียว (Bo buy) ของ TF ใหญ่ที่ยังไม่หมดอายุ → หลังจากนั้น TF กลางเกิดกรอบแดง (Bo sell) เหนือราคา
 * → TF เล็กเกิดกรอบเขียวใหม่ = buy · TP = ขอบล่างกรอบแดง TF กลาง · SL ใต้กรอบเขียว TF เล็ก
 * (เขียว 2 แดง 1) · sell กลับด้าน (แดง 2 เขียว 1) · กรอบ TF ใหญ่/กลางใช้ได้หลังแท่งของ TF นั้นปิดแล้วเท่านั้น
 */
export const bo3tf: StrategyDef = {
  id: 'bo-3tf',
  name: 'Bo buy / Bo sell 3 TF',
  source: 'Braron',
  description:
    'กรอบเขียว TF ใหญ่ → TF กลางขึ้นไปทำกรอบแดง → TF เล็กย่อแล้วทำกรอบเขียว = buy · TP ที่กรอบแดง TF กลาง (เขียว 2 แดง 1) · sell กลับด้าน',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4'],
  params,
  generate(input) {
    const set = BO3_SETS[input.tf];
    if (!set) return [];
    const [midTf, bigTf] = set;
    const p = resolveParams(params, input.params);
    const ctx = makeCtx(input);
    const { candles } = ctx;
    const mid = htfView(candles, input.tf, midTf);
    const big = htfView(candles, input.tf, bigTf);
    const midBoxes = detectBoBoxHistory(mid.candles, ctx.cfg);
    const bigBoxes = detectBoBoxHistory(big.candles, ctx.cfg);
    const out: Signal[] = [];

    for (const small of detectBoBoxHistory(candles, ctx.cfg)) {
      const i = small.createdIndex;
      const a = ctx.atr[i];
      if (a == null) continue;
      const bull = small.direction === 'bull';
      const bi = lastClosedHtf(big, i);
      const mi = lastClosedHtf(mid, i);
      if (bi < 0 || mi < 0) continue;

      // TF ใหญ่: กรอบสีเดียวกับกรอบ TF เล็กที่ยังไม่หมดอายุ (ตัวล่าสุด)
      const anchor = bigBoxes.filter((b) => b.direction === small.direction && aliveAt(b, bi)).at(-1);
      if (!anchor) continue;
      const anchorTime = big.candles[anchor.createdIndex]!.time;
      const price = candles[i]!.close;
      // TF กลาง: กรอบสีตรงข้ามที่เกิดหลังกรอบ TF ใหญ่ และอยู่ฝั่งกำไร → ใช้กรอบที่ใกล้ราคาที่สุดเป็นเป้า
      const targets = midBoxes.filter(
        (b) =>
          b.direction !== small.direction &&
          aliveAt(b, mi) &&
          mid.candles[b.createdIndex]!.time >= anchorTime &&
          (bull ? b.bottom > price : b.top < price),
      );
      if (targets.length === 0) continue;
      const target = targets.reduce((x, y) => (bull ? (y.bottom < x.bottom ? y : x) : y.top > x.top ? y : x));

      const limit = p.str('entryMode') === 'limit';
      const buf = p.num('slBufferAtr') * a;
      const sig = finalize(
        {
          index: i,
          dir: small.direction,
          entryType: limit ? 'limit' : 'market',
          entry: limit ? (bull ? small.top : small.bottom) : price,
          sl: bull ? small.bottom - buf : small.top + buf,
          tp: bull ? target.bottom : target.top,
          expiryBars: p.num('expiryBars'),
          reason: `${bull ? 'เขียว' : 'แดง'} ${bigTf} → ${bull ? 'แดง' : 'เขียว'} ${midTf} (${fmt(bull ? target.bottom : target.top)}) → ${bull ? 'เขียว' : 'แดง'} ${input.tf}`,
        },
        p.num('minRR'),
      );
      if (sig) out.push(sig);
    }
    return out.sort((x, y) => x.index - y.index);
  },
};
