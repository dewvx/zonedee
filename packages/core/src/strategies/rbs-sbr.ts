import type { Signal } from '../backtest/types';
import { htfView } from '../mtf';
import { detectStructure } from '../structure/market-structure';
import {
  P_ENTRY,
  P_EXPIRY,
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
  { ...P_HTF, help: 'TF ที่ตีเส้น RBS/SBR (ไฟล์ใช้ H2 กับ M5)' },
  {
    key: 'touchTolAtr',
    label: 'ระยะนับว่าแตะเส้น (× ATR)',
    type: 'number',
    default: 0.2,
    min: 0,
    max: 3,
    step: 0.05,
  },
  {
    key: 'confirmMode',
    label: 'ยืนยันใน TF เล็ก',
    type: 'select',
    default: 'choch+bos',
    options: [
      { value: 'choch+bos', label: 'CHoCH แล้ว BOS (หน้า 8)' },
      { value: 'choch', label: 'แค่ CHoCH' },
    ],
  },
  {
    key: 'waitBars',
    label: 'รอยืนยันกี่แท่งหลังแตะ',
    type: 'number',
    default: 100,
    min: 5,
    max: 1000,
    step: 5,
  },
  { ...P_ENTRY, help: 'limit = รอย่อกลับมาที่ RBS/SBR ของ TF เล็ก (ระดับที่เพิ่งเบรก)' },
  P_EXPIRY,
  P_TP_MODE,
  P_RR,
  P_SL_BUFFER,
  P_MIN_RR,
];

interface Level {
  dir: Dir;
  price: number;
  /** ฐานของขาที่เบรก — ราคาปิดเลยตรงนี้ = เส้นพัง */
  invalid: number;
  label: string;
  /** ราคาออกห่างจากเส้นแล้ว (ต้องออกไปก่อนถึงจะนับว่า "ย่อกลับมาแตะ") */
  away: boolean;
}

/**
 * ท่า 1 ริวเรน: RBS / SBR หลาย TF (docs/rules.md ชั้นที่ 2)
 * TF ใหญ่: แนวต้านถูกปิดทะลุขึ้น (BOS/CHoCH ขึ้น) → เส้นนั้นเป็น RBS (ใช้ได้หลังแท่ง TF ใหญ่ปิด)
 * → ราคา TF เล็กออกห่างจากเส้นก่อน แล้วย่อกลับมาแตะ (± touchTolAtr × ATR) → รอ ltfConfirm ทิศขึ้นใน waitBars แท่ง
 * → limit ที่ระดับที่ TF เล็กเพิ่งเบรก (RBS ของ TF เล็ก) หรือเข้าทันที · SL ใต้จุดต่ำสุดตั้งแต่แตะ
 * เส้นพัง: ปิดต่ำกว่าฐานของขาที่เบรกใน TF ใหญ่ · แต่ละเส้นใช้ครั้งเดียว · SBR กลับด้าน
 */
export const rbsSbr: StrategyDef = {
  id: 'rbs-sbr',
  name: 'ท่า 1 · RBS/SBR หลาย TF',
  source: 'ริวเรน',
  description:
    'แนวต้าน TF ใหญ่ถูกทะลุกลายเป็นแนวรับ (RBS) → ราคาย่อมาแตะ → TF เล็กขึ้น CHoCH แล้ว BOS → เข้าที่ RBS ของ TF เล็ก · SBR กลับด้าน',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const htf = pickHtf(input.tf, p.str('htf'));
    if (!htf) return [];
    const ctx = makeCtx(input);
    const { candles, n } = ctx;
    const view = htfView(candles, input.tf, htf);
    const mode = p.str('confirmMode');

    const arming = new Map<number, Level[]>();
    for (const e of detectStructure(view.candles, ctx.cfg)) {
      const at = view.availableAt[e.confirmIndex]!;
      if (!Number.isFinite(at)) continue;
      const list = arming.get(at) ?? [];
      list.push({
        dir: e.direction,
        price: e.level,
        invalid: e.originPrice,
        label: `${e.direction === 'bull' ? 'RBS' : 'SBR'} ${htf} ${fmt(e.level)}`,
        away: false,
      });
      arming.set(at, list);
    }

    const out: Signal[] = [];
    let levels: Level[] = [];
    // เส้นที่แตะแล้ว กำลังรอยืนยันใน TF เล็ก
    let watch: { lv: Level; since: number; choch: boolean } | null = null;

    for (let i = 0; i < n; i++) {
      const bar = candles[i]!;
      const a = ctx.atr[i];
      levels = levels.filter((lv) => (lv.dir === 'bull' ? bar.close >= lv.invalid : bar.close <= lv.invalid));

      if (watch) {
        const { lv } = watch;
        const dead = lv.dir === 'bull' ? bar.close < lv.invalid : bar.close > lv.invalid;
        let done = dead || i > watch.since + p.num('waitBars');
        for (const e of ctx.eventsAt(i)) {
          if (done || e.direction !== lv.dir) continue;
          if (e.type === 'CHoCH') watch.choch = true;
          const confirmed = mode === 'choch' ? e.type === 'CHoCH' : e.type === 'BOS' && watch.choch;
          if (!confirmed || a == null) continue;
          const limit = p.str('entryMode') === 'limit';
          const ext = extremeIn(candles, watch.since, i, lv.dir === 'bull' ? 'low' : 'high');
          const buf = p.num('slBufferAtr') * a;
          const entry = limit ? e.level : bar.close;
          const sl = lv.dir === 'bull' ? ext - buf : ext + buf;
          const tp = targetFor(ctx, i, lv.dir, entry, sl, p.str('tpMode'), p.num('rr'));
          const sig =
            tp == null
              ? null
              : finalize(
                  {
                    index: i,
                    dir: lv.dir,
                    entryType: limit ? 'limit' : 'market',
                    entry,
                    sl,
                    tp,
                    expiryBars: p.num('expiryBars'),
                    reason: `${lv.label} แตะแล้ว → ${mode === 'choch' ? 'CHoCH' : 'CHoCH→BOS'} ${input.tf}`,
                  },
                  p.num('minRR'),
                );
          if (sig) out.push(sig);
          done = true;
        }
        if (done) watch = null;
      }

      if (!watch && a != null) {
        const tol = p.num('touchTolAtr') * a;
        const idx = levels.findIndex(
          (lv) => lv.away && (lv.dir === 'bull' ? bar.low <= lv.price + tol : bar.high >= lv.price - tol),
        );
        if (idx >= 0) {
          watch = { lv: levels[idx]!, since: i, choch: false };
          levels.splice(idx, 1);
        }
      }

      if (a != null) {
        const tol = p.num('touchTolAtr') * a;
        for (const lv of levels) if (lv.dir === 'bull' ? bar.low > lv.price + tol : bar.high < lv.price - tol) lv.away = true;
      }
      for (const lv of arming.get(i) ?? []) levels.push({ ...lv });
    }
    return out;
  },
};
