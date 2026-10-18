import type { Signal } from '../backtest/types';
import { htfView } from '../mtf';
import { detectOrderBlockHistory } from '../structure/order-blocks';
import {
  P_HTF,
  P_MIN_RR,
  P_RR,
  P_SL_BUFFER,
  P_TP_MODE,
  extremeIn,
  finalize,
  fmt,
  makeCtx,
  pickHtf,
  resolveParams,
  targetFor,
  type Dir,
} from './common';
import type { ParamSpec, StrategyDef } from './types';

const params: ParamSpec[] = [
  { ...P_HTF, help: 'TF ที่หา BOS + OB (ไฟล์ใช้ M10 กับ M1)' },
  {
    key: 'confirmBars',
    label: 'รอ MSS กี่แท่งหลังเข้าโซน',
    type: 'number',
    default: 60,
    min: 1,
    max: 1000,
    step: 1,
  },
  P_TP_MODE,
  P_RR,
  P_SL_BUFFER,
  P_MIN_RR,
];

interface Zone {
  dir: Dir;
  top: number;
  bottom: number;
  label: string;
}

/**
 * ท่า 5 ริวเรน: OB + BOS + กลับตัว (docs/rules.md ชั้นที่ 2)
 * TF ใหญ่: BOS แล้วได้ OB (ใช้ได้หลังแท่งเบรกของ TF ใหญ่ปิด) → ราคา TF เล็กกลับเข้ามาในโซน OB
 * → รอ CHoCH/MSS ทิศเดียวกับ OB ใน confirmBars แท่ง → เข้าทันที · SL เลยจุดสุดตั้งแต่เข้าโซน (หรือขอบ OB ถ้าไกลกว่า)
 * OB ตาย: ปิดทะลุฝั่งไกล · ใช้ครั้งเดียว
 */
export const obMss: StrategyDef = {
  id: 'ob-mss',
  name: 'ท่า 5 · OB + MSS',
  source: 'ริวเรน',
  description:
    'หา BOS และ Order Block ใน TF ใหญ่ → รอราคากลับเข้าโซน OB → TF เล็กเกิด CHoCH (MSS) ทิศเดียวกัน → เข้า · SL นอกโซน',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const htf = pickHtf(input.tf, p.str('htf'));
    if (!htf) return [];
    const ctx = makeCtx(input);
    const { candles, n } = ctx;
    const view = htfView(candles, input.tf, htf);

    const arming = new Map<number, Zone[]>();
    for (const ob of detectOrderBlockHistory(view.candles, ctx.cfg)) {
      const at = view.availableAt[ob.createdIndex]!;
      if (!Number.isFinite(at)) continue;
      const list = arming.get(at) ?? [];
      list.push({ dir: ob.direction, top: ob.top, bottom: ob.bottom, label: `OB ${htf} ${fmt(ob.bottom)}–${fmt(ob.top)}` });
      arming.set(at, list);
    }

    const out: Signal[] = [];
    let zones: Zone[] = [];
    let watch: { z: Zone; since: number } | null = null;

    for (let i = 0; i < n; i++) {
      const bar = candles[i]!;
      zones = zones.filter((z) => (z.dir === 'bull' ? bar.close >= z.bottom : bar.close <= z.top));

      if (watch) {
        const { z } = watch;
        const dead = z.dir === 'bull' ? bar.close < z.bottom : bar.close > z.top;
        const mss = ctx.eventsAt(i).find((e) => e.direction === z.dir && e.type === 'CHoCH');
        const a = ctx.atr[i];
        if (!dead && mss && a != null) {
          const ext = extremeIn(candles, watch.since, i, z.dir === 'bull' ? 'low' : 'high');
          const far = z.dir === 'bull' ? Math.min(ext, z.bottom) : Math.max(ext, z.top);
          const buf = p.num('slBufferAtr') * a;
          const entry = bar.close;
          const sl = z.dir === 'bull' ? far - buf : far + buf;
          const tp = targetFor(ctx, i, z.dir, entry, sl, p.str('tpMode'), p.num('rr'));
          const sig =
            tp == null
              ? null
              : finalize(
                  { index: i, dir: z.dir, entryType: 'market', entry, sl, tp, reason: `${z.label} → MSS ${input.tf}` },
                  p.num('minRR'),
                );
          if (sig) out.push(sig);
          watch = null;
        } else if (dead || i >= watch.since + p.num('confirmBars')) watch = null;
      }

      if (!watch) {
        const idx = zones.findIndex((z) => (z.dir === 'bull' ? bar.low <= z.top : bar.high >= z.bottom));
        if (idx >= 0) {
          watch = { z: zones[idx]!, since: i };
          zones.splice(idx, 1);
        }
      }
      for (const z of arming.get(i) ?? []) zones.push(z);
    }
    return out;
  },
};
