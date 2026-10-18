import { useEffect, useMemo, useState } from 'react';
import { DEFAULTS, type BaselineResult, type ParamValue, type Stats, type Timeframe, type Trade } from '@zonedee/core';
import {
  fetchStrategies,
  fetchSymbols,
  runBacktest,
  runCompare,
  type BacktestResponse,
  type CompareResponse,
  type StrategyInfo,
  type SymbolSummary,
} from '../api';
import { EquityChart } from '../components/EquityChart';
import { ParamForm, inputCls } from '../components/ParamForm';
import { TradePreview } from '../components/TradePreview';
import { fmtPct, fmtR, formatThaiDate, formatThaiTime } from '../format';

interface BtSettings {
  symbol: string;
  tf: Timeframe;
  strategy: string;
  /** ค่าของแต่ละท่า (จำแยกกัน) */
  params: Record<string, Record<string, ParamValue>>;
  swingLength: number;
  breakBy: 'close' | 'wick';
  /** null = ใช้ spread ทั่วไปของ symbol */
  spreadPoints: number | null;
  riskPct: number;
  balance: number;
  /** ย้อนหลังกี่วัน (0 = ทั้งหมดที่มี) */
  days: number;
  oosPct: number;
  baselineRuns: number;
  maxBarsInTrade: number;
}

const KEY = 'zonedee:backtest';
const DEFAULT_BT: BtSettings = {
  symbol: 'XAUUSD',
  tf: 'M15',
  strategy: 'ema-cross',
  params: {},
  swingLength: DEFAULTS.swingLength,
  breakBy: DEFAULTS.breakBy,
  spreadPoints: null,
  riskPct: 1,
  balance: 1000,
  days: 0,
  oosPct: 30,
  baselineRuns: 200,
  maxBarsInTrade: 0,
};

function loadBt(): BtSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_BT;
    const s = JSON.parse(raw) as Partial<BtSettings>;
    return { ...DEFAULT_BT, ...s, params: typeof s.params === 'object' && s.params ? s.params : {} };
  } catch {
    return DEFAULT_BT;
  }
}

const RANGE_OPTIONS = [
  { days: 0, label: 'ทั้งหมด' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '3 เดือน' },
  { days: 180, label: '6 เดือน' },
  { days: 365, label: '1 ปี' },
];

type Tone = 'good' | 'warn' | 'bad';
const TONE_CLS: Record<Tone, string> = {
  good: 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300',
  warn: 'border-amber-800/60 bg-amber-950/40 text-amber-300',
  bad: 'border-red-800/60 bg-red-950/40 text-red-300',
};

/** สรุปผลเป็นภาษาคน ตามเกณฑ์ใน docs/rules.md (≥ 100 เทรด, out-of-sample, ชนะการสุ่ม) */
function verdict(all: Stats, oos: Stats, base: BaselineResult | null): { tone: Tone; text: string } {
  if (all.trades === 0) return { tone: 'bad', text: 'ไม่มีเทรดเลย — ลองช่วงข้อมูลยาวขึ้น หรือปรับค่าของท่า' };
  if (all.expectancyR <= 0) return { tone: 'bad', text: 'ยังไม่มี edge — เฉลี่ยต่อไม้ติดลบหลังหัก spread' };
  if (all.trades < 100) return { tone: 'warn', text: `กำไร แต่มีแค่ ${all.trades} เทรด — ต้อง ≥ 100 ถึงจะเริ่มเชื่อได้` };
  if (oos.trades >= 20 && oos.expectancyR <= 0)
    return { tone: 'warn', text: 'ดีแค่ช่วงแรก — ช่วง out-of-sample ติดลบ ระวังจูนจนพอดีกับอดีต (overfit)' };
  if (base && base.percentile < 90)
    return { tone: 'warn', text: `ยังไม่ชนะการเข้าแบบสุ่มชัดเจน (ดีกว่าสุ่ม ${base.percentile.toFixed(0)}% — อยากเห็น ≥ 95%)` };
  return { tone: 'good', text: 'มีแวว ✓ — กำไรทั้งสองช่วงและชนะการสุ่ม (ยังต้องลองกับข้อมูลช่วงอื่น/คู่เงินอื่น)' };
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${tone === 'up' ? 'text-bull' : tone === 'down' ? 'text-bear' : 'text-white'}`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

const pf = (s: Stats) => (s.profitFactor === null ? (s.trades ? '∞' : '-') : s.profitFactor.toFixed(2));

function StatsRow({ label, s }: { label: string; s: Stats }) {
  return (
    <tr className="border-t border-line">
      <td className="py-1 pr-3 text-slate-400">{label}</td>
      <td className="py-1 pr-3 text-right font-mono">{s.trades}</td>
      <td className="py-1 pr-3 text-right font-mono">{s.trades ? fmtPct(s.winRate) : '-'}</td>
      <td className={`py-1 pr-3 text-right font-mono ${s.expectancyR > 0 ? 'text-bull' : s.expectancyR < 0 ? 'text-bear' : ''}`}>
        {s.trades ? fmtR(s.expectancyR) : '-'}
      </td>
      <td className="py-1 pr-3 text-right font-mono">{s.trades ? fmtR(s.totalR, 1) : '-'}</td>
      <td className="py-1 pr-3 text-right font-mono">{pf(s)}</td>
      <td className="py-1 text-right font-mono">{s.trades ? `${s.maxDrawdownR.toFixed(1)}R` : '-'}</td>
    </tr>
  );
}

/** แถบเทียบกับการเข้าแบบสุ่ม: ช่วง 5%–95% ของการสุ่ม + จุดของท่านี้ */
function BaselineBar({ base, value }: { base: BaselineResult; value: number }) {
  const lo = Math.min(base.p5, value);
  const hi = Math.max(base.p95, value);
  const span = hi - lo || 1;
  const x = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div>
      <div className="relative h-6">
        <div className="absolute top-2.5 h-1 rounded bg-slate-600" style={{ left: x(base.p5), width: `calc(${x(base.p95)} - ${x(base.p5)})` }} />
        <div className="absolute top-1.5 h-3 w-px bg-slate-400" style={{ left: x(base.p50) }} title="ค่ากลางของการสุ่ม" />
        <div
          className={`absolute top-0.5 h-5 w-1.5 -translate-x-1/2 rounded ${value >= base.p95 ? 'bg-bull' : value <= base.p50 ? 'bg-bear' : 'bg-amber-400'}`}
          style={{ left: x(value) }}
          title="ท่านี้"
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-slate-500">
        <span>{fmtR(lo)}</span>
        <span>สุ่ม {base.runs} รอบ · ดีกว่าสุ่ม {base.percentile.toFixed(0)}%</span>
        <span>{fmtR(hi)}</span>
      </div>
    </div>
  );
}

type TradeFilter = 'all' | 'long' | 'short' | 'win' | 'loss';

export default function BacktestView({ onOpenChart }: { onOpenChart?: (symbol: string, tf: Timeframe) => void }) {
  const [s, setS] = useState<BtSettings>(loadBt);
  const update = (patch: Partial<BtSettings>) => setS((cur) => ({ ...cur, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* เบราว์เซอร์ไม่ให้เก็บ — ไม่เป็นไร */
    }
  }, [s]);

  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([fetchSymbols(), fetchStrategies()])
      .then(([sy, st]) => {
        setSymbols(sy);
        setStrategies(st);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const info = symbols.find((x) => x.symbol === s.symbol);
  const strat = strategies.find((x) => x.id === s.strategy) ?? strategies[0];
  const params = (strat && s.params[strat.id]) ?? {};
  const coverage = info?.coverage[s.tf];

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [single, setSingle] = useState<BacktestResponse | null>(null);
  const [compare, setCompare] = useState<CompareResponse | null>(null);
  const [equityMode, setEquityMode] = useState<'r' | 'balance'>('r');
  const [filter, setFilter] = useState<TradeFilter>('all');
  const [shown, setShown] = useState(200);
  const [selected, setSelected] = useState<number | null>(null);

  const request = () => ({
    symbol: s.symbol,
    tf: s.tf,
    cfg: { swingLength: s.swingLength, breakBy: s.breakBy },
    from: s.days > 0 && coverage ? coverage.last - s.days * 86_400_000 : undefined,
    spreadPoints: s.spreadPoints ?? undefined,
    riskPct: s.riskPct,
    initialBalance: s.balance,
    maxBarsInTrade: s.maxBarsInTrade,
    oosFraction: s.oosPct / 100,
    baselineRuns: s.baselineRuns,
  });

  const run = async (mode: 'single' | 'compare', strategyId = strat?.id) => {
    if (!strategyId) return;
    setRunning(true);
    setError(null);
    try {
      if (mode === 'single') {
        const res = await runBacktest({ ...request(), strategy: strategyId, params: s.params[strategyId] ?? {} });
        setSingle(res);
        setCompare(null);
        setSelected(null);
        setShown(200);
      } else {
        setCompare(await runCompare(request()));
        setSingle(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const trades = useMemo(() => {
    const all = single?.result.trades ?? [];
    const keep: Record<TradeFilter, (t: Trade) => boolean> = {
      all: () => true,
      long: (t) => t.direction === 'long',
      short: (t) => t.direction === 'short',
      win: (t) => t.r > 0,
      loss: (t) => t.r <= 0,
    };
    return all.filter(keep[filter]);
  }, [single, filter]);

  const exitCounts = useMemo(() => {
    const c = { tp: 0, sl: 0, time: 0, eod: 0 };
    for (const t of single?.result.trades ?? []) c[t.exitReason]++;
    return c;
  }, [single]);

  const digits = info?.digits ?? 2;
  const sel = selected !== null ? trades[selected] : undefined;
  const r = single?.result;
  const v = r ? verdict(r.stats, r.outOfSample, r.baseline) : null;
  const forex = symbols.filter((x) => x.market === 'forex');
  const others = symbols.filter((x) => x.market !== 'forex');

  return (
    <div className="flex h-full min-w-0">
      {/* ── ฟอร์ม ─────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-line bg-panel p-3 text-xs">
        <h2 className="mb-2 text-sm font-semibold text-white">Backtest</h2>
        {loadError && <p className="mb-2 text-red-300">โหลดไม่ได้: {loadError}</p>}

        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className="mb-0.5 block text-[11px] text-slate-400">Symbol</span>
            <select value={s.symbol} onChange={(e) => update({ symbol: e.target.value })} className={inputCls}>
              <optgroup label="Forex / ทอง">
                {forex.map((x) => (
                  <option key={x.symbol} value={x.symbol}>
                    {x.symbol}
                    {x.data ? '' : ' (ยังไม่มีข้อมูล)'}
                  </option>
                ))}
              </optgroup>
              <optgroup label="หุ้น US">
                {others.map((x) => (
                  <option key={x.symbol} value={x.symbol}>
                    {x.symbol}
                    {x.data ? '' : ' (ยังไม่มีข้อมูล)'}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">TF ที่เทรด</span>
            <select value={s.tf} onChange={(e) => update({ tf: e.target.value as Timeframe })} className={inputCls}>
              {(info?.timeframes ?? [s.tf]).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">ช่วงข้อมูล</span>
            <select value={s.days} onChange={(e) => update({ days: Number(e.target.value) })} className={inputCls}>
              {RANGE_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {coverage
            ? `มีข้อมูล ${formatThaiDate(coverage.first)} → ${formatThaiDate(coverage.last)} (${coverage.count.toLocaleString()} แท่ง)`
            : 'ยังไม่มีข้อมูล TF นี้ — ไปหน้ากราฟแล้วกด ⟳ อัปเดต'}
        </p>

        <div className="mt-3 border-t border-line pt-3">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">ท่า</span>
            <select value={strat?.id ?? ''} onChange={(e) => update({ strategy: e.target.value })} className={inputCls}>
              {strategies.map((x) => (
                <option key={x.id} value={x.id} disabled={!x.timeframes.includes(s.tf)}>
                  {x.name} [{x.source}]
                </option>
              ))}
            </select>
          </label>
          {strat && (
            <>
              <p className="mt-1.5 leading-relaxed text-slate-400">{strat.description}</p>
              {!strat.timeframes.includes(s.tf) && <p className="mt-1 text-amber-300">ท่านี้ใช้กับ {s.tf} ไม่ได้</p>}
              <div className="mt-2">
                <ParamForm
                  specs={strat.params}
                  values={params}
                  onChange={(k, val) => update({ params: { ...s.params, [strat.id]: { ...params, [k]: val } } })}
                />
              </div>
              {Object.keys(params).length > 0 && (
                <button
                  onClick={() => update({ params: { ...s.params, [strat.id]: {} } })}
                  className="mt-1.5 text-[11px] text-slate-500 underline hover:text-slate-300"
                >
                  คืนค่าเริ่มต้น
                </button>
              )}
            </>
          )}
        </div>

        <details className="mt-3 border-t border-line pt-3" open>
          <summary className="cursor-pointer text-[11px] font-medium text-slate-300">โครงสร้าง + ต้นทุน</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block" title="D1: จำนวนแท่งซ้าย/ขวาของ swing">
              <span className="mb-0.5 block text-[11px] text-slate-400">swing (แท่ง)</span>
              <input type="number" min={1} max={20} value={s.swingLength} onChange={(e) => update({ swingLength: Math.max(1, e.target.valueAsNumber || 1) })} className={`${inputCls} font-mono`} />
            </label>
            <label className="block" title="D3: ทะลุ = ปิดทะลุ หรือไส้ทะลุ">
              <span className="mb-0.5 block text-[11px] text-slate-400">ทะลุ (D3)</span>
              <select value={s.breakBy} onChange={(e) => update({ breakBy: e.target.value as 'close' | 'wick' })} className={inputCls}>
                <option value="close">ปิดทะลุ</option>
                <option value="wick">ไส้ทะลุ</option>
              </select>
            </label>
            <label className="block" title="ว่าง = ค่าทั่วไปของบัญชี XM Standard (ทอง 35, EURUSD 16)">
              <span className="mb-0.5 block text-[11px] text-slate-400">spread (points)</span>
              <input
                type="number"
                min={0}
                placeholder="ค่าทั่วไป"
                value={s.spreadPoints ?? ''}
                onChange={(e) => update({ spreadPoints: e.target.value === '' ? null : Math.max(0, e.target.valueAsNumber) })}
                className={`${inputCls} font-mono`}
              />
            </label>
            <label className="block" title="ปิดสถานะเมื่อถือครบกี่แท่ง (0 = ไม่จำกัด)">
              <span className="mb-0.5 block text-[11px] text-slate-400">ถือสูงสุด (แท่ง)</span>
              <input type="number" min={0} value={s.maxBarsInTrade} onChange={(e) => update({ maxBarsInTrade: Math.max(0, e.target.valueAsNumber || 0) })} className={`${inputCls} font-mono`} />
            </label>
          </div>
        </details>

        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-[11px] font-medium text-slate-300">เงิน + การทดสอบ</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-slate-400">ทุนเริ่ม</span>
              <input type="number" min={1} value={s.balance} onChange={(e) => update({ balance: Math.max(1, e.target.valueAsNumber || 1) })} className={`${inputCls} font-mono`} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-slate-400">เสี่ยง % ต่อไม้</span>
              <input type="number" min={0.1} max={10} step={0.1} value={s.riskPct} onChange={(e) => update({ riskPct: e.target.valueAsNumber || 1 })} className={`${inputCls} font-mono`} />
            </label>
            <label className="block" title="กันข้อมูลช่วงท้ายไว้ทดสอบ (ไม่ใช้ตอนจูน)">
              <span className="mb-0.5 block text-[11px] text-slate-400">out-of-sample %</span>
              <input type="number" min={0} max={80} value={s.oosPct} onChange={(e) => update({ oosPct: Math.min(80, Math.max(0, e.target.valueAsNumber || 0)) })} className={`${inputCls} font-mono`} />
            </label>
            <label className="block" title="จำนวนรอบที่สุ่มจุดเข้าเพื่อเทียบ (0 = ไม่ทำ)">
              <span className="mb-0.5 block text-[11px] text-slate-400">สุ่มเทียบ (รอบ)</span>
              <input type="number" min={0} max={2000} step={50} value={s.baselineRuns} onChange={(e) => update({ baselineRuns: Math.max(0, e.target.valueAsNumber || 0) })} className={`${inputCls} font-mono`} />
            </label>
          </div>
        </details>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void run('single')}
            disabled={running || !strat || !strat.timeframes.includes(s.tf)}
            className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {running ? 'กำลังรัน…' : '▶ รัน backtest'}
          </button>
          <button
            onClick={() => void run('compare')}
            disabled={running}
            title="รันทุกท่าด้วยค่าเริ่มต้นบนข้อมูลชุดเดียวกัน"
            className="rounded-md border border-line px-3 py-1.5 text-xs text-slate-300 hover:bg-line hover:text-white disabled:opacity-50"
          >
            เทียบทุกท่า
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          ใช้ข้อมูลที่ดึงไว้แล้วเท่านั้น · เข้าแท่งถัดจากสัญญาณ · แท่งที่โดนทั้ง SL/TP ใช้ M1 แยก ไม่มีนับเป็น SL (D10) ·
          ถือทีละไม้ · ผลเป็น R (1R = ระยะ SL)
        </p>
      </aside>

      {/* ── ผล ─────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto p-4">
        {error && <div className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}

        {!single && !compare && !error && (
          <div className="mx-auto mt-16 max-w-md text-center text-sm text-slate-400">
            <p className="text-base text-slate-200">เลือกท่าแล้วกด ▶ รัน backtest</p>
            <p className="mt-2 leading-relaxed">
              ดูว่าท่าจากไฟล์ริวเรน / Braron ทำกำไรจริงไหมบนข้อมูลย้อนหลัง — กฎใน docs/rules.md บอกว่าต้อง ≥ 100 เทรด,
              กำไรช่วง out-of-sample และชนะการเข้าแบบสุ่ม ถึงจะเริ่มเชื่อได้
            </p>
          </div>
        )}

        {compare && (
          <section>
            <h3 className="text-sm font-semibold text-white">
              เทียบทุกท่า · {compare.meta.symbol} {compare.meta.tf}
            </h3>
            <p className="mb-3 text-[11px] text-slate-500">
              {compare.meta.bars.toLocaleString()} แท่ง ({compare.meta.from && formatThaiDate(compare.meta.from)} →{' '}
              {compare.meta.to && formatThaiDate(compare.meta.to)}) · spread {compare.meta.spreadPoints} pt · ค่าเริ่มต้นของทุกท่า ·{' '}
              {(compare.meta.durationMs / 1000).toFixed(1)} วิ · คลิกแถวเพื่อดูรายละเอียด
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] text-slate-500">
                <tr>
                  <th className="pb-1 font-normal">ท่า</th>
                  <th className="pb-1 text-right font-normal">เทรด</th>
                  <th className="pb-1 text-right font-normal">ชนะ</th>
                  <th className="pb-1 text-right font-normal">เฉลี่ย/ไม้</th>
                  <th className="pb-1 text-right font-normal">รวม</th>
                  <th className="pb-1 text-right font-normal">PF</th>
                  <th className="pb-1 text-right font-normal">out-of-sample</th>
                  <th className="pb-1 text-right font-normal">ชนะสุ่ม</th>
                </tr>
              </thead>
              <tbody>
                {compare.rows.map((row) => (
                  <tr
                    key={row.strategy}
                    onClick={() => {
                      update({ strategy: row.strategy });
                      void run('single', row.strategy);
                    }}
                    className="cursor-pointer border-t border-line hover:bg-line/50"
                  >
                    <td className="py-1.5">
                      <span className="text-white">{row.strategyName}</span>{' '}
                      <span className="text-[10px] text-slate-500">{row.source}</span>
                    </td>
                    <td className="text-right font-mono">{row.stats.trades}</td>
                    <td className="text-right font-mono">{row.stats.trades ? fmtPct(row.stats.winRate) : '-'}</td>
                    <td className={`text-right font-mono ${row.stats.expectancyR > 0 ? 'text-bull' : row.stats.expectancyR < 0 ? 'text-bear' : ''}`}>
                      {row.stats.trades ? fmtR(row.stats.expectancyR) : '-'}
                    </td>
                    <td className="text-right font-mono">{row.stats.trades ? fmtR(row.stats.totalR, 1) : '-'}</td>
                    <td className="text-right font-mono">{pf(row.stats)}</td>
                    <td className={`text-right font-mono ${row.outOfSample.expectancyR > 0 ? 'text-bull' : row.outOfSample.expectancyR < 0 ? 'text-bear' : ''}`}>
                      {row.outOfSample.trades ? `${fmtR(row.outOfSample.expectancyR)} (${row.outOfSample.trades})` : '-'}
                    </td>
                    <td className="text-right font-mono">{row.percentile === null ? '-' : `${row.percentile.toFixed(0)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {single && r && v && (
          <section className="space-y-4">
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-semibold text-white">{single.meta.strategyName}</h3>
                <span className="text-xs text-slate-400">
                  {single.meta.symbol} {single.meta.tf}
                </span>
                {onOpenChart && (
                  <button onClick={() => onOpenChart(single.meta.symbol, single.meta.tf)} className="text-[11px] text-blue-400 hover:underline">
                    เปิดกราฟ →
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                {single.meta.bars.toLocaleString()} แท่ง ({single.meta.from && formatThaiDate(single.meta.from)} →{' '}
                {single.meta.to && formatThaiDate(single.meta.to)}) · สัญญาณ {single.meta.signals} (ข้าม {r.skipped}) · spread{' '}
                {single.meta.spreadPoints} pt · M1 แยก SL/TP: {single.meta.fineData ? 'มี' : 'ไม่มี'} ·{' '}
                {(single.meta.durationMs / 1000).toFixed(1)} วิ
              </p>
            </div>

            <div className={`rounded-md border px-3 py-2 text-xs ${TONE_CLS[v.tone]}`}>{v.text}</div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
              <Card label="เทรด" value={String(r.stats.trades)} sub={`buy ${r.stats.longs} · sell ${r.stats.shorts}`} />
              <Card label="ชนะ" value={r.stats.trades ? fmtPct(r.stats.winRate) : '-'} sub={`${r.stats.wins} / ${r.stats.losses}`} />
              <Card
                label="เฉลี่ยต่อไม้"
                value={r.stats.trades ? fmtR(r.stats.expectancyR) : '-'}
                tone={r.stats.expectancyR > 0 ? 'up' : r.stats.expectancyR < 0 ? 'down' : undefined}
                sub={`ชนะ ${fmtR(r.stats.avgWinR, 1)} · แพ้ ${fmtR(r.stats.avgLossR, 1)}`}
              />
              <Card label="รวม" value={fmtR(r.stats.totalR, 1)} tone={r.stats.totalR > 0 ? 'up' : r.stats.totalR < 0 ? 'down' : undefined} />
              <Card label="Profit factor" value={pf(r.stats)} />
              <Card label="DD สูงสุด" value={`${r.stats.maxDrawdownR.toFixed(1)}R`} sub={`${r.stats.maxDrawdownPct.toFixed(1)}% ของเงิน`} />
              <Card label="แพ้ติดกัน" value={String(r.stats.maxConsecLosses)} sub={`ถือเฉลี่ย ${r.stats.avgBarsHeld.toFixed(0)} แท่ง`} />
              <Card
                label="เงิน"
                value={r.stats.finalBalance.toFixed(0)}
                tone={r.stats.finalBalance > s.balance ? 'up' : r.stats.finalBalance < s.balance ? 'down' : undefined}
                sub={`เริ่ม ${s.balance} · เสี่ยง ${s.riskPct}%`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="rounded-md border border-line bg-panel p-2">
                <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-slate-400">
                  <span>เส้น equity</span>
                  <span className="text-blue-400">━ in-sample</span>
                  <span className="text-amber-400">━ out-of-sample</span>
                  <div className="ml-auto flex overflow-hidden rounded border border-line">
                    {(['r', 'balance'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setEquityMode(m)}
                        className={`px-2 py-0.5 ${equityMode === m ? 'bg-blue-600 text-white' : 'hover:bg-line'}`}
                      >
                        {m === 'r' ? 'R' : 'เงิน'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-64">
                  <EquityChart points={r.equity} splitTime={r.splitTime} mode={equityMode} />
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-line bg-panel p-3 text-xs">
                <table className="w-full">
                  <thead className="text-left text-[10px] text-slate-500">
                    <tr>
                      <th className="font-normal" />
                      <th className="text-right font-normal">เทรด</th>
                      <th className="text-right font-normal">ชนะ</th>
                      <th className="text-right font-normal">เฉลี่ย</th>
                      <th className="text-right font-normal">รวม</th>
                      <th className="text-right font-normal">PF</th>
                      <th className="text-right font-normal">DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    <StatsRow label="in" s={r.inSample} />
                    <StatsRow label="out" s={r.outOfSample} />
                  </tbody>
                </table>
                {r.splitTime && <p className="text-[10px] text-slate-500">out-of-sample เริ่ม {formatThaiTime(r.splitTime)}</p>}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-slate-500">buy เฉลี่ย</div>
                    <div className="font-mono">{r.stats.longs ? fmtR(r.stats.longExpectancyR) : '-'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">sell เฉลี่ย</div>
                    <div className="font-mono">{r.stats.shorts ? fmtR(r.stats.shortExpectancyR) : '-'}</div>
                  </div>
                  <div className="col-span-2 text-slate-500">
                    ออกที่ TP {exitCounts.tp} · SL {exitCounts.sl}
                    {exitCounts.time ? ` · ครบเวลา ${exitCounts.time}` : ''}
                    {exitCounts.eod ? ` · ข้อมูลหมด ${exitCounts.eod}` : ''}
                  </div>
                </div>
                {r.baseline && r.baseline.runs > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] text-slate-400">เทียบกับเข้าแบบสุ่ม (SL/TP ระยะเดียวกัน)</div>
                    <BaselineBar base={r.baseline} value={r.stats.expectancyR} />
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-md border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-[11px]">
                <span className="font-medium text-slate-300">รายการเทรด</span>
                <span className="text-slate-500">คลิกเพื่อดูบนกราฟ</span>
                <div className="ml-auto flex overflow-hidden rounded border border-line">
                  {(
                    [
                      ['all', 'ทั้งหมด'],
                      ['long', 'buy'],
                      ['short', 'sell'],
                      ['win', 'ชนะ'],
                      ['loss', 'แพ้'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => {
                        setFilter(k);
                        setSelected(null);
                      }}
                      className={`px-2 py-0.5 ${filter === k ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-line'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] text-slate-500">
                  <tr>
                    <th className="px-3 py-1 font-normal">เข้า (เวลาไทย)</th>
                    <th className="py-1 font-normal" />
                    <th className="py-1 text-right font-normal">ราคาเข้า</th>
                    <th className="py-1 text-right font-normal">SL</th>
                    <th className="py-1 text-right font-normal">TP</th>
                    <th className="py-1 text-right font-normal">ออก</th>
                    <th className="py-1 text-right font-normal">R</th>
                    <th className="py-1 pl-3 font-normal">เหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, shown).map((t, k) => (
                    <tr key={`${t.entryIndex}-${k}`} onClick={() => setSelected(k)} className="cursor-pointer border-t border-line/60 hover:bg-line/50">
                      <td className="px-3 py-1 font-mono text-slate-400">{formatThaiTime(t.entryTime)}</td>
                      <td className={t.direction === 'long' ? 'text-bull' : 'text-bear'}>{t.direction === 'long' ? 'BUY' : 'SELL'}</td>
                      <td className="text-right font-mono">{t.entry.toFixed(digits)}</td>
                      <td className="text-right font-mono text-slate-500">{t.sl.toFixed(digits)}</td>
                      <td className="text-right font-mono text-slate-500">{t.tp.toFixed(digits)}</td>
                      <td className="text-right font-mono">
                        {t.exit.toFixed(digits)} <span className="text-[10px] text-slate-500">{t.exitReason.toUpperCase()}</span>
                      </td>
                      <td className={`text-right font-mono ${t.r > 0 ? 'text-bull' : 'text-bear'}`}>{fmtR(t.r)}</td>
                      <td className="max-w-[28rem] truncate pl-3 text-slate-400" title={t.reason}>
                        {t.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trades.length > shown && (
                <button onClick={() => setShown((n) => n + 500)} className="w-full border-t border-line py-1.5 text-[11px] text-slate-400 hover:bg-line">
                  แสดงเพิ่ม ({trades.length - shown} รายการ)
                </button>
              )}
            </div>
          </section>
        )}
      </main>

      {sel && single && (
        <TradePreview
          symbol={single.meta.symbol}
          tf={single.meta.tf}
          digits={digits}
          trade={{ ...sel, title: `${single.meta.symbol} ${single.meta.tf}`, subtitle: sel.reason }}
          onClose={() => setSelected(null)}
          onPrev={selected! > 0 ? () => setSelected((k) => (k ?? 1) - 1) : undefined}
          onNext={selected! < trades.length - 1 ? () => setSelected((k) => (k ?? 0) + 1) : undefined}
        />
      )}
    </div>
  );
}
