import type { Signal } from '../backtest/types';
import type { Candle } from '../types';
import {
  P_ENTRY,
  P_EXPIRY,
  P_MIN_RR,
  P_RR,
  P_SL_BUFFER,
  extremeIn,
  finalize,
  fmt,
  makeCtx,
  resolveParams,
  type Dir,
} from './common';
import type { ParamSpec, StrategyDef } from './types';

export interface AmdSetup {
  rangeHigh: number;
  rangeLow: number;
  sweepIndex: number;
  direction: Dir;
  sweepExtreme: number;
}

const params: ParamSpec[] = [
  {
    key: 'mode',
    label: 'ช่วงสะสม (D6)',
    help: 'session = Asian Session (00:00-07:00 UTC) · consolidation = กรอบแคบ N แท่ง',
    type: 'select',
    default: 'session',
    options: [
      { value: 'session', label: 'Asian Session (00:00-07:00 UTC)' },
      { value: 'consolidation', label: 'กรอบแคบ (Rolling Consolidation)' },
    ],
  },
  {
    key: 'asianStartHour',
    label: 'ชั่วโมงเริ่ม Asian (UTC)',
    help: 'เวลาเริ่ม Asian Session (UTC)',
    type: 'number',
    default: 0,
    min: 0,
    max: 23,
    step: 1,
  },
  {
    key: 'asianEndHour',
    label: 'ชั่วโมงจบ Asian (UTC)',
    help: 'เวลาจบ Asian Session (UTC)',
    type: 'number',
    default: 7,
    min: 1,
    max: 23,
    step: 1,
  },
  {
    key: 'manipulationMaxHours',
    label: 'กรอบเวลา Manipulation (ชม.)',
    help: 'หลังจบ Asian รอ Sweep ภายในกี่ชั่วโมง (London Open: 4-6 ชม.)',
    type: 'number',
    default: 6,
    min: 1,
    max: 12,
    step: 1,
  },
  {
    key: 'windowBars',
    label: 'รอ MSS/กลับตัวภายในกี่แท่ง',
    help: 'หลังเกิด sweep ต้องเห็นการกลับตัวภายในกี่แท่ง',
    type: 'number',
    default: 30,
    min: 3,
    max: 100,
    step: 1,
  },
  {
    key: 'consolidationBars',
    label: 'แท่งสะสม (โหมดกรอบแคบ)',
    help: 'ใช้เมื่อเลือกโหมดกรอบแคบ',
    type: 'number',
    default: 20,
    min: 5,
    max: 100,
    step: 1,
  },
  {
    key: 'maxRangeAtr',
    label: 'ความกว้างกรอบสูงสุด (× ATR)',
    help: 'ความกว้างของช่วงสะสมต้องไม่เกินเท่านี้ของ ATR',
    type: 'number',
    default: 4.0,
    min: 0.5,
    max: 15,
    step: 0.5,
  },
  {
    key: 'tpMode',
    label: 'วาง TP',
    type: 'select',
    default: 'opposite_range',
    options: [
      { value: 'opposite_range', label: 'ฝั่งตรงข้ามของกรอบสะสม (Asian High/Low)' },
      { value: 'rr', label: 'เท่าของความเสี่ยง (R:R)' },
    ],
  },
  P_RR,
  P_ENTRY,
  P_EXPIRY,
  P_SL_BUFFER,
  P_MIN_RR,
];

/**
 * ท่า 4 ริวเรน / SMC: AMD (Accumulation, Manipulation, Distribution)
 *
 * 1. Accumulation (สะสมราคา):
 *    - ช่วง Asian Session (00:00 - 07:00 UTC) บันทึก Asian High และ Asian Low
 *    - หรือในโหมด Consolidation: กรอบแคบ N แท่ง (ความกว้าง ≤ maxRangeAtr × ATR)
 * 2. Manipulation (หลอกทะลุ / Judas Swing):
 *    - ช่วงเปิดตลาด London (07:00 - 13:00 UTC) ราคาทำไส้แลบทะลุหลอก (Sweep)
 *    - ฝั่ง Buy: ทำไส้ทะลุใต้ Asian Low (หรือกรอบล่าง) แล้วปิดกลับเข้ามา
 *    - ฝั่ง Sell: ทำไส้ทะลุเหนือ Asian High (หรือกรอบบน) แล้วปิดกลับเข้ามา
 * 3. Distribution (วิ่งจริงสวนทาง):
 *    - เกิดการกลับตัว Market Structure Shift (MSS) หรือ CHoCH / BOS ในทิศทางกลับตัว
 *    - เข้าเทรด: Market ทันทีหลังยืนยัน หรือ Limit ที่ระดับกรอบเดิม
 *    - SL: ปลายไส้สุดที่ทำ Manipulation (Sweep Extreme)
 *    - TP: ฝั่งตรงข้ามของกรอบ (Asian High สำหรับ Buy / Asian Low สำหรับ Sell) หรือตาม R:R
 */
export const amd: StrategyDef = {
  id: 'amd',
  name: 'ท่า 4 · AMD',
  source: 'ริวเรน',
  description:
    'Asian session สะสมราคา (00-07 UTC) → London (07-13 UTC) sweep หลอกทะลุฝั่งหนึ่ง → เกิด MSS กลับตัว → เข้าเทรด SL ปลายไส้ sweep, TP ฝั่งตรงข้ามของกรอบ',
  timeframes: ['M1', 'M5', 'M10', 'M15', 'M30', 'H1'],
  params,
  generate(input) {
    const p = resolveParams(params, input.params);
    const mode = p.str('mode');
    const ctx = makeCtx(input);
    const { candles, n, atr } = ctx;
    if (n < 15) return [];

    const asianStart = p.num('asianStartHour');
    const asianEnd = p.num('asianEndHour');
    const manipHours = p.num('manipulationMaxHours');
    const windowBars = p.num('windowBars');
    const consolBars = p.num('consolidationBars');
    const maxRangeAtr = p.num('maxRangeAtr');
    const entryMode = p.str('entryMode');
    const tpMode = p.str('tpMode');
    const rr = p.num('rr');
    const slBufferAtr = p.num('slBufferAtr');
    const minRR = p.num('minRR');
    const expiryBars = p.num('expiryBars');

    const out: Signal[] = [];

    if (mode === 'session') {
      // ── โหมด Asian Session (00:00 - 07:00 UTC) ───────────────────
      let currentDay = -1;
      let asianHigh = -Infinity;
      let asianLow = Infinity;
      let asianBarCount = 0;
      let asianLocked = false;
      let lockedHigh = 0;
      let lockedLow = 0;
      let lockedDay = -1;

      interface PendingSweep {
        day: number;
        direction: Dir;
        sweepBar: number;
        sweepExtreme: number;
        rangeHigh: number;
        rangeLow: number;
      }

      let pendingSweep: PendingSweep | null = null;
      let lastSignalDay = -1;

      for (let i = 0; i < n; i++) {
        const c = candles[i]!;
        const d = new Date(c.time);
        const hour = d.getUTCHours();
        const dayId = Math.floor(c.time / 86_400_000);

        if (dayId !== currentDay) {
          currentDay = dayId;
          asianHigh = -Infinity;
          asianLow = Infinity;
          asianBarCount = 0;
          asianLocked = false;
          pendingSweep = null;
        }

        // 1. ช่วงสะสม Asian
        if (hour >= asianStart && hour < asianEnd) {
          asianHigh = Math.max(asianHigh, c.high);
          asianLow = Math.min(asianLow, c.low);
          asianBarCount++;
        }

        // 2. ปิดช่วง Asian
        if (!asianLocked && hour >= asianEnd && asianBarCount >= 2) {
          asianLocked = true;
          lockedHigh = asianHigh;
          lockedLow = asianLow;
          lockedDay = dayId;
        }

        // 3. ช่วง Manipulation (หลอกทะลุ / Sweep)
        if (
          asianLocked &&
          lockedDay === dayId &&
          hour >= asianEnd &&
          hour < asianEnd + manipHours &&
          lastSignalDay !== dayId
        ) {
          if (!pendingSweep) {
            const sweptLow = c.low < lockedLow;
            const sweptHigh = c.high > lockedHigh;

            if (sweptLow && !sweptHigh) {
              pendingSweep = {
                day: dayId,
                direction: 'bull',
                sweepBar: i,
                sweepExtreme: c.low,
                rangeHigh: lockedHigh,
                rangeLow: lockedLow,
              };
            } else if (sweptHigh && !sweptLow) {
              pendingSweep = {
                day: dayId,
                direction: 'bear',
                sweepBar: i,
                sweepExtreme: c.high,
                rangeHigh: lockedHigh,
                rangeLow: lockedLow,
              };
            }
          } else {
            // อัปเดตปลายไส้สุดที่ทำ sweep
            if (pendingSweep.direction === 'bull') {
              pendingSweep.sweepExtreme = Math.min(pendingSweep.sweepExtreme, c.low);
            } else {
              pendingSweep.sweepExtreme = Math.max(pendingSweep.sweepExtreme, c.high);
            }
          }
        }

        // 4. ช่วง Distribution (กลับตัว / MSS / CHoCH)
        if (pendingSweep && pendingSweep.day === dayId) {
          const barsSinceSweep = i - pendingSweep.sweepBar;
          if (barsSinceSweep > 0 && barsSinceSweep <= windowBars) {
            const isBull = pendingSweep.direction === 'bull';

            // ยืนยันการกลับตัว:
            // 1. เกิด Event โครงสร้าง CHoCH หรือ BOS ในทิศทางกลับตัว
            const events = ctx.eventsAt(i);
            const hasEvent = events.some(
              (e) => (e.type === 'CHoCH' || e.type === 'BOS') && e.direction === pendingSweep!.direction,
            );

            // 2. ปิดแท่งกลับเข้ามาในกรอบและทะลุ high/low ของแท่งก่อน
            const prev = candles[i - 1]!;
            const candleReversal = isBull
              ? c.close > prev.high && c.close > pendingSweep.rangeLow
              : c.close < prev.low && c.close < pendingSweep.rangeHigh;

            if (hasEvent || candleReversal) {
              const currentAtr = atr[i] ?? Math.abs(c.high - c.low);
              const buffer = slBufferAtr * currentAtr;

              const sl = isBull
                ? pendingSweep.sweepExtreme - buffer
                : pendingSweep.sweepExtreme + buffer;

              const entryPrice =
                entryMode === 'limit'
                  ? isBull
                    ? Math.min(c.close, pendingSweep.rangeLow + buffer)
                    : Math.max(c.close, pendingSweep.rangeHigh - buffer)
                  : c.close;

              let tpPrice: number;
              if (tpMode === 'opposite_range') {
                tpPrice = isBull ? pendingSweep.rangeHigh : pendingSweep.rangeLow;
                const currentRR = Math.abs(tpPrice - entryPrice) / Math.max(1e-6, Math.abs(entryPrice - sl));
                if (currentRR < minRR) {
                  tpPrice = isBull
                    ? entryPrice + (minRR + 1e-4) * Math.abs(entryPrice - sl)
                    : entryPrice - (minRR + 1e-4) * Math.abs(sl - entryPrice);
                }
              } else {
                tpPrice = isBull
                  ? entryPrice + rr * Math.abs(entryPrice - sl)
                  : entryPrice - rr * Math.abs(sl - entryPrice);
              }

              const sig = finalize(
                {
                  index: i,
                  dir: isBull ? 'bull' : 'bear',
                  entryType: entryMode as 'market' | 'limit',
                  entry: entryPrice,
                  sl,
                  tp: tpPrice,
                  expiryBars,
                  reason: `ท่า 4 AMD: Asian Range [${fmt(pendingSweep.rangeLow)}–${fmt(pendingSweep.rangeHigh)}] → Sweep ${isBull ? 'Low' : 'High'} [${fmt(pendingSweep.sweepExtreme)}] → Distribution MSS ${isBull ? 'ขึ้น' : 'ลง'}`,
                },
                minRR,
              );

              if (sig) {
                out.push(sig);
                lastSignalDay = dayId;
                pendingSweep = null;
              }
            }
          } else if (barsSinceSweep > windowBars) {
            pendingSweep = null;
          }
        }
      }
    } else {
      // ── โหมด Consolidation (กรอบแคบ N แท่ง) ───────────────────────
      let activeRange: { high: number; low: number; atBar: number } | null = null;
      let pendingSweep: {
        direction: Dir;
        sweepBar: number;
        sweepExtreme: number;
        rangeHigh: number;
        rangeLow: number;
      } | null = null;
      let lastSignalIndex = -999;

      for (let i = consolBars; i < n; i++) {
        const c = candles[i]!;
        const currentAtr = atr[i] ?? Math.abs(c.high - c.low);

        // 1. ตรวจสอบการสะสมราคาในกรอบแคบ
        if (!activeRange || i - activeRange.atBar > consolBars * 2) {
          const highMax = extremeIn(candles, i - consolBars, i - 1, 'high');
          const lowMin = extremeIn(candles, i - consolBars, i - 1, 'low');
          const rangeWidth = highMax - lowMin;

          if (rangeWidth <= maxRangeAtr * currentAtr) {
            activeRange = { high: highMax, low: lowMin, atBar: i };
          }
        }

        // 2. ตรวจสอบ Sweep
        if (activeRange && !pendingSweep && i - lastSignalIndex > windowBars) {
          const sweptLow = c.low < activeRange.low;
          const sweptHigh = c.high > activeRange.high;

          if (sweptLow && !sweptHigh) {
            pendingSweep = {
              direction: 'bull',
              sweepBar: i,
              sweepExtreme: c.low,
              rangeHigh: activeRange.high,
              rangeLow: activeRange.low,
            };
          } else if (sweptHigh && !sweptLow) {
            pendingSweep = {
              direction: 'bear',
              sweepBar: i,
              sweepExtreme: c.high,
              rangeHigh: activeRange.high,
              rangeLow: activeRange.low,
            };
          }
        } else if (pendingSweep) {
          if (pendingSweep.direction === 'bull') {
            pendingSweep.sweepExtreme = Math.min(pendingSweep.sweepExtreme, c.low);
          } else {
            pendingSweep.sweepExtreme = Math.max(pendingSweep.sweepExtreme, c.high);
          }
        }

        // 3. ตรวจสอบ Distribution (ยืนยันกลับตัว)
        if (pendingSweep) {
          const barsSinceSweep = i - pendingSweep.sweepBar;
          if (barsSinceSweep > 0 && barsSinceSweep <= windowBars) {
            const isBull = pendingSweep.direction === 'bull';
            const events = ctx.eventsAt(i);
            const hasEvent = events.some(
              (e) => (e.type === 'CHoCH' || e.type === 'BOS') && e.direction === pendingSweep!.direction,
            );

            const prev = candles[i - 1]!;
            const candleReversal = isBull
              ? c.close > prev.high && c.close > pendingSweep.rangeLow
              : c.close < prev.low && c.close < pendingSweep.rangeHigh;

            if (hasEvent || candleReversal) {
              const buffer = slBufferAtr * currentAtr;
              const sl = isBull
                ? pendingSweep.sweepExtreme - buffer
                : pendingSweep.sweepExtreme + buffer;

              const entryPrice =
                entryMode === 'limit'
                  ? isBull
                    ? Math.min(c.close, pendingSweep.rangeLow + buffer)
                    : Math.max(c.close, pendingSweep.rangeHigh - buffer)
                  : c.close;

              let tpPrice: number;
              if (tpMode === 'opposite_range') {
                tpPrice = isBull ? pendingSweep.rangeHigh : pendingSweep.rangeLow;
                const currentRR = Math.abs(tpPrice - entryPrice) / Math.max(1e-6, Math.abs(entryPrice - sl));
                if (currentRR < minRR) {
                  tpPrice = isBull
                    ? entryPrice + (minRR + 1e-4) * Math.abs(entryPrice - sl)
                    : entryPrice - (minRR + 1e-4) * Math.abs(sl - entryPrice);
                }
              } else {
                tpPrice = isBull
                  ? entryPrice + rr * Math.abs(entryPrice - sl)
                  : entryPrice - rr * Math.abs(sl - entryPrice);
              }

              const sig = finalize(
                {
                  index: i,
                  dir: isBull ? 'bull' : 'bear',
                  entryType: entryMode as 'market' | 'limit',
                  entry: entryPrice,
                  sl,
                  tp: tpPrice,
                  expiryBars,
                  reason: `ท่า 4 AMD (Consolidation): กรอบ [${fmt(pendingSweep.rangeLow)}–${fmt(pendingSweep.rangeHigh)}] → Sweep ${isBull ? 'Low' : 'High'} [${fmt(pendingSweep.sweepExtreme)}] → Distribution`,
                },
                minRR,
              );

              if (sig) {
                out.push(sig);
                lastSignalIndex = i;
                pendingSweep = null;
                activeRange = null;
              }
            }
          } else if (barsSinceSweep > windowBars) {
            pendingSweep = null;
          }
        }
      }
    }

    return out;
  },
};
