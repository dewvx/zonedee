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
import { ParamForm } from '../components/ParamForm';
import { Icon } from '../components/Icon';
import { Empty, Field, Note, Section, SidePanel, Stat } from '../components/ui';
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

const tone = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : '');

/** ข้อมูลประกอบ (ป้ายจาง + ค่า) เรียงเป็นแถว */
function Meta({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
      {items.map(([k, val]) => (
        <span key={k} className="text-faint">
          {k} <span className="text-fg-2">{val}</span>
        </span>
      ))}
    </div>
  );
}

const pf = (s: Stats) => (s.profitFactor === null ? (s.trades ? '∞' : '-') : s.profitFactor.toFixed(2));

function StatsRow({ label, s }: { label: string; s: Stats }) {
  return (
    <tr>
      <td className="pl-0 text-muted">{label}</td>
      <td className="text-right tabular-nums">{s.trades}</td>
      <td className="text-right tabular-nums">{s.trades ? fmtPct(s.winRate) : '-'}</td>
      <td className={`text-right font-medium tabular-nums ${tone(s.expectancyR)}`}>{s.trades ? fmtR(s.expectancyR) : '-'}</td>
      <td className="pr-0 text-right tabular-nums">{pf(s)}</td>
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
        <div className="absolute top-2.5 h-1 rounded bg-line-strong" style={{ left: x(base.p5), width: `calc(${x(base.p95)} - ${x(base.p5)})` }} />
        <div className="absolute top-1.5 h-3 w-px bg-faint" style={{ left: x(base.p50) }} title="ค่ากลางของการสุ่ม" />
        <div
          className={`absolute top-0.5 h-5 w-1.5 -translate-x-1/2 rounded ${value >= base.p95 ? 'bg-bull' : value <= base.p50 ? 'bg-bear' : 'bg-warn'}`}
          style={{ left: x(value) }}
          title="ท่านี้"
        />
      </div>
      <div className="flex justify-between tabular-nums text-[11px] text-faint">
        <span>{fmtR(lo)}</span>
        <span>สุ่ม {base.runs} รอบ — ท่านี้ดีกว่า {base.percentile.toFixed(0)}% ของรอบ</span>
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
      <SidePanel
        footer={
          <>
            <div className="flex gap-2">
              <button
                onClick={() => void run('single')}
                disabled={running || !strat || !strat.timeframes.includes(s.tf)}
                className="btn btn-primary flex-1"
              >
                <Icon name="play" size={14} />
                {running ? 'กำลังรัน…' : 'รัน backtest'}
              </button>
              <button
                onClick={() => void run('compare')}
                disabled={running}
                title="รันทุกท่าด้วยค่าเริ่มต้นบนข้อมูลชุดเดียวกัน"
                className="btn"
              >
                เทียบทุกท่า
              </button>
            </div>
            <p className="text-xs leading-relaxed text-faint">
              ใช้ข้อมูลที่ดึงไว้แล้ว · เข้าแท่งถัดจากสัญญาณ · ถือทีละไม้ · ผลเป็น R (1R = ระยะ SL)
            </p>
          </>
        }
      >
        {loadError && <Note kind="bad">โหลดไม่ได้: {loadError}</Note>}

        <Section
          title="ข้อมูล"
          hint={
            coverage
              ? `มี ${formatThaiDate(coverage.first)} – ${formatThaiDate(coverage.last)} (${coverage.count.toLocaleString()} แท่ง)`
              : 'ยังไม่มีข้อมูล TF นี้ — ไปหน้ากราฟแล้วกดอัปเดต'
          }
        >
          <Field label="Symbol">
            <select value={s.symbol} onChange={(e) => update({ symbol: e.target.value })} className="field">
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
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TF ที่เทรด">
              <select value={s.tf} onChange={(e) => update({ tf: e.target.value as Timeframe })} className="field">
                {(info?.timeframes ?? [s.tf]).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="ช่วงข้อมูล">
              <select value={s.days} onChange={(e) => update({ days: Number(e.target.value) })} className="field">
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="ท่า">
          <select value={strat?.id ?? ''} onChange={(e) => update({ strategy: e.target.value })} className="field" aria-label="ท่า">
            {strategies.map((x) => (
              <option key={x.id} value={x.id} disabled={!x.timeframes.includes(s.tf)}>
                {x.name} — {x.source}
              </option>
            ))}
          </select>
          {strat && (
            <>
              <p className="text-xs leading-relaxed text-muted">{strat.description}</p>
              {!strat.timeframes.includes(s.tf) && <Note kind="warn">ท่านี้ใช้กับ {s.tf} ไม่ได้</Note>}
              <ParamForm
                specs={strat.params}
                values={params}
                onChange={(k, val) => update({ params: { ...s.params, [strat.id]: { ...params, [k]: val } } })}
              />
              {Object.keys(params).length > 0 && (
                <button onClick={() => update({ params: { ...s.params, [strat.id]: {} } })} className="text-xs text-accent hover:underline">
                  คืนค่าเริ่มต้นของท่า
                </button>
              )}
            </>
          )}
        </Section>

        <Section title="โครงสร้าง + ต้นทุน">
          <div className="grid grid-cols-2 gap-3">
            <Field label="swing (แท่ง)" title="D1: จำนวนแท่งซ้าย/ขวาของ swing">
              <input type="number" min={1} max={20} value={s.swingLength} onChange={(e) => update({ swingLength: Math.max(1, e.target.valueAsNumber || 1) })} className="field tabular-nums" />
            </Field>
            <Field label="ทะลุ (D3)" title="ทะลุ = ปิดทะลุ หรือไส้ทะลุ">
              <select value={s.breakBy} onChange={(e) => update({ breakBy: e.target.value as 'close' | 'wick' })} className="field">
                <option value="close">ปิดทะลุ</option>
                <option value="wick">ไส้ทะลุ</option>
              </select>
            </Field>
            <Field label="spread (points)" title="ว่าง = ค่าทั่วไปของบัญชี XM Standard (ทอง 35, EURUSD 16)">
              <input
                type="number"
                min={0}
                placeholder="ค่าทั่วไป"
                value={s.spreadPoints ?? ''}
                onChange={(e) => update({ spreadPoints: e.target.value === '' ? null : Math.max(0, e.target.valueAsNumber) })}
                className="field tabular-nums"
              />
            </Field>
            <Field label="ถือสูงสุด (แท่ง)" title="ปิดสถานะเมื่อถือครบกี่แท่ง (0 = ไม่จำกัด)">
              <input type="number" min={0} value={s.maxBarsInTrade} onChange={(e) => update({ maxBarsInTrade: Math.max(0, e.target.valueAsNumber || 0) })} className="field tabular-nums" />
            </Field>
          </div>
        </Section>

        <Section title="เงิน + การทดสอบ">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ทุนเริ่ม">
              <input type="number" min={1} value={s.balance} onChange={(e) => update({ balance: Math.max(1, e.target.valueAsNumber || 1) })} className="field tabular-nums" />
            </Field>
            <Field label="เสี่ยง % ต่อไม้">
              <input type="number" min={0.1} max={10} step={0.1} value={s.riskPct} onChange={(e) => update({ riskPct: e.target.valueAsNumber || 1 })} className="field tabular-nums" />
            </Field>
            <Field label="out-of-sample %" title="กันข้อมูลช่วงท้ายไว้ทดสอบ (ไม่ใช้ตอนจูน)">
              <input type="number" min={0} max={80} value={s.oosPct} onChange={(e) => update({ oosPct: Math.min(80, Math.max(0, e.target.valueAsNumber || 0)) })} className="field tabular-nums" />
            </Field>
            <Field label="สุ่มเทียบ (รอบ)" title="จำนวนรอบที่สุ่มจุดเข้าเพื่อเทียบ (0 = ไม่ทำ)">
              <input type="number" min={0} max={2000} step={50} value={s.baselineRuns} onChange={(e) => update({ baselineRuns: Math.max(0, e.target.valueAsNumber || 0) })} className="field tabular-nums" />
            </Field>
          </div>
        </Section>
      </SidePanel>

      {/* ── ผล ─────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1200px] space-y-5 p-6">
          {error && <Note kind="bad">{error}</Note>}

          {!single && !compare && !error && (
            <Empty icon="backtest" title="เลือกท่าแล้วกดรัน backtest">
              ดูว่าท่าจากไฟล์ริวเรน / Braron ทำกำไรจริงไหมบนข้อมูลย้อนหลัง — จะเริ่มเชื่อได้เมื่อมีอย่างน้อย 100 เทรด, กำไรในช่วง
              out-of-sample และชนะการเข้าแบบสุ่ม
            </Empty>
          )}

          {compare && (
            <section className="card overflow-hidden">
              <div className="border-b border-line px-5 py-4">
                <h2 className="text-[15px] font-semibold text-fg">
                  เทียบทุกท่า — {compare.meta.symbol} {compare.meta.tf}
                </h2>
                <Meta
                  items={[
                    ['ข้อมูล', `${compare.meta.bars.toLocaleString()} แท่ง`],
                    ['ช่วง', `${compare.meta.from ? formatThaiDate(compare.meta.from) : ''} – ${compare.meta.to ? formatThaiDate(compare.meta.to) : ''}`],
                    ['spread', `${compare.meta.spreadPoints} pt`],
                    ['ใช้เวลา', `${(compare.meta.durationMs / 1000).toFixed(1)} วิ`],
                  ]}
                />
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th className="pl-5">ท่า (ค่าเริ่มต้น) — คลิกเพื่อดูรายละเอียด</th>
                    <th className="text-right">เทรด</th>
                    <th className="text-right">ชนะ</th>
                    <th className="text-right">เฉลี่ย/ไม้</th>
                    <th className="text-right">รวม</th>
                    <th className="text-right">PF</th>
                    <th className="text-right">out-of-sample</th>
                    <th className="pr-5 text-right">ชนะสุ่ม</th>
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
                      className="cursor-pointer hover:bg-hover"
                    >
                      <td className="pl-5">
                        <span className="font-medium text-fg">{row.strategyName}</span>
                        <span className="ml-2 text-xs text-faint">{row.source}</span>
                      </td>
                      <td className="text-right tabular-nums">{row.stats.trades}</td>
                      <td className="text-right tabular-nums">{row.stats.trades ? fmtPct(row.stats.winRate) : '-'}</td>
                      <td className={`text-right font-medium tabular-nums ${tone(row.stats.expectancyR)}`}>
                        {row.stats.trades ? fmtR(row.stats.expectancyR) : '-'}
                      </td>
                      <td className="text-right tabular-nums">{row.stats.trades ? fmtR(row.stats.totalR, 1) : '-'}</td>
                      <td className="text-right tabular-nums">{pf(row.stats)}</td>
                      <td className={`text-right tabular-nums ${tone(row.outOfSample.expectancyR)}`}>
                        {row.outOfSample.trades ? `${fmtR(row.outOfSample.expectancyR)} (${row.outOfSample.trades})` : '-'}
                      </td>
                      <td className="pr-5 text-right tabular-nums">{row.percentile === null ? '-' : `${row.percentile.toFixed(0)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {single && r && v && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold leading-tight text-fg">{single.meta.strategyName}</h2>
                  <Meta
                    items={[
                      ['ตลาด', `${single.meta.symbol} ${single.meta.tf}`],
                      ['ข้อมูล', `${single.meta.bars.toLocaleString()} แท่ง`],
                      ['ช่วง', `${single.meta.from ? formatThaiDate(single.meta.from) : ''} – ${single.meta.to ? formatThaiDate(single.meta.to) : ''}`],
                      ['สัญญาณ', `${single.meta.signals} (ข้าม ${r.skipped})`],
                      ['spread', `${single.meta.spreadPoints} pt`],
                      ['แยก SL/TP ด้วย M1', single.meta.fineData ? 'มี' : 'ไม่มี'],
                    ]}
                  />
                </div>
                {onOpenChart && (
                  <button onClick={() => onOpenChart(single.meta.symbol, single.meta.tf)} className="btn btn-sm ml-auto">
                    <Icon name="chart" size={14} />
                    เปิดกราฟ
                  </button>
                )}
              </div>

              <Note kind={v.tone === 'good' ? 'ok' : v.tone}>{v.text}</Note>

              <div className="card grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-4 xl:grid-cols-8">
                <Stat label="เทรด" value={r.stats.trades} sub={`buy ${r.stats.longs} / sell ${r.stats.shorts}`} />
                <Stat label="ชนะ" value={r.stats.trades ? fmtPct(r.stats.winRate) : '-'} sub={`${r.stats.wins} ชนะ ${r.stats.losses} แพ้`} />
                <Stat
                  label="เฉลี่ยต่อไม้"
                  value={r.stats.trades ? fmtR(r.stats.expectancyR) : '-'}
                  tone={r.stats.expectancyR > 0 ? 'up' : r.stats.expectancyR < 0 ? 'down' : undefined}
                  sub={`ชนะ ${fmtR(r.stats.avgWinR, 1)} แพ้ ${fmtR(r.stats.avgLossR, 1)}`}
                />
                <Stat label="รวม" value={fmtR(r.stats.totalR, 1)} tone={r.stats.totalR > 0 ? 'up' : r.stats.totalR < 0 ? 'down' : undefined} />
                <Stat label="Profit factor" value={pf(r.stats)} />
                <Stat label="DD สูงสุด" value={`${r.stats.maxDrawdownR.toFixed(1)}R`} sub={`${r.stats.maxDrawdownPct.toFixed(1)}% ของเงิน`} />
                <Stat label="แพ้ติดกัน" value={r.stats.maxConsecLosses} sub={`ถือเฉลี่ย ${r.stats.avgBarsHeld.toFixed(0)} แท่ง`} />
                <Stat
                  label="เงิน"
                  value={r.stats.finalBalance.toFixed(0)}
                  tone={r.stats.finalBalance > s.balance ? 'up' : r.stats.finalBalance < s.balance ? 'down' : undefined}
                  sub={`เริ่ม ${s.balance} เสี่ยง ${s.riskPct}%`}
                />
              </div>

              <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
                <div className="card p-4">
                  <div className="mb-2 flex items-center gap-3 text-xs text-muted">
                    <span className="text-[13px] font-semibold text-fg">เส้น equity</span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded bg-[#6ea8fe]" />
                      in-sample
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded bg-[#f5b94a]" />
                      out-of-sample
                    </span>
                    <div className="seg ml-auto">
                      {(['r', 'balance'] as const).map((m) => (
                        <button key={m} onClick={() => setEquityMode(m)} aria-pressed={equityMode === m}>
                          {m === 'r' ? 'R' : 'เงิน'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="h-64">
                    <EquityChart points={r.equity} splitTime={r.splitTime} mode={equityMode} />
                  </div>
                </div>

                <div className="card space-y-4 p-4">
                  <div>
                    <div className="mb-1 text-[13px] font-semibold text-fg">ช่วงข้อมูล</div>
                    <table className="table">
                      <thead>
                        <tr>
                          <th className="pl-0" />
                          <th className="text-right">เทรด</th>
                          <th className="text-right">ชนะ</th>
                          <th className="text-right">เฉลี่ย</th>
                          <th className="pr-0 text-right">PF</th>
                        </tr>
                      </thead>
                      <tbody>
                        <StatsRow label="in-sample" s={r.inSample} />
                        <StatsRow label="out-of-sample" s={r.outOfSample} />
                      </tbody>
                    </table>
                    {r.splitTime && <p className="mt-1 text-xs text-faint">out-of-sample เริ่ม {formatThaiTime(r.splitTime)}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="buy เฉลี่ย" value={r.stats.longs ? fmtR(r.stats.longExpectancyR) : '-'} />
                    <Stat label="sell เฉลี่ย" value={r.stats.shorts ? fmtR(r.stats.shortExpectancyR) : '-'} />
                  </div>
                  <p className="text-xs text-muted">
                    ออกที่ TP {exitCounts.tp} ไม้ · SL {exitCounts.sl} ไม้
                    {exitCounts.time ? ` · ครบเวลา ${exitCounts.time}` : ''}
                    {exitCounts.eod ? ` · ข้อมูลหมด ${exitCounts.eod}` : ''}
                  </p>
                  {r.baseline && r.baseline.runs > 0 && (
                    <div>
                      <div className="mb-1 text-[13px] font-semibold text-fg">เทียบกับเข้าแบบสุ่ม</div>
                      <BaselineBar base={r.baseline} value={r.stats.expectancyR} />
                    </div>
                  )}
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
                  <span className="text-[13px] font-semibold text-fg">รายการเทรด</span>
                  <span className="text-xs text-muted">คลิกแถวเพื่อดูบนกราฟ</span>
                  <div className="seg ml-auto">
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
                        aria-pressed={filter === k}
                        onClick={() => {
                          setFilter(k);
                          setSelected(null);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="pl-5">เข้า (เวลาไทย)</th>
                      <th />
                      <th className="text-right">ราคาเข้า</th>
                      <th className="text-right">SL</th>
                      <th className="text-right">TP</th>
                      <th className="text-right">ออก</th>
                      <th className="text-right">R</th>
                      <th className="pr-5">เหตุผล</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, shown).map((t, k) => (
                      <tr key={`${t.entryIndex}-${k}`} onClick={() => setSelected(k)} className="cursor-pointer hover:bg-hover">
                        <td className="pl-5 tabular-nums text-muted">{formatThaiTime(t.entryTime)}</td>
                        <td>
                          <span className={`badge ${t.direction === 'long' ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear'}`}>
                            {t.direction === 'long' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{t.entry.toFixed(digits)}</td>
                        <td className="text-right tabular-nums text-muted">{t.sl.toFixed(digits)}</td>
                        <td className="text-right tabular-nums text-muted">{t.tp.toFixed(digits)}</td>
                        <td className="text-right tabular-nums">
                          {t.exit.toFixed(digits)} <span className="text-xs text-faint">{t.exitReason.toUpperCase()}</span>
                        </td>
                        <td className={`text-right font-medium tabular-nums ${t.r > 0 ? 'text-bull' : 'text-bear'}`}>{fmtR(t.r)}</td>
                        <td className="max-w-[26rem] truncate pr-5 text-muted" title={t.reason}>
                          {t.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {trades.length > shown && (
                  <div className="border-t border-line p-3">
                    <button onClick={() => setShown((n) => n + 500)} className="btn w-full">
                      แสดงเพิ่มอีก {trades.length - shown} รายการ
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
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
