import {
  TIMEFRAME_MS,
  getStrategy,
  isBucketClosed,
  type Candle,
  type Signal,
} from '@zonedee/core';
import type { RunResult } from '../fetch-runner';
import type { CandleStore } from '../store';
import type { SymbolConfig } from '../symbols';
import type { LineNotifier } from './line';
import type { AlertEvent, AlertRule, AlertStore } from './store';

/** แท่งที่ใช้คำนวณต่อรอบ (พอสำหรับท่า 2 TF เช่น M15 → H4 ≈ 375 แท่ง H4) */
const BARS_PER_CHECK = 6000;
/** สัญญาณ/ราคาที่เก่ากว่ากี่แท่งไม่แจ้ง (กันแจ้งรัวตอนเปิด server หลังปิดไปนาน) */
const MAX_LATE_BARS = 3;
/** ส่ง LINE ได้สูงสุดกี่ข้อความต่อวัน (เวลาไทย) — กันโควต้าฟรีหมด */
export const DEFAULT_LINE_PER_DAY = 30;

export interface Fire {
  barTime: number;
  message: string;
  signal: AlertEvent['signal'];
}

const thaiTime = (ms: number) =>
  new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** แท่งที่ปิดแล้วเท่านั้น (ตัดแท่งที่กำลังวิ่งทิ้ง — ห้ามแจ้งจากแท่งที่ยังไม่ปิด) */
export function closedOnly(candles: readonly Candle[], rule: Pick<AlertRule, 'tf'>, now: number): Candle[] {
  let end = candles.length;
  while (end > 0 && !isBucketClosed(candles[end - 1]!.time, rule.tf, now)) end--;
  return candles.slice(0, end);
}

function signalMessage(rule: AlertRule, name: string, s: Signal, barTime: number, digits: number): string {
  const f = (v: number) => v.toFixed(digits);
  const rr = Math.abs(s.tp - s.entry) / Math.abs(s.entry - s.sl);
  const side = `${s.direction === 'long' ? 'BUY' : 'SELL'}${s.entryType === 'limit' ? ' limit' : ''}`;
  return [
    `🔔 ${name}`,
    `${rule.symbol} ${rule.tf} · ${side}`,
    `${s.entryType === 'limit' ? 'รอที่' : 'ราคาตอนนี้'} ${f(s.entry)} · SL ${f(s.sl)} · TP ${f(s.tp)} (1:${rr.toFixed(1)})`,
    s.reason,
    `แท่ง ${thaiTime(barTime)} (เวลาไทย)`,
    '— zonedee แจ้งเตือนเท่านั้น ไม่ได้ส่งออเดอร์',
  ].join('\n');
}

/**
 * ตรวจกฎ 1 ข้อกับแท่งที่ปิดแล้ว — คืนสิ่งที่ต้องแจ้ง + แท่งล่าสุดที่ตรวจแล้ว
 * - ครั้งแรก (lastCheckedBar = null) ไม่แจ้งของเก่า แค่จำจุดเริ่ม
 * - แจ้งเฉพาะแท่งที่ใหม่กว่า lastCheckedBar และไม่เก่าเกิน MAX_LATE_BARS แท่ง
 */
export function evaluateRule(
  rule: AlertRule,
  closed: readonly Candle[],
  digits: number,
): { lastCheckedBar: number | null; fires: Fire[] } {
  const last = closed.at(-1);
  if (!last) return { lastCheckedBar: rule.lastCheckedBar, fires: [] };
  if (rule.lastCheckedBar === null || last.time <= rule.lastCheckedBar) {
    return { lastCheckedBar: Math.max(last.time, rule.lastCheckedBar ?? -Infinity), fires: [] };
  }
  const minTime = Math.max(rule.lastCheckedBar + 1, last.time - (MAX_LATE_BARS - 1) * TIMEFRAME_MS[rule.tf]);
  const fires: Fire[] = [];

  if (rule.kind === 'strategy') {
    const st = getStrategy(rule.strategy);
    if (!st) throw new Error(`ไม่รู้จักท่า ${rule.strategy}`);
    const cfg = {
      ...(rule.swingLength ? { swingLength: rule.swingLength } : {}),
      ...(rule.breakBy ? { breakBy: rule.breakBy } : {}),
    };
    for (const s of st.generate({ candles: closed, tf: rule.tf, cfg, params: rule.params })) {
      const barTime = closed[s.index]!.time;
      if (barTime < minTime) continue;
      fires.push({
        barTime,
        message: signalMessage(rule, st.name, s, barTime, digits),
        signal: { direction: s.direction, entryType: s.entryType, entry: s.entry, sl: s.sl, tp: s.tp, reason: s.reason },
      });
    }
  } else if (rule.price !== null) {
    const p = rule.price;
    for (let i = 1; i < closed.length; i++) {
      const bar = closed[i]!;
      if (bar.time < minTime) continue;
      const prev = closed[i - 1]!.close;
      const hit =
        rule.condition === 'cross-above'
          ? prev <= p && bar.close > p
          : rule.condition === 'cross-below'
            ? prev >= p && bar.close < p
            : bar.low <= p && bar.high >= p;
      if (!hit) continue;
      const what = rule.condition === 'cross-above' ? 'ปิดเหนือ' : rule.condition === 'cross-below' ? 'ปิดใต้' : 'แตะ';
      fires.push({
        barTime: bar.time,
        message: [
          `🔔 ราคา${what} ${p.toFixed(digits)}`,
          `${rule.symbol} ${rule.tf} · ปิด ${bar.close.toFixed(digits)}`,
          rule.name,
          `แท่ง ${thaiTime(bar.time)} (เวลาไทย)`,
        ].join('\n'),
        signal: null,
      });
      if (rule.once) break;
    }
  }
  return { lastCheckedBar: last.time, fires };
}

export interface EngineDeps {
  store: CandleStore;
  alerts: AlertStore;
  line: LineNotifier;
  runFetch: (cfg: SymbolConfig) => Promise<RunResult>;
  findSymbol: (symbol: string) => SymbolConfig | undefined;
  now?: () => number;
  linePerDay?: number;
  log?: (msg: string) => void;
}

export interface EngineStatus {
  running: boolean;
  lastTick: number | null;
  lastTickMs: number | null;
  checked: number;
  fired: number;
  errors: string[];
}

/** ต้องตรวจกฎนี้ไหม: ยังไม่เคยตรวจ หรือมีแท่งใหม่ปิดแล้วหลังจากที่ตรวจล่าสุด */
export const isDue = (rule: AlertRule, now: number) =>
  rule.enabled && (rule.lastCheckedBar === null || now >= rule.lastCheckedBar + 2 * TIMEFRAME_MS[rule.tf]);

/**
 * ตัวตรวจแจ้งเตือนเบื้องหลัง: ทุกรอบดูว่ากฎไหนถึงเวลา → ดึงราคาใหม่ (symbol ละครั้ง) → ตรวจ → แจ้งในแอป + LINE
 */
export function createAlertEngine(deps: EngineDeps) {
  const now = deps.now ?? Date.now;
  const linePerDay = deps.linePerDay ?? DEFAULT_LINE_PER_DAY;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy: Promise<EngineStatus> | null = null;
  const status: EngineStatus = { running: false, lastTick: null, lastTickMs: null, checked: 0, fired: 0, errors: [] };

  const startOfThaiDay = (t: number) => {
    const off = 7 * 3_600_000;
    return Math.floor((t + off) / 86_400_000) * 86_400_000 - off;
  };

  async function notify(rule: AlertRule, fire: Fire): Promise<Pick<AlertEvent, 'line' | 'lineError'>> {
    if (!rule.notifyLine || !deps.line.configured) return { line: 'off', lineError: null };
    if (deps.alerts.lineSentSince(startOfThaiDay(now())) >= linePerDay)
      return { line: 'capped', lineError: `ส่งครบ ${linePerDay} ข้อความวันนี้แล้ว (กันโควต้า LINE หมด)` };
    try {
      await deps.line.push(fire.message);
      return { line: 'sent', lineError: null };
    } catch (err) {
      return { line: 'failed', lineError: (err as Error).message };
    }
  }

  async function runTick(force: boolean): Promise<EngineStatus> {
    const t0 = now();
    const errors: string[] = [];
    let checked = 0;
    let fired = 0;
    const due = deps.alerts.rules().filter((r) => r.enabled && (force || isDue(r, t0)));

    // ดึงราคาใหม่ symbol ละครั้ง
    const fetchErr = new Map<string, string>();
    for (const symbol of new Set(due.map((r) => r.symbol))) {
      const cfg = deps.findSymbol(symbol);
      if (!cfg) {
        fetchErr.set(symbol, `ไม่รู้จัก symbol ${symbol}`);
        continue;
      }
      try {
        const res = await deps.runFetch(cfg);
        if (res.errors.length > 0 && res.total === 0) fetchErr.set(symbol, res.errors.join(' · '));
      } catch (err) {
        fetchErr.set(symbol, (err as Error).message);
      }
    }

    for (const rule of due) {
      const cfg = deps.findSymbol(rule.symbol);
      try {
        const candles = closedOnly(deps.store.latest(rule.symbol, rule.tf, BARS_PER_CHECK), rule, now());
        const { lastCheckedBar, fires } = evaluateRule(rule, candles, cfg?.digits ?? 2);
        checked++;
        for (const fire of fires) {
          const sent = await notify(rule, fire);
          deps.alerts.addEvent({
            ruleId: rule.id,
            ruleName: rule.name,
            symbol: rule.symbol,
            tf: rule.tf,
            barTime: fire.barTime,
            firedAt: now(),
            message: fire.message,
            signal: fire.signal,
            strategy: rule.strategy,
            ...sent,
          });
          fired++;
          deps.log?.(`[alert] ${rule.name}: ${fire.message.split('\n')[1] ?? ''} (LINE: ${sent.line})`);
        }
        const err = fetchErr.get(rule.symbol) ?? null;
        deps.alerts.patchState(rule.id, {
          lastCheckedBar,
          lastFiredAt: fires.length ? now() : rule.lastFiredAt,
          lastError: err ? `ดึงข้อมูลใหม่ไม่ได้ (ใช้ข้อมูลเดิม): ${err}` : null,
          ...(rule.kind === 'price' && rule.once && fires.length ? { enabled: false } : {}),
        });
      } catch (err) {
        const msg = `${rule.name}: ${(err as Error).message}`;
        errors.push(msg);
        deps.alerts.patchState(rule.id, { lastError: (err as Error).message });
      }
    }
    Object.assign(status, { lastTick: t0, lastTickMs: now() - t0, checked, fired, errors });
    return { ...status };
  }

  return {
    /** ตรวจหนึ่งรอบ (force = ตรวจทุกกฎแม้ยังไม่ถึงเวลา) — ถ้ารอบก่อนยังไม่จบจะรอรอบเดิม */
    tick(force = false): Promise<EngineStatus> {
      if (!busy) busy = runTick(force).finally(() => (busy = null));
      return busy;
    },
    start(intervalMs = 30_000) {
      if (timer) return;
      status.running = true;
      timer = setInterval(() => void this.tick().catch((e: Error) => deps.log?.(`[alert] ${e.message}`)), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      status.running = false;
    },
    status: (): EngineStatus => ({ ...status }),
  };
}

export type AlertEngine = ReturnType<typeof createAlertEngine>;
