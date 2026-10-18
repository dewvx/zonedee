import type { Signal } from '../backtest/types';
import { ema } from '../indicators/ema';
import {
  P_MIN_RR,
  P_RR,
  P_SL_BUFFER,
  P_TP_MODE,
  confirmStates,
  finalize,
  makeCtx,
  resolveParams,
  targetFor,
  type Dir,
} from './common';
import type { ParamSpec, StrategyDef } from './types';

const params: ParamSpec[] = [
  { key: 'emaFast', label: 'EMA เร็ว', type: 'number', default: 9, min: 2, max: 200, step: 1 },
  { key: 'emaSlow', label: 'EMA ช้า', type: 'number', default: 21, min: 3, max: 400, step: 1 },
  {
    key: 'requireConfirm',
    label: 'ต้องมี CHoCH → BOS ก่อน',
    help: 'โครงสร้างหน้า 8 ของริวเรน — ปิด = เข้าทุกครั้งที่ EMA ตัด (ไว้เทียบ)',
    type: 'boolean',
    default: true,
  },
  P_TP_MODE,
  P_RR,
  P_SL_BUFFER,
  P_MIN_RR,
];

/**
 * ท่า 3 ริวเรน: EMA Cross (docs/rules.md ชั้นที่ 2)
 * EMA เร็วตัด EMA ช้าในทิศเดียวกับที่ ltfConfirm (CHoCH → BOS) ยืนยันแล้ว → เข้าที่ราคาเปิดแท่งถัดไป
 * SL: swing ล่าสุดฝั่งตรงข้าม (buy = swing low) เลยออกไป slBufferAtr × ATR · TP: R:R หรือ swing ล่าสุดฝั่งกำไร
 */
export const emaCross: StrategyDef = {
  id: 'ema-cross',
  name: 'ท่า 3 · EMA Cross',
  source: 'ริวเรน',
  description:
    'รอโครงสร้าง CHoCH → BOS ยืนยันทิศ แล้วรอ EMA 9 ตัด EMA 21 ไปทางเดียวกัน → เข้าทันที · SL หลัง swing ล่าสุด',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1', 'W1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const ctx = makeCtx(input);
    const { candles, n } = ctx;
    const closes = candles.map((c) => c.close);
    const fast = ema(closes, p.num('emaFast'));
    const slow = ema(closes, p.num('emaSlow'));
    const { state } = confirmStates(n, ctx.eventsAt);
    const out: Signal[] = [];

    for (let i = 1; i < n; i++) {
      const f0 = fast[i - 1];
      const s0 = slow[i - 1];
      const f1 = fast[i];
      const s1 = slow[i];
      const a = ctx.atr[i];
      if (f0 == null || s0 == null || f1 == null || s1 == null || a == null) continue;
      let dir: Dir | null = null;
      if (f0 <= s0 && f1 > s1) dir = 'bull';
      else if (f0 >= s0 && f1 < s1) dir = 'bear';
      if (!dir) continue;
      if (p.bool('requireConfirm') && state[i] !== dir) continue;

      const swing = ctx.latestSwing(i, dir === 'bull' ? 'low' : 'high');
      if (!swing) continue;
      const buf = p.num('slBufferAtr') * a;
      const entry = candles[i]!.close;
      const sl = dir === 'bull' ? swing.price - buf : swing.price + buf;
      const tp = targetFor(ctx, i, dir, entry, sl, p.str('tpMode'), p.num('rr'));
      if (tp == null) continue;
      const sig = finalize(
        {
          index: i,
          dir,
          entryType: 'market',
          entry,
          sl,
          tp,
          reason: `EMA ${p.num('emaFast')}/${p.num('emaSlow')} ตัด${dir === 'bull' ? 'ขึ้น' : 'ลง'}${
            p.bool('requireConfirm') ? ' หลัง CHoCH→BOS' : ''
          }`,
        },
        p.num('minRR'),
      );
      if (sig) out.push(sig);
    }
    return out;
  },
};
