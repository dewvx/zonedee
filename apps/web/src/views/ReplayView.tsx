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
import { toChartTime } from '../chartTime';
import { fmtPct, fmtR, formatThaiTime } from '../format';
import { DEFAULT_LAYERS, buildOverlays } from '../overlays';
import { Icon } from '../components/Icon';
import { Field, Note, Section, SidePanel, Stat } from '../components/ui';
import { CHART_PALETTE, useTheme } from '../theme';

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
      lines.push({ id: 'entry', price: plan.entry, color: '#8792a6', title: `${plan.dir === 'long' ? 'BUY' : 'SELL'} ${f(plan.entry)}` });
      lines.push({ id: 'sl', price: plan.sl, color: '#e5485f', title: `SL ${f(plan.sl)}`, draggable: drag });
      lines.push({ id: 'tp', price: plan.tp, color: '#20a874', title: `TP ${f(plan.tp)} · 1:${rr.toFixed(2)}`, draggable: drag });
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
          color: result.r >= 0 ? '#20a874' : '#e5485f',
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

  const pal = CHART_PALETTE[useTheme()];
  const emas = useMemo(() => [9, 21].map((period, k) => ({ period, color: pal.ema[k]! })), [pal]);
  const st = round?.strategyTrade;
  const showFuture = phase === 'reveal' || phase === 'done';

  return (
    <div className="flex h-full min-w-0">
      <SidePanel
        width="w-72"
        footer={
          <>
            <button onClick={() => void newRound()} disabled={phase === 'loading' || phase === 'reveal'} className="btn btn-primary w-full">
              <Icon name="play" size={14} />
              {phase === 'loading' ? 'กำลังสุ่ม…' : round ? 'ข้อต่อไป' : 'เริ่มฝึก'}
            </button>
            <p className="text-xs leading-relaxed text-faint">
              ปุ่มลัด: → แท่งถัดไป, B ซื้อ, S ขาย, Enter เฉลย, Esc ยกเลิก, N ข้อต่อไป
            </p>
          </>
        }
      >
        <div>
          <h1 className="text-[15px] font-semibold leading-tight text-fg">Replay</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            ซ่อนแท่งอนาคตไว้ ดูกราฟแล้วตัดสินใจ BUY / SELL / ไม่เทรด แล้วเฉลยว่าราคาไปทางไหน
          </p>
        </div>
        {error && <Note kind="bad">{error}</Note>}

        <Section title="ตั้งค่า">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <select value={settings.symbol} onChange={(e) => updateSettings({ symbol: e.target.value })} className="field">
                {symbols.map((s) => (
                  <option key={s.symbol} value={s.symbol} disabled={!s.data}>
                    {s.symbol}
                    {s.data ? '' : ' (ยังไม่มีข้อมูล)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="TF">
              <select value={settings.tf} onChange={(e) => updateSettings({ tf: e.target.value as Timeframe })} className="field">
                {(info?.timeframes ?? [settings.tf]).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="สุ่มจุดแบบไหน">
            <select value={settings.source} onChange={(e) => updateSettings({ source: e.target.value })} className="field">
              <option value="random">สุ่มทั่วไป</option>
              {strategies
                .filter((s) => s.timeframes.includes(settings.tf))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    จุดที่ {s.name} เกิดสัญญาณ
                  </option>
                ))}
            </select>
          </Field>
          <label className="flex cursor-pointer items-start gap-2 text-fg-2">
            <input type="checkbox" checked={settings.showStructure} onChange={(e) => updateSettings({ showStructure: e.target.checked })} className="mt-1" />
            <span>
              แสดงโซน + โครงสร้าง
              <span className="block text-xs text-faint">คิดจากแท่งที่เห็นเท่านั้น ไม่รู้อนาคต</span>
            </span>
          </label>
        </Section>

        <Section title="คะแนนสะสม">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Stat label="ทาย / เทรด" value={`${score.rounds} / ${score.trades}`} />
            <Stat label="ชนะ" value={score.trades ? fmtPct(score.wins / score.trades) : '-'} />
            <Stat label="รวม" value={fmtR(score.total, 1)} tone={score.total > 0 ? 'up' : score.total < 0 ? 'down' : undefined} />
            <Stat label="เฉลี่ย/ไม้" value={score.trades ? fmtR(score.avg) : '-'} tone={score.avg > 0 ? 'up' : score.avg < 0 ? 'down' : undefined} />
          </div>
          {log.length > 0 && (
            <>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {log
                  .slice(-8)
                  .reverse()
                  .map((l) => (
                    <li key={l.at} className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted">
                      <span className="text-fg-2">
                        {l.symbol} {l.tf}
                      </span>
                      <span className={l.guess === 'long' ? 'text-bull' : l.guess === 'short' ? 'text-bear' : ''}>
                        {l.guess === 'long' ? 'BUY' : l.guess === 'short' ? 'SELL' : 'ข้าม'}
                      </span>
                      <span className={`ml-auto font-medium tabular-nums ${(l.r ?? 0) > 0 ? 'text-bull' : (l.r ?? 0) < 0 ? 'text-bear' : ''}`}>
                        {l.r === null ? '—' : fmtR(l.r)}
                      </span>
                    </li>
                  ))}
              </ul>
              <button onClick={() => setStored((s) => ({ ...s, log: [] }))} className="text-xs text-accent hover:underline">
                ล้างคะแนน
              </button>
            </>
          )}
        </Section>
      </SidePanel>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-14 items-center gap-3 border-b border-line bg-panel px-5">
          {round && lastVisible ? (
            <>
              <span className="text-[15px] font-semibold text-fg">
                {settings.symbol} <span className="font-normal text-muted">{settings.tf}</span>
              </span>
              <span className="text-xs text-muted">ตอนนี้ {formatThaiTime(lastVisible.time + TIMEFRAME_MS[settings.tf])}</span>
              {round.strategyName && phase !== 'done' && <span className="badge bg-accent/12 text-accent">จุดที่ {round.strategyName} เกิดสัญญาณ</span>}
            </>
          ) : (
            <span className="text-[13px] text-muted">เลือก symbol / TF แล้วกด "เริ่มฝึก"</span>
          )}
        </div>
        <div className={`relative min-h-0 flex-1 ${phase === 'placed' ? 'cursor-ns-resize' : ''}`}>
          <CandleChart
            candles={visible}
            digits={digits}
            emas={emas}
            resetKey={round?.key ?? ''}
            overlays={visuals?.overlays}
            markers={markers}
            priceLines={priceLines}
            onLineDrag={onLineDrag}
            focus={focus}
            appendOnly
          />
          {round && !showFuture && (
            <div className="pointer-events-none absolute right-20 top-3 rounded-md bg-panel/90 px-2 py-1 text-xs text-muted shadow">
              ซ่อนแท่งอนาคตอยู่ {round.candles.length - round.cut} แท่ง
            </div>
          )}
          {round && lastVisible && phase !== 'loading' && phase !== 'reveal' && (
            <div className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-panel/95 p-2 backdrop-blur" style={{ boxShadow: 'var(--shadow-pop)' }}>
              {phase === 'guess' && (
                <>
                  <button
                    onClick={() => setRound({ ...round, cut: Math.min(round.candles.length - 20, round.cut + 1) })}
                    className="btn"
                    title="ดูแท่งถัดไปก่อนตัดสินใจ (→)"
                  >
                    แท่งถัดไป
                    <Icon name="right" size={14} />
                  </button>
                  <button onClick={() => choose('long')} className="btn border-bull bg-bull px-5 font-semibold text-white hover:!bg-bull hover:!text-white hover:brightness-110">
                    BUY
                  </button>
                  <button onClick={() => choose('short')} className="btn border-bear bg-bear px-5 font-semibold text-white hover:!bg-bear hover:!text-white hover:brightness-110">
                    SELL
                  </button>
                  <button onClick={() => reveal(true)} className="btn btn-ghost">
                    ไม่เทรด — เฉลยเลย
                  </button>
                </>
              )}
              {phase === 'placed' && plan && (
                <>
                  <span className="px-2 text-xs text-muted">ลากเส้น SL / TP บนกราฟได้</span>
                  <button onClick={() => reveal(false)} className="btn btn-primary">
                    ยืนยันแล้วเฉลย
                  </button>
                  <button
                    onClick={() => {
                      setPlan(null);
                      setPhase('guess');
                    }}
                    className="btn btn-ghost"
                  >
                    ยกเลิก
                  </button>
                </>
              )}
              {phase === 'done' && (
                <>
                  <div className="px-2">
                    {plan ? (
                      result ? (
                        <span className={`text-[15px] font-semibold tabular-nums ${result.r > 0 ? 'text-bull' : 'text-bear'}`}>
                          {fmtR(result.r)}{' '}
                          <span className="text-xs font-normal text-muted">
                            {result.exitReason === 'tp' ? 'ถึง TP' : result.exitReason === 'sl' ? 'โดน SL' : 'ยังไม่จบในช่วงที่เฉลย'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">ราคาเปิดกระโดดเลย SL/TP — ไม่ได้เข้า</span>
                      )
                    ) : (
                      <span className="text-xs text-muted">ข้ามข้อนี้</span>
                    )}
                    {st && (
                      <div className="text-xs text-muted">
                        ท่า {round.strategyName}: {st.direction === 'long' ? 'BUY' : 'SELL'}{' '}
                        <span className={`font-medium ${st.r > 0 ? 'text-bull' : 'text-bear'}`}>{fmtR(st.r)}</span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => void newRound()} className="btn btn-primary">
                    ข้อต่อไป
                    <Icon name="right" size={14} />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
