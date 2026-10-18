import type { Signal } from '../backtest/types';
import { htfView } from '../mtf';
import { detectFVGs } from '../structure/fvg';
import { detectSweeps } from '../structure/sweeps';
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
  { ...P_HTF, help: 'TF ที่หา FVG (ไฟล์ใช้ 2h กับ M1)' },
  {
    key: 'confirmBars',
    label: 'รอ MSS กี่แท่งหลัง sweep',
    type: 'number',
    default: 30,
    min: 1,
    max: 500,
    step: 1,
  },
  P_TP_MODE,
  P_RR,
  P_SL_BUFFER,
  P_MIN_RR,
];

interface Armed {
  dir: Dir;
  top: number;
  bottom: number;
  label: string;
}

/**
 * ท่า 2 ริวเรน: FVG + Sweep (docs/rules.md ชั้นที่ 2)
 * FVG ของ TF ใหญ่ (ใช้ได้หลังแท่งที่ 3 ปิด) → ราคา TF เล็กเข้ามาในช่อง และเกิด sweep (ไส้กวาด swing แล้วปิดกลับ)
 * โดยไส้อยู่ในช่องหรือเลยช่อง แต่ปิดไม่ทะลุช่อง → รอ MSS (BOS/CHoCH) ทิศเดียวกันใน confirmBars แท่ง → เข้าทันที
 * SL: เลยจุดต่ำสุด/สูงสุดตั้งแต่ sweep · TP: R:R หรือ swing ล่าสุด
 * ช่องตาย: ราคา TF เล็กปิดทะลุฝั่งไกลของช่อง · แต่ละช่องใช้ครั้งเดียว
 */
export const fvgSweep: StrategyDef = {
  id: 'fvg-sweep',
  name: 'ท่า 2 · FVG + Sweep',
  source: 'ริวเรน',
  description:
    'รอราคาลงมาใน FVG ของ TF ใหญ่ แล้วมีไส้กวาด swing ใน TF เล็ก → รอ MSS ทิศกลับตัว → เข้า · SL เลยไส้ที่กวาด',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const htf = pickHtf(input.tf, p.str('htf'));
    if (!htf) return [];
    const ctx = makeCtx(input);
    const { candles, n } = ctx;
    const view = htfView(candles, input.tf, htf);

    // FVG ของ TF ใหญ่ → เปิดใช้ที่แท่ง TF เล็กไหน
    const arming = new Map<number, Armed[]>();
    for (const f of detectFVGs(view.candles, ctx.cfg)) {
      const at = view.availableAt[f.confirmIndex]!;
      if (!Number.isFinite(at)) continue;
      const list = arming.get(at) ?? [];
      list.push({ dir: f.direction, top: f.top, bottom: f.bottom, label: `FVG ${htf} ${fmt(f.bottom)}–${fmt(f.top)}` });
      arming.set(at, list);
    }
    const sweepsAt = new Map<number, Dir[]>();
    for (const s of detectSweeps(candles, ctx.cfg)) {
      const list = sweepsAt.get(s.confirmIndex) ?? [];
      list.push(s.direction);
      sweepsAt.set(s.confirmIndex, list);
    }

    const out: Signal[] = [];
    let armed: Armed[] = [];
    let pending: { gap: Armed; since: number; until: number; wick: number } | null = null;

    for (let i = 0; i < n; i++) {
      const bar = candles[i]!;
      // ช่องตาย = ปิดทะลุฝั่งไกล
      armed = armed.filter((g) => (g.dir === 'bull' ? bar.close >= g.bottom : bar.close <= g.top));

      if (pending) {
        const g = pending.gap;
        // ปิดเลยไส้ที่ sweep = กวาดไม่สำเร็จ
        const failed = g.dir === 'bull' ? bar.close < pending.wick : bar.close > pending.wick;
        const mss = ctx.eventsAt(i).find((e) => e.direction === g.dir);
        const a = ctx.atr[i];
        if (mss && a != null && !failed) {
          const ext = extremeIn(candles, pending.since, i, g.dir === 'bull' ? 'low' : 'high');
          const buf = p.num('slBufferAtr') * a;
          const entry = bar.close;
          const sl = g.dir === 'bull' ? ext - buf : ext + buf;
          const tp = targetFor(ctx, i, g.dir, entry, sl, p.str('tpMode'), p.num('rr'));
          const sig =
            tp == null
              ? null
              : finalize(
                  {
                    index: i,
                    dir: g.dir,
                    entryType: 'market',
                    entry,
                    sl,
                    tp,
                    reason: `${g.label} → sweep → ${mss.type} ${input.tf}`,
                  },
                  p.num('minRR'),
                );
          if (sig) out.push(sig);
          pending = null;
        } else if (failed || i >= pending.until) pending = null;
      }

      if (!pending) {
        for (const dir of sweepsAt.get(i) ?? []) {
          const idx = armed.findIndex((g) =>
            g.dir === dir && (dir === 'bull' ? bar.low <= g.top && bar.close >= g.bottom : bar.high >= g.bottom && bar.close <= g.top),
          );
          if (idx < 0) continue;
          const gap = armed[idx]!;
          armed.splice(idx, 1); // ใช้ช่องนี้ครั้งเดียว
          pending = { gap, since: i, until: i + p.num('confirmBars'), wick: dir === 'bull' ? bar.low : bar.high };
          break;
        }
      }

      for (const g of arming.get(i) ?? []) armed.push(g);
    }
    return out;
  },
};
