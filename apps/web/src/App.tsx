import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TIMEFRAME_MS,
  calcPosition,
  computeZones,
  detectSwings,
  mergeCandles,
  type Candle,
  type Timeframe,
} from '@zonedee/core';
import {
  fetchCandles,
  fetchContract,
  fetchSymbols,
  triggerFetch,
  type CandlesResponse,
  type ContractInfo,
  type SymbolSummary,
} from './api';
import { CandleChart, type ChartPriceLine, type EmaSetting } from './components/CandleChart';
import type { OverlayItem } from './components/OverlayPrimitive';
import { EMPTY_PLAN, RiskPanel, type TradePlan } from './components/RiskPanel';
import { snapTime, toChartTime } from './chartTime';
import { LayerBar } from './components/LayerBar';
import { ZonePanel } from './components/ZonePanel';
import { BO_HTF, buildOverlays, type LayerToggles } from './overlays';
import { loadSettings, saveSettings, type RiskSettings, type Settings, type ZoneSettings } from './settings';

// ค่าตามท่า 3 ของริวเรน (docs/rules.md)
const EMA_PRESET: EmaSetting[] = [
  { period: 9, color: '#60a5fa' },
  { period: 21, color: '#f87171' },
];

const PAGE_SIZE = 1000;
/** อัปเดตอัตโนมัติทุกกี่ ms */
const AUTO_UPDATE_MS = { forex: 60_000, 'us-stock': 5 * 60_000 } as const;

const SOURCE_LABEL: Record<CandlesResponse['source'], string> = {
  dukascopy: 'Dukascopy',
  yahoo: 'Yahoo Finance',
  mt5: 'MT5 (XM)',
  sample: 'ข้อมูลจำลอง',
};

const formatThaiTime = (ms: number, withYear = true) =>
  new Date(ms).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });

const formatCountdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/** ข้อมูลที่โหลดมาแสดงบนกราฟ ผูกกับ key (symbol:tf) กันข้อมูลเก่าไปปนตอนสลับเร็วๆ */
interface Series {
  key: string;
  candles: Candle[];
  source: CandlesResponse['source'];
  hasMore: boolean;
}

interface Status {
  kind: 'ok' | 'warn' | 'error';
  text: string;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const { symbol, tf, showEma, autoUpdate, zones: zoneSettings, layers, risk } = settings;
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const updateZones = (patch: Partial<ZoneSettings>) =>
    setSettings((s) => ({ ...s, zones: { ...s.zones, ...patch } }));
  const updateRisk = (patch: Partial<RiskSettings>) => setSettings((s) => ({ ...s, risk: { ...s.risk, ...patch } }));
  const toggleLayer = (k: keyof LayerToggles) =>
    setSettings((s) => ({ ...s, layers: { ...s.layers, [k]: !s.layers[k] } }));
  useEffect(() => saveSettings(settings), [settings]);

  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const key = `${symbol}:${tf}`;
  const keyRef = useRef(key);
  keyRef.current = key;
  const loadingOlderRef = useRef(false);

  const refreshSymbols = useCallback(
    () =>
      fetchSymbols()
        .then(setSymbols)
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void refreshSymbols();
  }, [refreshSymbols]);

  const info = symbols.find((s) => s.symbol === symbol);
  const timeframes = info?.timeframes ?? [];
  const tfReady = !!info && info.timeframes.includes(tf);

  // symbol ที่จำไว้ไม่มีแล้ว → กลับไปตัวแรก
  useEffect(() => {
    if (symbols.length > 0 && !info) update({ symbol: symbols[0]!.symbol });
  }, [symbols, info]);

  // เปลี่ยน symbol แล้ว TF เดิมไม่มี (เช่น forex M15 → หุ้น) ให้สลับไป D1 / TF แรกที่มี
  useEffect(() => {
    if (info && !info.timeframes.includes(tf)) {
      update({ tf: info.timeframes.includes('D1') ? 'D1' : info.timeframes[0]! });
    }
  }, [info, tf]);

  // โหลดแท่งล่าสุดเมื่อเปลี่ยน symbol / TF
  useEffect(() => {
    if (!tfReady) return;
    let cancelled = false;
    setLoading(true);
    setStatus(null);
    fetchCandles(symbol, tf, PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setSeries({ key, candles: res.candles, source: res.source, hasMore: res.hasMore });
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, tf, tfReady, key]);

  // เลื่อนกราฟไปทางซ้ายจนสุด → โหลดแท่งเก่าเพิ่ม
  const loadOlder = useCallback(() => {
    if (!series || series.key !== keyRef.current || !series.hasMore || loadingOlderRef.current) return;
    const oldest = series.candles[0];
    if (!oldest) return;
    const requestKey = series.key;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    fetchCandles(symbol, tf, PAGE_SIZE, oldest.time)
      .then((res) => {
        setSeries((prev) =>
          prev && prev.key === requestKey
            ? { ...prev, candles: mergeCandles(prev.candles, res.candles), hasMore: res.hasMore }
            : prev,
        );
      })
      .catch((e: Error) => setStatus({ kind: 'error', text: `โหลดย้อนหลังไม่ได้: ${e.message}` }))
      .finally(() => {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      });
  }, [series, symbol, tf]);

  // ปุ่มอัปเดต: ให้ server ดึงข้อมูลใหม่จากแหล่ง แล้วเอาแท่งล่าสุดมารวมกับที่มีอยู่
  const runUpdate = useCallback(
    async (silent = false) => {
      if (updating) return;
      const requestKey = keyRef.current;
      setUpdating(true);
      if (!silent) setStatus(null);
      try {
        const result = await triggerFetch(symbol);
        const latest = await fetchCandles(symbol, tf, PAGE_SIZE);
        setSeries((prev) => {
          if (!prev || prev.key !== requestKey) return prev;
          // เดิมเป็นข้อมูลจำลอง → แทนที่ทั้งชุด ห้ามรวม
          if (prev.source === 'sample' || latest.source === 'sample') {
            return { key: requestKey, candles: latest.candles, source: latest.source, hasMore: latest.hasMore };
          }
          return { ...prev, candles: mergeCandles(prev.candles, latest.candles), source: latest.source };
        });
        setLastUpdated(Date.now());
        await refreshSymbols();
        const secs = (result.durationMs / 1000).toFixed(1);
        if (result.errors.length > 0) {
          setStatus({ kind: 'warn', text: `อัปเดตได้บางส่วน (${secs} วิ): ${result.errors.join(' · ')}` });
        } else if (!silent) {
          setStatus({ kind: 'ok', text: `อัปเดตแล้ว · ${result.total.toLocaleString()} แท่ง (${secs} วิ)` });
        }
      } catch (e) {
        setStatus({ kind: 'error', text: `อัปเดตไม่สำเร็จ: ${(e as Error).message}` });
      } finally {
        setUpdating(false);
      }
    },
    [symbol, tf, updating, refreshSymbols],
  );

  // อัปเดตอัตโนมัติ (เฉพาะ symbol ที่มีข้อมูลจริงแล้ว)
  const runUpdateRef = useRef(runUpdate);
  runUpdateRef.current = runUpdate;
  const canAutoUpdate = autoUpdate && !!info?.data;
  const market = info?.market;
  useEffect(() => {
    if (!canAutoUpdate || !market) return;
    const id = setInterval(() => void runUpdateRef.current(true), AUTO_UPDATE_MS[market]);
    return () => clearInterval(id);
  }, [canAutoUpdate, market, symbol]);

  // ข้อมูลที่จะแสดง (กันข้อมูลของ symbol/TF ก่อนหน้าโผล่ระหว่างโหลด)
  const candles = series && series.key === key ? series.candles : [];
  const source = series && series.key === key ? series.source : null;

  // แท่งสุดท้ายยังไม่ปิด → นับถอยหลัง (เดินนาฬิกาเฉพาะตอนที่มีแท่งเปิดอยู่)
  const last = candles.at(-1);
  const lastCloseAt = last ? last.time + TIMEFRAME_MS[tf] : 0;
  const lastBarOpen = !!last && source !== 'sample' && now >= last.time && now < lastCloseAt;
  const mayBeOpen = !!last && source !== 'sample' && Date.now() < lastCloseAt;
  useEffect(() => {
    if (!mayBeOpen) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mayBeOpen]);

  const prev = candles.at(-2);
  const change = last && prev ? last.close - prev.close : 0;
  const emas = useMemo(() => (showEma ? EMA_PRESET : []), [showEma]);

  // แนวรับแนวต้าน คำนวณจากแท่งที่โหลดมาทั้งหมด ด้วย core ตัวเดียวกับที่ backtest จะใช้
  const { swingLength, zoneMergeAtr, maxZones, ryuMode, show: showZones, showSwings } = zoneSettings;
  const zones = useMemo(
    () => (showZones && candles.length > 0 ? computeZones(candles, { swingLength, zoneMergeAtr, maxZones, ryuMode }) : []),
    [candles, showZones, swingLength, zoneMergeAtr, maxZones, ryuMode],
  );
  const swings = useMemo(
    () => (showSwings && candles.length > 0 ? detectSwings(candles, { swingLength }) : []),
    [candles, showSwings, swingLength],
  );
  // ทุกอย่างที่วาดทับกราฟ (โซน + โครงสร้างราคา) คำนวณจาก core แล้วแปลงเป็นกล่อง/เส้น
  const visuals = useMemo(
    () => buildOverlays({ candles, tf, swingLength, zones, swings, layers }),
    [candles, tf, swingLength, zones, swings, layers],
  );

  // ── เครื่องคิด lot (Phase 5) ──────────────────────────────────────────────
  const [toolOpen, setToolOpen] = useState(false);
  const [plan, setPlan] = useState<TradePlan>(EMPTY_PLAN);
  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);

  // เปลี่ยน symbol → ล้างแผน + โหลดสเปกสัญญาใหม่
  useEffect(() => setPlan(EMPTY_PLAN), [symbol]);
  useEffect(() => {
    if (!toolOpen) return;
    let cancelled = false;
    setContract(null);
    setContractError(null);
    fetchContract(symbol)
      .then((c) => !cancelled && setContract(c))
      .catch((e: Error) => !cancelled && setContractError(e.message));
    return () => {
      cancelled = true;
    };
  }, [toolOpen, symbol]);

  // Esc = ปิดเครื่องมือ
  useEffect(() => {
    if (!toolOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setToolOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toolOpen]);

  const priceDigits = contract?.spec.digits ?? info?.digits ?? 2;
  const tick = contract?.spec.tickSize ?? 10 ** -priceDigits;
  const roundPrice = useCallback(
    (p: number) => Number((Math.round(p / tick) * tick).toFixed(priceDigits)),
    [tick, priceDigits],
  );
  const effective = {
    balance: risk.useMt5Balance && contract?.balance != null ? contract.balance : risk.balance,
    leverage: risk.leverage > 0 ? risk.leverage : (contract?.leverage ?? null),
    spreadPoints: risk.spreadPoints >= 0 ? risk.spreadPoints : (contract?.spreadPoints ?? 0),
  };
  const position = useMemo(
    () =>
      contract && plan.entry !== null && plan.sl !== null
        ? calcPosition({
            spec: contract.spec,
            balance: effective.balance,
            riskPct: risk.riskPct,
            entry: plan.entry,
            sl: plan.sl,
            tp: plan.tp ?? undefined,
            spreadPoints: effective.spreadPoints,
            leverage: effective.leverage ?? undefined,
            minRR: risk.minRR,
          })
        : null,
    [contract, plan, effective.balance, effective.spreadPoints, effective.leverage, risk.riskPct, risk.minRR],
  );

  const onChartClick = useCallback(
    (price: number, time: number) => {
      if (!toolOpen) return;
      const p = roundPrice(price);
      setPlan((cur) =>
        cur.entry === null
          ? { ...cur, entry: p, startTime: time }
          : cur.sl === null
            ? { ...cur, sl: p }
            : cur.tp === null
              ? { ...cur, tp: p }
              : cur,
      );
    },
    [toolOpen, roundPrice],
  );
  const onLineDrag = useCallback(
    (id: string, price: number) => setPlan((cur) => ({ ...cur, [id]: roundPrice(price) })),
    [roundPrice],
  );

  const accountCur = contract?.accountCurrency ?? 'USD';
  const priceLines = useMemo<ChartPriceLine[]>(() => {
    if (!toolOpen) return [];
    const lines: ChartPriceLine[] = [];
    const fmt = (v: number) => v.toFixed(priceDigits);
    if (plan.entry !== null) {
      const lotText = position?.valid ? ` · ${position.lots} ${contract?.spec.unit === 'share' ? 'หุ้น' : 'lot'}` : '';
      lines.push({ id: 'entry', price: plan.entry, color: '#cbd5e1', title: `Entry${lotText}`, draggable: true });
    }
    if (plan.sl !== null) {
      const loss = position?.valid ? ` −${position.actualRisk.toFixed(2)} ${accountCur}` : '';
      lines.push({ id: 'sl', price: plan.sl, color: '#ef4444', title: `SL ${fmt(plan.sl)}${loss}`, draggable: true });
    }
    if (plan.tp !== null) {
      const gain = position?.valid && position.profit !== null ? ` +${position.profit.toFixed(2)} ${accountCur}` : '';
      const rr = position?.rr ? ` · 1:${position.rr.toFixed(2)}` : '';
      lines.push({ id: 'tp', price: plan.tp, color: '#22c55e', title: `TP ${fmt(plan.tp)}${gain}${rr}`, draggable: true });
    }
    return lines;
  }, [toolOpen, plan, position, priceDigits, contract, accountCur]);

  // กล่องกำไร/ขาดทุนแบบ position tool ของ TradingView
  const chartOverlays = useMemo<OverlayItem[]>(() => {
    if (!toolOpen || plan.entry === null || plan.startTime === null || candles.length === 0) return visuals.overlays;
    const start = toChartTime(snapTime(candles, plan.startTime));
    const extra: OverlayItem[] = [];
    if (plan.sl !== null) {
      extra.push({
        kind: 'box', start, end: null,
        top: Math.max(plan.entry, plan.sl), bottom: Math.min(plan.entry, plan.sl),
        fill: 'rgba(239, 68, 68, 0.16)', stroke: 'rgba(239, 68, 68, 0.0)',
      });
    }
    if (plan.tp !== null) {
      extra.push({
        kind: 'box', start, end: null,
        top: Math.max(plan.entry, plan.tp), bottom: Math.min(plan.entry, plan.tp),
        fill: 'rgba(34, 197, 94, 0.16)', stroke: 'rgba(34, 197, 94, 0.0)',
      });
    }
    return [...visuals.overlays, ...extra];
  }, [visuals.overlays, toolOpen, plan, candles]);

  const forexSymbols = symbols.filter((s) => s.market === 'forex');
  const stockSymbols = symbols.filter((s) => s.market === 'us-stock');
  const hasMore = !!series && series.key === key && series.hasMore;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <span className="text-lg font-bold tracking-tight text-white">
          zone<span className="text-bull">dee</span>
        </span>

        <select
          value={symbol}
          onChange={(e) => update({ symbol: e.target.value })}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
        >
          <optgroup label="Forex / ทอง">
            {forexSymbols.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} · {s.description}
                {s.data ? '' : ' (ยังไม่มีข้อมูล)'}
              </option>
            ))}
          </optgroup>
          <optgroup label="หุ้น US">
            {stockSymbols.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.symbol} · {s.description}
                {s.data ? '' : ' (ยังไม่มีข้อมูล)'}
              </option>
            ))}
          </optgroup>
        </select>

        <div className="flex overflow-hidden rounded-md border border-line">
          {timeframes.map((t) => (
            <button
              key={t}
              onClick={() => update({ tf: t })}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                t === tf ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-line hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-l border-line pl-3">
          <button
            onClick={() => void runUpdate()}
            disabled={updating}
            title={`ดึงข้อมูลล่าสุดของ ${symbol} จาก ${info ? SOURCE_LABEL[info.source] : 'แหล่งข้อมูล'}`}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-line hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            <span className={updating ? 'inline-block animate-spin' : 'inline-block'}>⟳</span>
            {updating ? 'กำลังอัปเดต…' : 'อัปเดต'}
          </button>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400"
            title={info?.market === 'us-stock' ? 'ทุก 5 นาที' : 'ทุก 1 นาที'}
          >
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => update({ autoUpdate: e.target.checked })}
              className="accent-blue-500"
            />
            อัตโนมัติ
          </label>
        </div>

        {last && info && (
          <span className="ml-auto flex items-baseline gap-3 font-mono text-sm">
            {lastBarOpen && (
              <span className="text-xs text-slate-400" title="แท่งล่าสุดยังไม่ปิด (วาดจางไว้)">
                แท่งปิดใน <span className="text-slate-200">{formatCountdown(lastCloseAt - now)}</span>
              </span>
            )}
            <span>
              <span className="text-white">{last.close.toFixed(info.digits)}</span>{' '}
              <span className={change >= 0 ? 'text-bull' : 'text-bear'}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(info.digits)}
              </span>
            </span>
          </span>
        )}
      </header>

      {/* แถวเครื่องมือ: indicator + ชั้นโครงสร้างราคา */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel/60 px-4 py-1.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showEma}
            onChange={(e) => update({ showEma: e.target.checked })}
            className="accent-blue-500"
          />
          EMA 9 / 21
        </label>
        <span className="h-4 w-px bg-line" />
        <ZonePanel value={zoneSettings} onChange={updateZones} count={zones.length} />
        <span className="h-4 w-px bg-line" />
        <LayerBar layers={layers} counts={visuals.counts} onToggle={toggleLayer} htfs={BO_HTF[tf] ?? []} />
        <button
          onClick={() => setToolOpen((o) => !o)}
          aria-pressed={toolOpen}
          title="วาง Entry / SL / TP บนกราฟ แล้วคำนวณ lot ตามความเสี่ยง (Esc = ปิด)"
          className={`ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors ${
            toolOpen ? 'border-blue-500 bg-blue-600 text-white' : 'border-line text-slate-300 hover:bg-line hover:text-white'
          }`}
        >
          📐 คำนวณ lot
        </button>
      </div>

      {source === 'sample' && (
        <div className="border-b border-amber-900/50 bg-amber-950/40 px-4 py-1 text-xs text-amber-300">
          ยังไม่มีข้อมูลจริงของ {symbol} — กำลังแสดงข้อมูลจำลอง · กดปุ่ม <b>อัปเดต</b> ด้านบนเพื่อดึงข้อมูลจริง
        </div>
      )}
      {error && (
        <div className="border-b border-red-900/50 bg-red-950/40 px-4 py-1 text-xs text-red-300">
          โหลดข้อมูลไม่ได้: {error} (เปิด server อยู่ไหม? ลอง <code>npm run dev</code>)
        </div>
      )}
      {status && (
        <div
          className={`flex items-center border-b px-4 py-1 text-xs ${
            status.kind === 'ok'
              ? 'border-emerald-900/50 bg-emerald-950/40 text-emerald-300'
              : status.kind === 'warn'
                ? 'border-amber-900/50 bg-amber-950/40 text-amber-300'
                : 'border-red-900/50 bg-red-950/40 text-red-300'
          }`}
        >
          <span>{status.text}</span>
          <button onClick={() => setStatus(null)} className="ml-auto opacity-60 hover:opacity-100" aria-label="ปิด">
            ✕
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className={`relative min-h-0 min-w-0 flex-1 ${toolOpen ? 'cursor-crosshair' : ''}`}>
        <CandleChart
          candles={candles}
          digits={info?.digits ?? 2}
          emas={emas}
          resetKey={series?.key ?? ''}
          lastBarOpen={lastBarOpen}
          onNearLeftEdge={loadOlder}
          overlays={chartOverlays}
          markers={visuals.markers}
          priceLines={priceLines}
          onChartClick={onChartClick}
          onLineDrag={onLineDrag}
        />
        {(loading || loadingOlder) && (
          <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/50 px-2 py-0.5 text-xs text-slate-400">
            {loadingOlder ? 'กำลังโหลดแท่งย้อนหลัง…' : 'กำลังโหลด…'}
          </div>
        )}
      </main>
      {toolOpen && (
        <RiskPanel
          symbol={symbol}
          digits={priceDigits}
          plan={plan}
          onPlanChange={(patch) =>
            setPlan((p) => ({
              ...p,
              ...patch,
              // พิมพ์ Entry เองโดยไม่ได้คลิก → ให้กล่องเริ่มที่แท่งล่าสุด
              startTime: p.startTime ?? (patch.entry != null ? (candles.at(-1)?.time ?? null) : null),
            }))
          }
          risk={risk}
          onRiskChange={updateRisk}
          contract={contract}
          contractError={contractError}
          result={position}
          effective={effective}
          onReset={() => setPlan(EMPTY_PLAN)}
          onClose={() => setToolOpen(false)}
        />
      )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 border-t border-line bg-panel px-4 py-1 text-[11px] text-slate-500">
        {source && <span>แหล่งข้อมูล: {SOURCE_LABEL[source]}</span>}
        {info?.coverage[tf] && source !== 'sample' && (
          <span>
            {tf} มีข้อมูล {formatThaiTime(info.coverage[tf].first)} →{' '}
            {formatThaiTime(info.coverage[tf].last)} ({info.coverage[tf].count.toLocaleString()} แท่ง)
          </span>
        )}
        {lastUpdated && <span>อัปเดตล่าสุด {formatThaiTime(lastUpdated, false)}</span>}
        <span className="ml-auto">
          {candles.length.toLocaleString()} แท่งบนกราฟ
          {source !== 'sample' && candles.length > 0 && (hasMore ? ' · เลื่อนซ้ายเพื่อโหลดเพิ่ม' : ' · ครบแล้ว')} ·
          เวลาไทย
        </span>
      </footer>
    </div>
  );
}
