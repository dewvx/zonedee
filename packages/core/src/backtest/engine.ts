import { TIMEFRAME_MS, type Candle } from '../types';
import { calcSwapCost } from '../risk/swap';
import type { BacktestOptions, ExitReason, Signal, Trade } from './types';

const DEFAULT_EXPIRY = 50;

/**
 * จำลองการเทรดจากสัญญาณ (docs/rules.md: Backtest)
 * - ราคาในข้อมูล = bid · ซื้อที่ ask (= bid + spread) · short ปิดที่ ask
 * - market: เข้าที่ราคาเปิดแท่งถัดจากสัญญาณ · limit: รอราคาย่อมาถึงภายใน expiryBars แท่ง
 *   (ราคาไปถึง TP ก่อนได้เข้า = ยกเลิก)
 * - แท่งเดียวโดนทั้ง SL และ TP: ดูข้อมูล M1 (ถ้ามี) ว่าอันไหนโดนก่อน ไม่งั้นนับเป็น SL (D10)
 * - ราคาเปิดกระโดดข้าม SL/TP → ออกที่ราคาเปิด
 * - ถือได้ทีละสถานะ — สัญญาณที่มาระหว่างถือ "หรือระหว่าง limit ยังรออยู่" ถูกข้าม
 *   (limit ที่ไม่ถูกจับจองช่องไว้จนถึงแท่งที่ยกเลิก/หมดอายุ — ห้ามย้อนกลับไปรับสัญญาณที่มาระหว่างนั้น
 *    เพราะตอนนั้นยังไม่มีทางรู้ว่า limit จะไม่ถูกจับ = แอบดูอนาคต)
 */
export function simulate(
  candles: readonly Candle[],
  signals: readonly Signal[],
  opts: BacktestOptions,
): { trades: Trade[]; skipped: number } {
  const trades: Trade[] = [];
  let skipped = 0;
  let busyUntil = -1; // สัญญาณที่ index < busyUntil ถูกข้าม (ยังถือสถานะอยู่)
  for (const s of [...signals].sort((a, b) => a.index - b.index)) {
    if (s.index < busyUntil) {
      skipped++;
      continue;
    }
    const { trade, endIndex } = simulateOrder(candles, s, opts);
    busyUntil = endIndex;
    if (!trade) {
      skipped++;
      continue;
    }
    trades.push(trade);
  }
  return { trades, skipped };
}

/** จำลองสัญญาณเดียว (ไม่สนว่ามีสถานะอื่นค้างอยู่) — null = ไม่ได้เข้า */
export function simulateSignal(candles: readonly Candle[], s: Signal, opts: BacktestOptions): Trade | null {
  return simulateOrder(candles, s, opts).trade;
}

/**
 * จำลองออเดอร์เดียว — endIndex = แท่งที่ออเดอร์จบ (ปิดสถานะ / limit ยกเลิก / หมดอายุ)
 * ใช้บอกว่าช่องว่างให้รับสัญญาณใหม่ได้ตั้งแต่เมื่อไร
 */
export function simulateOrder(
  candles: readonly Candle[],
  s: Signal,
  opts: BacktestOptions,
): { trade: Trade | null; endIndex: number } {
  const spread = opts.spread ?? 0;
  const maxBars = opts.maxBarsInTrade ?? 0;
  const tfMs = TIMEFRAME_MS[opts.tf];
  const n = candles.length;
  const start = s.index + 1;
  if (start >= n) return { trade: null, endIndex: s.index };
  const isLong = s.direction === 'long';

  // ── เข้าออเดอร์ ──────────────────────────────────────────
  let entryIndex = -1;
  let entry = NaN;
  let endIndex = start;
  if (s.entryType === 'market') {
    const bar = candles[start]!;
    entryIndex = start;
    entry = isLong ? bar.open + spread : bar.open;
  } else {
    const last = Math.min(n - 1, start + (s.expiryBars ?? DEFAULT_EXPIRY) - 1);
    endIndex = last;
    for (let k = start; k <= last; k++) {
      const bar = candles[k]!;
      const filled = isLong ? bar.low + spread <= s.entry : bar.high >= s.entry;
      if (filled) {
        entryIndex = k;
        entry = isLong ? Math.min(s.entry, bar.open + spread) : Math.max(s.entry, bar.open);
        break;
      }
      const ranAway = isLong ? bar.high >= s.tp : bar.low + spread <= s.tp;
      if (ranAway) {
        endIndex = k;
        break;
      }
    }
  }
  // ไม่ได้เข้า หรือราคาเข้าอยู่ผิดฝั่ง SL/TP แล้ว (gap) → ข้าม
  if (entryIndex < 0) return { trade: null, endIndex };
  if (isLong ? !(s.sl < entry && entry < s.tp) : !(s.tp < entry && entry < s.sl)) {
    return { trade: null, endIndex: entryIndex };
  }

  // ── หาจุดออก ─────────────────────────────────────────────
  let exitIndex = n - 1;
  let exit = NaN;
  let exitReason: ExitReason = 'eod';
  for (let k = entryIndex; k < n; k++) {
    const bar = candles[k]!;
    // short ปิดด้วยการซื้อที่ ask → เทียบราคา ask
    const lo = isLong ? bar.low : bar.low + spread;
    const hi = isLong ? bar.high : bar.high + spread;
    const op = isLong ? bar.open : bar.open + spread;

    // ราคาเปิดกระโดดข้าม SL/TP → ออกที่ราคาเปิด (แท่งที่เข้าไม่นับ — เข้าที่ราคาเปิดหรือระหว่างแท่งแล้ว)
    if (k > entryIndex) {
      const gapSl = isLong ? op <= s.sl : op >= s.sl;
      const gapTp = isLong ? op >= s.tp : op <= s.tp;
      if (gapSl || gapTp) {
        exitIndex = k;
        exit = op;
        exitReason = gapSl ? 'sl' : 'tp';
        break;
      }
    }

    const slHit = isLong ? lo <= s.sl : hi >= s.sl;
    // แท่งที่ limit ถูกจับ: ไม่รู้ว่าราคาไปถึง TP ก่อนหรือหลังได้เข้า → ไม่นับ TP (มองแง่ร้าย)
    const tpHit = (k > entryIndex || s.entryType === 'market') && (isLong ? hi >= s.tp : lo <= s.tp);
    if (slHit || tpHit) {
      let reason: 'sl' | 'tp' = slHit ? 'sl' : 'tp';
      if (slHit && tpHit) reason = resolveIntrabar(opts, bar.time, tfMs, isLong, s.sl, s.tp, spread);
      exitIndex = k;
      exit = reason === 'sl' ? s.sl : s.tp;
      exitReason = reason;
      break;
    }
    if (maxBars > 0 && k - entryIndex + 1 >= maxBars) {
      exitIndex = k;
      exit = isLong ? bar.close : bar.close + spread;
      exitReason = 'time';
      break;
    }
  }
  if (exitReason === 'eod') {
    const bar = candles[n - 1]!;
    exit = isLong ? bar.close : bar.close + spread;
  }

  const risk = Math.abs(entry - s.sl);
  const grossR = risk > 0 ? (isLong ? exit - entry : entry - exit) / risk : 0;
  let r = grossR;
  let holdingNights: number | undefined;
  let effectiveNights: number | undefined;
  let swapR: number | undefined;
  let swapPoints: number | undefined;

  const entryTime = candles[entryIndex]!.time;
  const exitTime = candles[exitIndex]!.time;

  if (opts.swap && opts.swap.swapMode !== 'disabled') {
    const swapRes = calcSwapCost({
      direction: s.direction,
      lots: 1,
      entryTime,
      exitTime,
      swapLong: opts.swap.swapLong,
      swapShort: opts.swap.swapShort,
      swapMode: opts.swap.swapMode,
      swap3Day: opts.swap.swap3Day,
      digits: opts.swap.digits,
      point: opts.swap.point,
      tickSize: opts.swap.tickSize,
      tickValue: opts.swap.tickValue,
      rolloverHourUtc: opts.swap.rolloverHourUtc,
      price: entry,
    });

    holdingNights = swapRes.nights;
    effectiveNights = swapRes.effectiveNights;
    swapPoints = swapRes.costInPoints;

    const point = opts.swap.point ?? (opts.swap.digits !== undefined ? 10 ** -opts.swap.digits : 0.01);
    const swapPriceDiff = swapRes.costInPoints * point;
    swapR = risk > 0 ? swapPriceDiff / risk : 0;
    r = grossR + swapR;
  }

  const trade: Trade = {
    signalIndex: s.index,
    entryIndex,
    exitIndex,
    entryTime,
    exitTime,
    direction: s.direction,
    entry,
    sl: s.sl,
    tp: s.tp,
    exit,
    exitReason,
    r,
    grossR,
    holdingNights,
    effectiveNights,
    swapR,
    swapPoints,
    barsHeld: exitIndex - entryIndex + 1,
    reason: s.reason,
  };
  return { trade, endIndex: exitIndex };
}

/** แท่งที่โดนทั้ง SL และ TP: ไล่แท่ง M1 ในช่วงนั้นว่าอันไหนโดนก่อน (ไม่รู้/โดนพร้อมกัน = SL) */
function resolveIntrabar(
  opts: BacktestOptions,
  barTime: number,
  tfMs: number,
  isLong: boolean,
  sl: number,
  tp: number,
  spread: number,
): 'sl' | 'tp' {
  const fine = opts.fine?.candles;
  if (!fine || fine.length === 0) return 'sl';
  let lo = 0;
  let hi = fine.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fine[mid]!.time < barTime) lo = mid + 1;
    else hi = mid;
  }
  for (let k = lo; k < fine.length && fine[k]!.time < barTime + tfMs; k++) {
    const f = fine[k]!;
    const fl = isLong ? f.low : f.low + spread;
    const fh = isLong ? f.high : f.high + spread;
    const slHit = isLong ? fl <= sl : fh >= sl;
    const tpHit = isLong ? fh >= tp : fl <= tp;
    if (slHit) return 'sl';
    if (tpHit) return 'tp';
  }
  return 'sl';
}
