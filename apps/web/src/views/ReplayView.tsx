import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeriesMarker, Time } from 'lightweight-charts';
import {
  DEFAULTS,
  TIMEFRAME_MS,
  atr,
  computeZones,
  createRng,
  simulateSignal,
  type Candle,
  type Timeframe,
  type Trade,
} from '@zonedee/core';
import { fetchCandles, fetchCandlesAfter, fetchStrategies, fetchSymbols, runBacktest, type StrategyInfo, type SymbolSummary } from '../api';
import { CandleChart, type ChartPriceLine } from '../components/CandleChart';
import { inputCls } from '../components/ParamForm';
import { toChartTime } from '../chartTime';
import { fmtPct, fmtR, formatThaiTime } from '../format';
import { DEFAULT_LAYERS, buildOverlays } from '../overlays';

const HISTORY_BARS = 300;
const FUTURE_BARS = 200;
/** SL เริ่มต้นห่างกี่ ATR · TP เริ่มต้นกี่ R (ลากปรับได้) */
const DEFAULT_SL_ATR = 1.5;
const DEFAULT_RR = 2;

interface ReplaySettings {
  symbol: string;
  tf: Timeframe;
  /** 'random' = สุ่มจุดทั่วไป · id ท่า = สุ่มจากจุดที่ท่านั้นเกิดสัญญาณ */
  source: string;
  showStructure: boolean;
}

interface LogEntry {
  at: number;
  symbol: string;
  tf: Timeframe;
  time: number;
  guess: 'long' | 'short' | 'skip';
  r: number | null;
  strategy?: string;
  strategyR?: number | null;
}

interface Stored {
  settings: ReplaySettings;
  log: LogEntry[];
}

const KEY = 'zonedee:replay';
const DEFAULT_STORED: Stored = {
  settings: { symbol: 'XAUUSD', tf: 'M15', source: 'random', showStructure: true },
  log: [],
};

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STORED;
    const s = JSON.parse(raw) as Partial<Stored>;
    return {
      settings: { ...DEFAULT_STORED.settings, ...s.settings },
      log: Array.isArray(s.log) ? s.log.slice(-500) : [],
    };
  } catch {
    return DEFAULT_STORED;
  }
}

interface Round {
  key: string;
  candles: Candle[];
  /** index ของแท่งแรกที่ซ่อน */
  cut: number;
  strategyTrade?: Trade;
  strategyName?: string;
}

interface Plan {
  dir: 'long' | 'short';
  entry: number;
  sl: number;
  tp: number;
}

type Phase = 'idle' | 'loading' | 'guess' | 'placed' | 'reveal' | 'done';

export default function ReplayView() {
  const [stored, setStored] = useState<Stored>(load);
  const { settings, log } = stored;
  const updateSettings = (patch: Partial<ReplaySettings>) =>
    setStored((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(stored));
    } catch {
      /* ไม่เป็นไร */
    }
  }, [stored]);

  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  useEffect(() => {
    void fetchSymbols().then(setSymbols).catch(() => undefined);
    void fetchStrategies().then(setStrategies).catch(() => undefined);
  }, []);
  const info = symbols.find((s) => s.symbol === settings.symbol);
  const digits = info?.digits ?? 2;

  const [round, setRound] = useState<Round | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Trade | null>(null);
  const [error, setError] = useState<string | null>(null);
  // จุดสัญญาณของท่า (cache ต่อ symbol/tf/ท่า)
  const signalCache = useRef(new Map<string, { trades: Trade[]; name: string }>());
  const rng = useRef(createRng(Date.now() >>> 0));

  const newRound = useCallback(async () => {
    const { symbol, tf, source } = settings;
    const cov = info?.coverage[tf];
    if (!cov) {
      setError(`ยังไม่มีข้อมูล ${symbol} ${tf} — ไปหน้ากราฟแล้วกด ⟳ อัปเดตก่อน`);
      return;
    }
    setPhase('loading');
    setError(null);
    setPlan(null);
    setResult(null);
    setRevealed(0);
    try {
      const tfMs = TIMEFRAME_MS[tf];
      let start: number;
      let strategyTrade: Trade | undefined;
      let strategyName: string | undefined;
      if (source === 'random') {
        const lo = cov.first + HISTORY_BARS * tfMs * 1.5;
        const hi = cov.last - FUTURE_BARS * tfMs * 1.5;
        if (hi <= lo) throw new Error(`ข้อมูล ${tf} สั้นเกินไปสำหรับ replay (ต้องมีอย่างน้อย ~${Math.ceil((HISTORY_BARS + FUTURE_BARS) * 1.5)} แท่ง)`);
        start = lo + rng.current() * (hi - lo);
      } else {
        const ck = `${symbol}:${tf}:${source}`;
        let cached = signalCache.current.get(ck);
        if (!cached) {
          const res = await runBacktest({ symbol, tf, strategy: source, baselineRuns: 0, oosFraction: 0 });
          cached = { trades: res.result.trades.filter((t) => t.entryTime - cov.first > HISTORY_BARS * tfMs), name: res.meta.strategyName };
          signalCache.current.set(ck, cached);
        }
        if (cached.trades.length === 0) throw new Error('ท่านี้ไม่มีสัญญาณในข้อมูลที่มี — ลองท่าอื่นหรือ TF อื่น');
        strategyTrade = cached.trades[Math.floor(rng.current() * cached.trades.length)]!;
        strategyName = cached.name;
        start = strategyTrade.entryTime; // แท่งที่ท่าเข้า = แท่งแรกที่ซ่อน
      }
      const [hist, fut] = await Promise.all([
        fetchCandles(symbol, tf, HISTORY_BARS, start),
        fetchCandlesAfter(symbol, tf, start, FUTURE_BARS),
      ]);
      if (hist.candles.length < 50 || fut.candles.length < 10) throw new Error('ข้อมูลช่วงนี้ไม่พอ ลองใหม่อีกครั้ง');
      setRound({
        key: `${symbol}:${tf}:${start}`,
        candles: [...hist.candles, ...fut.candles],
        cut: hist.candles.length,
        strategyTrade,
        strategyName,
      });
      setPhase('guess');
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }, [settings, info]);

  const visible = useMemo(() => (round ? round.candles.slice(0, round.cut + revealed) : []), [round, revealed]);
  const lastVisible = round ? round.candles[round.cut - 1] : undefined;

  // โซน + โครงสร้าง คำนวณจากแท่งที่เห็นตอนทายเท่านั้น (ห้ามรู้อนาคต)
  const guessCandles = useMemo(() => (round ? round.candles.slice(0, round.cut) : []), [round]);
  const visuals = useMemo(() => {
    if (!settings.showStructure || guessCandles.length === 0) return null;
    const zones = computeZones(guessCandles, { swingLength: DEFAULTS.swingLength });
    return buildOverlays({
      candles: guessCandles,
      tf: settings.tf,
      swingLength: DEFAULTS.swingLength,
      zones,
      swings: [],
      layers: { ...DEFAULT_LAYERS, boHtf: false },
    });
  }, [guessCandles, settings.showStructure, settings.tf]);

  const choose = (dir: 'long' | 'short') => {
    if (!round || !lastVisible) return;
    const a = atr(guessCandles, DEFAULTS.atrPeriod).at(-1) ?? (lastVisible.high - lastVisible.low);
    const entry = lastVisible.close;
    const risk = DEFAULT_SL_ATR * a;
    const round2 = (p: number) => Number(p.toFixed(digits));
    setPlan({
      dir,
      entry,
      sl: round2(dir === 'long' ? entry - risk : entry + risk),
      tp: round2(dir === 'long' ? entry + DEFAULT_RR * risk : entry - DEFAULT_RR * risk),
    });
    setPhase('placed');
  };

  const record = (entry: Omit<LogEntry, 'at' | 'symbol' | 'tf'>) =>
    setStored((s) => ({
      ...s,
      log: [...s.log, { at: Date.now(), symbol: settings.symbol, tf: settings.tf, ...entry }].slice(-500),
    }));

  const reveal = (skip: boolean) => {
    if (!round) return;
    let target = 60;
    let trade: Trade | null = null;
    if (!skip && plan) {
      trade = simulateSignal(
        round.candles,
        { index: round.cut - 1, direction: plan.dir, entryType: 'market', entry: plan.entry, sl: plan.sl, tp: plan.tp, reason: 'replay' },
        { tf: settings.tf },
      );
      if (trade) target = trade.exitIndex - round.cut + 15;
    }
    const st = round.strategyTrade;
    if (st) {
      // เฉลยให้ถึงจุดที่ท่าปิดด้วย (index ของ backtest คนละชุดกับแท่งใน replay → หาด้วยเวลา)
      const k = round.candles.findIndex((c) => c.time >= st.exitTime);
      target = Math.max(target, (k < 0 ? round.candles.length : k) - round.cut + 15);
    }
    setResult(trade);
    record({
      time: lastVisible?.time ?? 0,
      guess: skip ? 'skip' : (plan?.dir ?? 'skip'),
      r: trade ? trade.r : null,
      strategy: round.strategyName,
      strategyR: st ? st.r : undefined,
    });
    setPhase('reveal');
    const max = round.candles.length - round.cut;
    const goal = Math.min(max, Math.max(10, target));
    const step = Math.max(1, Math.round(goal / 80));
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(goal, n + step);
      setRevealed(n);
      if (n >= goal) {
        clearInterval(id);
        setPhase('done');
      }
    }, 25);
  };

  // ปุ่มลัด: → แท่งถัดไป · B ซื้อ · S ขาย · Enter เฉลย · N ข้อต่อไป
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (phase === 'guess' && k === 'arrowright' && round && round.cut < round.candles.length - 20)
        setRound({ ...round, cut: round.cut + 1 });
      else if (phase === 'guess' && k === 'b') choose('long');
      else if (phase === 'guess' && k === 's') choose('short');
      else if (phase === 'placed' && k === 'enter') reveal(false);
      else if (phase === 'placed' && k === 'escape') {
        setPlan(null);
        setPhase('guess');
      } else if ((phase === 'done' || phase === 'idle') && k === 'n') void newRound();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const priceLines = useMemo<ChartPriceLine[]>(() => {
    const lines: ChartPriceLine[] = [];
    const f = (v: number) => v.toFixed(digits);
    if (plan) {
      const risk = Math.abs(plan.entry - plan.sl);
      const rr = risk > 0 ? Math.abs(plan.tp - plan.entry) / risk : 0;
      const drag = phase === 'placed';
      lines.push({ id: 'entry', price: plan.entry, color: '#cbd5e1', title: `${plan.dir === 'long' ? 'BUY' : 'SELL'} ${f(plan.entry)}` });
      lines.push({ id: 'sl', price: plan.sl, color: '#ef4444', title: `SL ${f(plan.sl)}`, draggable: drag });
      lines.push({ id: 'tp', price: plan.tp, color: '#22c55e', title: `TP ${f(plan.tp)} · 1:${rr.toFixed(2)}`, draggable: drag });
    }
    const st = round?.strategyTrade;
    if (st && phase === 'done') {
      lines.push({ id: 'st-sl', price: st.sl, color: '#f97316', title: `ท่า SL`, dashed: true });
      lines.push({ id: 'st-tp', price: st.tp, color: '#a3e635', title: `ท่า TP`, dashed: true });
    }
    return lines;
  }, [plan, phase, digits, round]);

  const onLineDrag = useCallback(
    (id: string, price: number) => {
      if (phase !== 'placed') return;
      setPlan((p) => {
        if (!p) return p;
        const v = Number(price.toFixed(digits));
        if (id === 'sl' && (p.dir === 'long' ? v < p.entry : v > p.entry)) return { ...p, sl: v };
        if (id === 'tp' && (p.dir === 'long' ? v > p.entry : v < p.entry)) return { ...p, tp: v };
        return p;
      });
    },
    [phase, digits],
  );

  const markers = useMemo<SeriesMarker<Time>[]>(() => {
    const out: SeriesMarker<Time>[] = [...(visuals?.markers ?? [])];
    if (round && lastVisible) {
      const startBar = round.candles[round.cut];
      if (startBar && revealed > 0)
        out.push({ time: toChartTime(startBar.time), position: 'aboveBar', shape: 'square', color: '#94a3b8', text: 'เริ่มเฉลย' });
      if (result && result.exitIndex < round.cut + revealed) {
        const ex = round.candles[result.exitIndex]!;
        out.push({
          time: toChartTime(ex.time),
          position: result.direction === 'long' ? 'aboveBar' : 'belowBar',
          shape: 'circle',
          color: result.r >= 0 ? '#22c55e' : '#ef4444',
          text: fmtR(result.r),
        });
      }
    }
    return out.sort((a, b) => (a.time as number) - (b.time as number));
  }, [visuals, round, lastVisible, revealed, result]);

  const focus = round ? { from: Math.max(0, round.cut - 140), to: round.cut + 50 } : undefined;

  // คะแนน
  const score = useMemo(() => {
    const trades = log.filter((l) => l.guess !== 'skip' && l.r !== null);
    const wins = trades.filter((l) => (l.r ?? 0) > 0).length;
    const total = trades.reduce((a, l) => a + (l.r ?? 0), 0);
    return { rounds: log.length, trades: trades.length, wins, total, avg: trades.length ? total / trades.length : 0 };
  }, [log]);

  const st = round?.strategyTrade;
  const showFuture = phase === 'reveal' || phase === 'done';

  return (
    <div className="flex h-full min-w-0">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-panel p-3 text-xs">
        <h2 className="text-sm font-semibold text-white">Replay — ฝึกทาย</h2>
        <p className="mt-1 leading-relaxed text-slate-400">
          ซ่อนแท่งอนาคตไว้ ดูกราฟแล้วตัดสินใจ BUY / SELL / ไม่เทรด แล้วเฉลยว่าราคาไปทางไหน — แทน "ดูกราฟเปล่าจนจำได้" ในไฟล์
        </p>

        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">Symbol</span>
            <select value={settings.symbol} onChange={(e) => updateSettings({ symbol: e.target.value })} className={inputCls}>
              {symbols.map((s) => (
                <option key={s.symbol} value={s.symbol} disabled={!s.data}>
                  {s.symbol}
                  {s.data ? '' : ' (ยังไม่มีข้อมูล)'}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">TF</span>
            <select value={settings.tf} onChange={(e) => updateSettings({ tf: e.target.value as Timeframe })} className={inputCls}>
              {(info?.timeframes ?? [settings.tf]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">สุ่มจุดแบบไหน</span>
            <select value={settings.source} onChange={(e) => updateSettings({ source: e.target.value })} className={inputCls}>
              <option value="random">สุ่มทั่วไป</option>
              {strategies
                .filter((s) => s.timeframes.includes(settings.tf))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    จุดที่ {s.name} เกิดสัญญาณ
                  </option>
                ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-slate-300">
            <input type="checkbox" checked={settings.showStructure} onChange={(e) => updateSettings({ showStructure: e.target.checked })} className="accent-blue-500" />
            แสดงโซน + โครงสร้าง (คิดจากแท่งที่เห็นเท่านั้น)
          </label>
        </div>

        <button
          onClick={() => void newRound()}
          disabled={phase === 'loading' || phase === 'reveal'}
          className="mt-3 w-full rounded-md bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {phase === 'loading' ? 'กำลังสุ่ม…' : round ? 'ข้อต่อไป (N)' : 'เริ่ม'}
        </button>
        {error && <p className="mt-2 text-red-300">{error}</p>}

        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-1 flex items-center text-[11px] font-medium text-slate-300">
            คะแนนสะสม
            {log.length > 0 && (
              <button onClick={() => setStored((s) => ({ ...s, log: [] }))} className="ml-auto text-[10px] font-normal text-slate-500 underline hover:text-slate-300">
                ล้าง
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-line bg-surface px-2 py-1">
              <div className="text-[10px] text-slate-500">ทาย / เทรด</div>
              <div className="font-mono text-white">
                {score.rounds} / {score.trades}
              </div>
            </div>
            <div className="rounded border border-line bg-surface px-2 py-1">
              <div className="text-[10px] text-slate-500">ชนะ</div>
              <div className="font-mono text-white">{score.trades ? fmtPct(score.wins / score.trades) : '-'}</div>
            </div>
            <div className="rounded border border-line bg-surface px-2 py-1">
              <div className="text-[10px] text-slate-500">รวม</div>
              <div className={`font-mono ${score.total >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtR(score.total, 1)}</div>
            </div>
            <div className="rounded border border-line bg-surface px-2 py-1">
              <div className="text-[10px] text-slate-500">เฉลี่ย/ไม้</div>
              <div className={`font-mono ${score.avg >= 0 ? 'text-bull' : 'text-bear'}`}>{score.trades ? fmtR(score.avg) : '-'}</div>
            </div>
          </div>
          <ul className="mt-2 space-y-0.5">
            {log
              .slice(-12)
              .reverse()
              .map((l) => (
                <li key={l.at} className="flex gap-2 font-mono text-[10px] text-slate-400">
                  <span>{l.symbol}</span>
                  <span>{l.tf}</span>
                  <span className={l.guess === 'long' ? 'text-bull' : l.guess === 'short' ? 'text-bear' : ''}>
                    {l.guess === 'long' ? 'BUY' : l.guess === 'short' ? 'SELL' : 'ข้าม'}
                  </span>
                  <span className={`ml-auto ${(l.r ?? 0) > 0 ? 'text-bull' : (l.r ?? 0) < 0 ? 'text-bear' : ''}`}>{l.r === null ? '-' : fmtR(l.r)}</span>
                </li>
              ))}
          </ul>
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
          ปุ่มลัด: → แท่งถัดไป · B ซื้อ · S ขาย · Enter เฉลย · Esc ยกเลิก · N ข้อต่อไป · ลากเส้น SL/TP ได้ · ไม่คิด spread
        </p>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2 text-xs">
          {round && lastVisible ? (
            <>
              <span className="text-slate-400">
                {settings.symbol} {settings.tf} · ตอนนี้ {formatThaiTime(lastVisible.time + TIMEFRAME_MS[settings.tf])}
              </span>
              {phase === 'guess' && (
                <>
                  <button
                    onClick={() => setRound({ ...round, cut: Math.min(round.candles.length - 20, round.cut + 1) })}
                    className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line"
                  >
                    แท่งถัดไป →
                  </button>
                  <button onClick={() => choose('long')} className="rounded bg-bull/90 px-3 py-1 font-semibold text-black hover:bg-bull">
                    BUY (B)
                  </button>
                  <button onClick={() => choose('short')} className="rounded bg-bear/90 px-3 py-1 font-semibold text-white hover:bg-bear">
                    SELL (S)
                  </button>
                  <button onClick={() => reveal(true)} className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line">
                    ไม่เทรด — เฉลยเลย
                  </button>
                </>
              )}
              {phase === 'placed' && plan && (
                <>
                  <span className="text-slate-300">ลากเส้น SL / TP บนกราฟได้</span>
                  <button onClick={() => reveal(false)} className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-500">
                    ยืนยัน + เฉลย (Enter)
                  </button>
                  <button
                    onClick={() => {
                      setPlan(null);
                      setPhase('guess');
                    }}
                    className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line"
                  >
                    ยกเลิก
                  </button>
                </>
              )}
              {phase === 'done' && (
                <span className="flex flex-wrap items-center gap-3">
                  {plan ? (
                    result ? (
                      <span className={`font-semibold ${result.r > 0 ? 'text-bull' : 'text-bear'}`}>
                        คุณ: {fmtR(result.r)} ({result.exitReason === 'tp' ? 'ถึง TP' : result.exitReason === 'sl' ? 'โดน SL' : 'ยังไม่จบในช่วงที่เฉลย'})
                      </span>
                    ) : (
                      <span className="text-slate-400">ราคาเปิดกระโดดเลย SL/TP — ไม่ได้เข้า</span>
                    )
                  ) : (
                    <span className="text-slate-400">ข้ามข้อนี้</span>
                  )}
                  {st && (
                    <span className="text-slate-300">
                      ท่า {round.strategyName}: {st.direction === 'long' ? 'BUY' : 'SELL'}{' '}
                      <span className={st.r > 0 ? 'text-bull' : 'text-bear'}>{fmtR(st.r)}</span>
                    </span>
                  )}
                  <button onClick={() => void newRound()} className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-500">
                    ข้อต่อไป (N)
                  </button>
                </span>
              )}
            </>
          ) : (
            <span className="text-slate-400">เลือก symbol / TF แล้วกด "เริ่ม"</span>
          )}
        </div>
        <div className={`relative min-h-0 flex-1 ${phase === 'placed' ? 'cursor-ns-resize' : ''}`}>
          <CandleChart
            candles={visible}
            digits={digits}
            emas={[
              { period: 9, color: '#60a5fa' },
              { period: 21, color: '#f87171' },
            ]}
            resetKey={round?.key ?? ''}
            overlays={visuals?.overlays}
            markers={markers}
            priceLines={priceLines}
            onLineDrag={onLineDrag}
            focus={focus}
            appendOnly
          />
          {round && !showFuture && (
            <div className="pointer-events-none absolute right-24 top-3 rounded bg-black/50 px-2 py-0.5 text-[11px] text-slate-400">
              แท่งอนาคตซ่อนอยู่ {round.candles.length - round.cut} แท่ง
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
