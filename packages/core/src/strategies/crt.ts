import type { Signal } from '../backtest/types';
import { htfView } from '../mtf';
import type { Candle } from '../types';
import {
  P_ENTRY,
  P_EXPIRY,
  P_HTF,
  P_MIN_RR,
  P_SL_BUFFER,
  extremeIn,
  finalize,
  fmt,
  makeCtx,
  pickHtf,
  resolveParams,
  type Dir,
} from './common';
import type { ParamSpec, StrategyDef } from './types';

export interface CrtSetup {
  /** index ของแท่ง HTF ที่ sweep (แท่งที่ 2) — แท่งกรอบคือ index − 1 */
  index: number;
  /** bear = กวาด CRTH แล้วปิดกลับในกรอบ (ขาย ไปหา CRTL) · bull = กลับด้าน */
  direction: Dir;
  crtHigh: number;
  crtLow: number;
  /** ปลายไส้ที่ sweep (ใช้วาง SL) */
  sweepExtreme: number;
  /** TP = ฝั่งตรงข้ามของกรอบ */
  target: number;
}

/**
 * หา CRT จากแท่ง TF ใหญ่ (ท่า 6 ริวเรน): แท่ง A = กรอบ (CRTH/CRTL)
 * แท่ง B ถัดไป: ไส้ทะลุฝั่งหนึ่งของกรอบ แต่ราคาปิดกลับเข้ามาในกรอบ
 * ทะลุทั้งสองฝั่งในแท่งเดียว = ไม่นับ (ไม่รู้ว่ากวาดฝั่งไหน)
 */
export function findCrtSetups(htf: readonly Candle[]): CrtSetup[] {
  const out: CrtSetup[] = [];
  for (let j = 1; j < htf.length; j++) {
    const a = htf[j - 1]!;
    const b = htf[j]!;
    const inside = b.close < a.high && b.close > a.low;
    const sweptHigh = b.high > a.high;
    const sweptLow = b.low < a.low;
    if (!inside || sweptHigh === sweptLow) continue;
    out.push(
      sweptHigh
        ? { index: j, direction: 'bear', crtHigh: a.high, crtLow: a.low, sweepExtreme: b.high, target: a.low }
        : { index: j, direction: 'bull', crtHigh: a.high, crtLow: a.low, sweepExtreme: b.low, target: a.high },
    );
  }
  return out;
}

const params: ParamSpec[] = [
  { ...P_HTF, help: 'แท่งที่ใช้เป็นกรอบ CRT (ไฟล์ใช้ D1 กับ M15)' },
  {
    key: 'windowHtfBars',
    label: 'รอโครงสร้าง TF เล็กกี่แท่ง TF ใหญ่',
    help: 'หลังแท่ง sweep ปิด ต้องเห็น BOS/MSS ใน TF เล็กภายในเวลานี้',
    type: 'number',
    default: 1,
    min: 1,
    max: 5,
    step: 1,
  },
  { ...P_ENTRY, help: 'limit = รอราคากลับมาทดสอบระดับที่เพิ่งเบรก (CISD/RBS) · market = เข้าทันที' },
  P_EXPIRY,
  P_SL_BUFFER,
  P_MIN_RR,
];

/**
 * ท่า 6 ริวเรน: CRT (docs/rules.md ชั้นที่ 2)
 * แท่ง TF ใหญ่ sweep ฝั่งหนึ่งของแท่งก่อนแล้วปิดกลับในกรอบ → (หลังแท่งนั้นปิด) ลง TF เล็กรอ BOS/MSS ทิศเดียวกัน
 * → เข้าที่ระดับที่ถูกเบรก (limit) หรือทันที · SL เลยปลายไส้ที่ sweep · TP ฝั่งตรงข้ามของกรอบ
 */
export const crt: StrategyDef = {
  id: 'crt',
  name: 'ท่า 6 · CRT',
  source: 'ริวเรน',
  description:
    'แท่ง TF ใหญ่กวาดยอด/ก้นของแท่งก่อนแล้วปิดกลับในกรอบ → ลง TF เล็กรอเบรกโครงสร้างทิศเดียวกัน → เข้า · SL เลยไส้ที่กวาด · TP อีกฝั่งของกรอบ',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const htf = pickHtf(input.tf, p.str('htf'));
    if (!htf) return [];
    const ctx = makeCtx(input);
    const { candles, n } = ctx;
    const view = htfView(candles, input.tf, htf);
    const w = p.num('windowHtfBars');
    const out: Signal[] = [];

    for (const s of findCrtSetups(view.candles)) {
      const start = view.availableAt[s.index]!;
      if (!Number.isFinite(start)) continue;
      const endAt = view.availableAt[s.index + w];
      const end = Math.min(n - 1, endAt === undefined || !Number.isFinite(endAt) ? n - 1 : endAt);
      for (let i = start; i <= end; i++) {
        const e = ctx.eventsAt(i).find((x) => x.direction === s.direction);
        if (!e) continue;
        // ราคาไปถึงเป้าแล้วก่อนได้สัญญาณ → พลาดไปแล้ว
        const reached =
          s.direction === 'bear'
            ? extremeIn(candles, start, i, 'low') <= s.target
            : extremeIn(candles, start, i, 'high') >= s.target;
        const a = ctx.atr[i];
        if (!reached && a != null) {
          const limit = p.str('entryMode') === 'limit';
          const buf = p.num('slBufferAtr') * a;
          const sig = finalize(
            {
              index: i,
              dir: s.direction,
              entryType: limit ? 'limit' : 'market',
              entry: limit ? e.level : candles[i]!.close,
              sl: s.direction === 'bear' ? s.sweepExtreme + buf : s.sweepExtreme - buf,
              tp: s.target,
              expiryBars: p.num('expiryBars'),
              reason: `CRT ${htf} กวาด${s.direction === 'bear' ? 'ยอด' : 'ก้น'} ${fmt(s.sweepExtreme)} → ${e.type} ${input.tf} → เป้า ${fmt(s.target)}`,
            },
            p.num('minRR'),
          );
          if (sig) out.push(sig);
        }
        break; // ใช้โครงสร้างแรกที่เจอเท่านั้น
      }
    }
    return out.sort((x, y) => x.index - y.index);
  },
};
