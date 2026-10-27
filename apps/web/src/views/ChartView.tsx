import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TIMEFRAME_MS,
  calcPosition,
  computeZones,
  detectSwings,
  keyLevels,
  LEVEL_STATUS_TH,
  mergeCandles,
  type Candle,
  type FundamentalData,
  type StockSummaryResult,
  type Timeframe,
} from '@zonedee/core';
import {
  createJournal,
  fetchCandles,
  fetchContract,
  fetchFundamentals,
  fetchSymbols,
  triggerFetch,
  type CandlesResponse,
  type ContractInfo,
  type SymbolSummary,
} from '../api';
import { CandleChart, type CandleChartHandle, type ChartPriceLine, type EmaSetting } from '../components/CandleChart';
import type { OverlayItem } from '../components/OverlayPrimitive';
import { EMPTY_PLAN, RiskPanel, type TradePlan } from '../components/RiskPanel';
import { snapTime, toChartTime } from '../chartTime';
import { LayerBar } from '../components/LayerBar';
import { ZonePanel } from '../components/ZonePanel';
import { SymbolSearchModal } from '../components/SymbolSearchModal';
import { StockSummaryModal } from '../components/StockSummaryModal';
import { BO_HTF, buildOverlays, type LayerToggles } from '../overlays';
import { formatThaiTime } from '../format';
import { Icon } from '../components/Icon';
import { CHART_PALETTE, useTheme } from '../theme';
import { loadSettings, saveSettings, type RiskSettings, type Settings, type ZoneSettings } from '../settings';

// ค่าตามท่า 3 ของริวเรน (docs/rules.md) — สีตามธีม
const EMA_PERIODS = [9, 21];

const PAGE_SIZE = 1000;
/** อัปเดตอัตโนมัติทุกกี่ ms */
const AUTO_UPDATE_MS = { forex: 60_000, 'us-stock': 5 * 60_000 } as const;

const SOURCE_LABEL: Record<CandlesResponse['source'], string> = {
  dukascopy: 'Dukascopy',
  yahoo: 'Yahoo Finance',
  mt5: 'MT5 (XM)',
  sample: 'ข้อมูลจำลอง',
};

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

/** คำสั่งจากหน้าอื่นให้เปิด symbol/TF (id เปลี่ยน = สั่งใหม่) */
export interface ChartNav {
  symbol: string;
  tf: Timeframe;
  id: number;
}

export default function ChartView({ nav }: { nav?: ChartNav | null }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const { symbol, tf, showEma, showKeyLevels, autoUpdate, zones: zoneSettings, layers, risk, d1Cutoff } = settings;
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<{
    fundamentals: FundamentalData | null;
    summary: StockSummaryResult | null;
  } | null>(null);

  const openSummary = useCallback(async () => {
    setSummaryOpen(true);
    try {
      const res = await fetchFundamentals(symbol);
      setSummaryData({ fundamentals: res.fundamentals, summary: res.summary });
    } catch (err) {
      console.warn('fetchFundamentals error:', err);
    }
  }, [symbol]);

  // คีย์ลัด '/' หรือ 'Ctrl+K' เปิดกล่องค้นหา symbol
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const key = `${symbol}:${tf}:${tf === 'D1' ? d1Cutoff : ''}`;
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

  // หน้าอื่นสั่งเปิดกราฟ (อาจเป็นหุ้นที่เพิ่งเพิ่ม → โหลดรายชื่อใหม่ก่อน ไม่งั้นจะเด้งกลับตัวแรก)
  useEffect(() => {
    if (!nav) return;
    void refreshSymbols().then(() => setSettings((s) => ({ ...s, symbol: nav.symbol, tf: nav.tf })));
  }, [nav, refreshSymbols]);

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
    fetchCandles(symbol, tf, PAGE_SIZE, undefined, tf === 'D1' ? d1Cutoff : undefined)
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
  }, [symbol, tf, tfReady, key, d1Cutoff]);

  // เลื่อนกราฟไปทางซ้ายจนสุด → โหลดแท่งเก่าเพิ่ม
  const loadOlder = useCallback(() => {
    if (!series || series.key !== keyRef.current || !series.hasMore || loadingOlderRef.current) return;
    const oldest = series.candles[0];
    if (!oldest) return;
    const requestKey = series.key;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    fetchCandles(symbol, tf, PAGE_SIZE, oldest.time, tf === 'D1' ? d1Cutoff : undefined)
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
  }, [series, symbol, tf, d1Cutoff]);

  // ปุ่มอัปเดต: ให้ server ดึงข้อมูลใหม่จากแหล่ง แล้วเอาแท่งล่าสุดมารวมกับที่มีอยู่
  const runUpdate = useCallback(
    async (silent = false) => {
      if (updating) return;
      const requestKey = keyRef.current;
      setUpdating(true);
      if (!silent) setStatus(null);
      try {
        const result = await triggerFetch(symbol);
        const latest = await fetchCandles(symbol, tf, PAGE_SIZE, undefined, tf === 'D1' ? d1Cutoff : undefined);
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
    [symbol, tf, d1Cutoff, updating, refreshSymbols],
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
  const changePct = last && prev && prev.close ? (change / prev.close) * 100 : 0;
  const pal = CHART_PALETTE[useTheme()];
  const emas = useMemo<EmaSetting[]>(
    () => (showEma ? EMA_PERIODS.map((period, k) => ({ period, color: pal.ema[k]! })) : []),
    [showEma, pal],
  );

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
    () => buildOverlays({ candles, tf, swingLength, zones, swings, layers, d1Cutoff }),
    [candles, tf, swingLength, zones, swings, layers, d1Cutoff],
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

  // บันทึกแผนลง journal พร้อมรูปกราฟ (Phase 8)
  const chartApi = useRef<CandleChartHandle | null>(null);
  const [savingJournal, setSavingJournal] = useState(false);
  const saveJournal = async () => {
    if (plan.entry === null || plan.sl === null) return;
    setSavingJournal(true);
    try {
      let image: string | undefined;
      try {
        image = chartApi.current?.screenshot();
      } catch {
        image = undefined; // ถ่ายรูปไม่ได้ก็บันทึกต่อ
      }
      const e = await createJournal({
        symbol,
        tf,
        direction: plan.entry > plan.sl ? 'long' : 'short',
        status: 'plan',
        entryTime: candles.at(-1)?.time ?? Date.now(),
        entryPrice: plan.entry,
        sl: plan.sl,
        tp: plan.tp,
        lots: position?.valid ? position.lots : null,
        image,
      });
      setStatus({ kind: 'ok', text: `บันทึกลง Journal แล้ว (#${e.id}) — ไปเติมเหตุผล/ผลลัพธ์ได้ที่หน้า 📓 Journal` });
    } catch (err) {
      setStatus({ kind: 'error', text: `บันทึก journal ไม่ได้: ${(err as Error).message}` });
    } finally {
      setSavingJournal(false);
    }
  };

  // แนวรับต้านหลัก (แบบง่าย) — ตัวเดียวกับหน้าลงทุน/ตัวสแกน
  const levels = useMemo(() => (showKeyLevels && candles.length > 1 ? keyLevels(candles) : null), [candles, showKeyLevels]);
  const levelLines = useMemo<ChartPriceLine[]>(() => {
    if (!levels) return [];
    const f = (v: number) => v.toFixed(priceDigits);
    const p = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
    return [
      ...levels.resistances.map((l, k) => ({ id: `kl-r${k}`, price: l.price, color: '#e5485f', title: `ต้าน ${f(l.price)} ${p(l.distancePct)}`, dashed: true })),
      ...levels.supports.map((l, k) => ({ id: `kl-s${k}`, price: l.price, color: '#20a874', title: `รับ ${f(l.price)} ${p(l.distancePct)}`, dashed: true })),
    ];
  }, [levels, priceDigits]);

  const accountCur = contract?.accountCurrency ?? 'USD';
  const priceLines = useMemo<ChartPriceLine[]>(() => {
    if (!toolOpen) return levelLines;
    const lines: ChartPriceLine[] = [...levelLines];
    const fmt = (v: number) => v.toFixed(priceDigits);
    if (plan.entry !== null) {
      const lotText = position?.valid ? ` · ${position.lots} ${contract?.spec.unit === 'share' ? 'หุ้น' : 'lot'}` : '';
      lines.push({ id: 'entry', price: plan.entry, color: '#8792a6', title: `Entry${lotText}`, draggable: true });
    }
    if (plan.sl !== null) {
      const loss = position?.valid ? ` −${position.actualRisk.toFixed(2)} ${accountCur}` : '';
      lines.push({ id: 'sl', price: plan.sl, color: '#e5485f', title: `SL ${fmt(plan.sl)}${loss}`, draggable: true });
    }
    if (plan.tp !== null) {
      const gain = position?.valid && position.profit !== null ? ` +${position.profit.toFixed(2)} ${accountCur}` : '';
      const rr = position?.rr ? ` · 1:${position.rr.toFixed(2)}` : '';
      lines.push({ id: 'tp', price: plan.tp, color: '#20a874', title: `TP ${fmt(plan.tp)}${gain}${rr}`, draggable: true });
    }
    return lines;
  }, [toolOpen, plan, position, priceDigits, contract, accountCur, levelLines]);

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
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
        {/* symbol + ราคา = จุดที่ตาไปก่อน */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="group relative block cursor-pointer rounded-lg px-2 py-1 text-left hover:bg-hover"
            title="ค้นหาหรือสลับ symbol (กด / หรือ Ctrl+K)"
          >
            <span className="flex items-center gap-1.5 text-[17px] font-semibold leading-tight tracking-tight text-fg">
              {symbol}
              <Icon name="search" size={14} className="text-muted group-hover:text-accent" />
            </span>
            <span className="block max-w-56 truncate text-xs leading-tight text-muted">{info?.description ?? ''}</span>
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:text-fg sm:flex"
            title="ค้นหาหรือเพิ่ม symbol (กด / หรือ Ctrl+K)"
          >
            <Icon name="search" size={13} />
            <span>ค้นหาหุ้น</span>
            <kbd className="rounded bg-field px-1 py-0.2 font-mono text-[10px] text-faint">/</kbd>
          </button>
          {last && info && (
            <div className="flex items-baseline gap-2.5 tabular-nums">
              <span className="text-[22px] font-semibold leading-none tracking-tight text-fg">
                {last.close.toLocaleString('en-US', { minimumFractionDigits: info.digits, maximumFractionDigits: info.digits })}
              </span>
              <span className={`text-[13px] font-medium ${change >= 0 ? 'text-bull' : 'text-bear'}`}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(info.digits)} ({changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%)
              </span>
            </div>
          )}
        </div>

        <div className="seg" role="group" aria-label="Timeframe">
          {timeframes.map((t) => (
            <button key={t} onClick={() => update({ tf: t })} aria-pressed={t === tf}>
              {t}
            </button>
          ))}
        </div>

        {tf === 'D1' && info?.market === 'forex' && (
          <div className="flex items-center gap-1.5 text-xs text-muted" title="เวลาตัดแท่ง Daily (D1) ของตลาด Forex">
            <span>ตัดแท่ง:</span>
            <div className="seg" role="group" aria-label="D1 Cutoff">
              <button
                type="button"
                onClick={() => update({ d1Cutoff: 'ny-close' })}
                aria-pressed={d1Cutoff === 'ny-close'}
                title="ตัดแท่งตอน New York Close (17:00 NY / ตี 4-ตี 5 ไทย) — ตรงกับ MT5 ของ XM ไม่มีแท่งวันอาทิตย์"
              >
                NY Close (17:00)
              </button>
              <button
                type="button"
                onClick={() => update({ d1Cutoff: 'utc' })}
                aria-pressed={d1Cutoff === 'utc'}
                title="ตัดแท่งตาม 00:00 UTC (ตี 7 ไทย)"
              >
                UTC (00:00)
              </button>
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {lastBarOpen && (
            <span className="tabular-nums text-xs text-muted" title="แท่งล่าสุดยังไม่ปิด (วาดจางไว้)">
              แท่งปิดใน <span className="font-medium text-fg-2">{formatCountdown(lastCloseAt - now)}</span>
            </span>
          )}
          <button
            onClick={() => update({ autoUpdate: !autoUpdate })}
            className="flex items-center gap-2 text-xs text-muted hover:text-fg"
            title={info?.market === 'us-stock' ? 'ดึงข้อมูลใหม่ทุก 5 นาที' : 'ดึงข้อมูลใหม่ทุก 1 นาที'}
          >
            <span role="switch" aria-checked={autoUpdate} className="switch" />
            อัปเดตอัตโนมัติ
          </button>
          <button
            onClick={() => void runUpdate()}
            disabled={updating}
            title={`ดึงข้อมูลล่าสุดของ ${symbol} จาก ${info ? SOURCE_LABEL[info.source] : 'แหล่งข้อมูล'}`}
            className="btn"
          >
            <Icon name="refresh" size={15} className={updating ? 'animate-spin' : ''} />
            {updating ? 'กำลังอัปเดต…' : 'อัปเดต'}
          </button>
        </div>
      </header>

      {/* แถวเครื่องมือ: indicator + ชั้นโครงสร้างราคา */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <button
          onClick={() => update({ showEma: !showEma })}
          aria-pressed={showEma}
          title="EMA 9 / 21 (ท่า 3 ของริวเรน)"
          className="chip"
        >
          <span className="inline-flex gap-[2px]">
            {pal.ema.map((c) => (
              <span key={c} className="h-[3px] w-2.5 rounded-full" style={{ background: c, opacity: showEma ? 1 : 0.35 }} />
            ))}
          </span>
          EMA 9 / 21
        </button>
        <button
          onClick={() => update({ showKeyLevels: !showKeyLevels })}
          aria-pressed={showKeyLevels}
          title="แนวรับต้านหลักแบบง่าย ฝั่งละ 3 เส้น พร้อมระยะห่าง % (เหมาะกับ D1 / หุ้นลงทุน)"
          className="chip"
        >
          <span className="inline-flex flex-col gap-[2px]">
            <span className="h-px w-3 border-t border-dashed border-bear" />
            <span className="h-px w-3 border-t border-dashed border-bull" />
          </span>
          แนวรับต้านหลัก
          {levels && levels.status !== 'between' && <span className="text-[11px] text-accent">{LEVEL_STATUS_TH[levels.status]}</span>}
        </button>
        <ZonePanel value={zoneSettings} onChange={updateZones} count={zones.length} />
        <span className="mx-1 h-5 w-px bg-line" />
        <LayerBar layers={layers} counts={visuals.counts} onToggle={toggleLayer} htfs={BO_HTF[tf] ?? []} />
        {info?.market === 'us-stock' && (
          <button
            onClick={() => void openSummary()}
            className="chip hover:border-accent"
            title="สรุปวิเคราะห์หุ้นภาษาไทยและงบการเงินจาก Yahoo Finance"
          >
            <Icon name="invest" size={14} />
            สรุปหุ้น & งบ
          </button>
        )}
        <button
          onClick={() => setToolOpen((o) => !o)}
          aria-pressed={toolOpen}
          title="วาง Entry / SL / TP บนกราฟ แล้วคำนวณ lot ตามความเสี่ยง (Esc = ปิด)"
          className={`btn btn-sm ml-auto ${toolOpen ? 'btn-primary' : ''}`}
        >
          <Icon name="ruler" size={15} />
          คำนวณ lot
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className={`relative min-h-0 min-w-0 flex-1 ${toolOpen ? 'cursor-crosshair' : ''}`}>
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-16">
          {source === 'sample' && (
            <div className="note note-warn pointer-events-auto bg-panel/95 shadow-lg">
              ยังไม่มีข้อมูลจริงของ {symbol} — ตอนนี้เป็นข้อมูลจำลอง กด <b>อัปเดต</b> มุมขวาบนเพื่อดึงข้อมูลจริง
            </div>
          )}
          {error && (
            <div className="note note-bad pointer-events-auto bg-panel/95 shadow-lg">
              โหลดข้อมูลไม่ได้: {error} — เปิด server อยู่ไหม? ลอง <code>npm run dev</code>
            </div>
          )}
          {status && (
            <div className={`note pointer-events-auto bg-panel/95 shadow-lg ${status.kind === 'ok' ? 'note-ok' : status.kind === 'warn' ? 'note-warn' : 'note-bad'}`}>
              <span>{status.text}</span>
              <button onClick={() => setStatus(null)} className="ml-2 opacity-60 hover:opacity-100" aria-label="ปิด">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
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
          apiRef={chartApi}
        />
        {(loading || loadingOlder) && (
          <div className="pointer-events-none absolute bottom-10 left-3 rounded-md bg-panel/90 px-2 py-1 text-xs text-muted shadow">
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
          onSaveJournal={() => void saveJournal()}
          savingJournal={savingJournal}
        />
      )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 border-t border-line bg-panel px-4 py-1 text-xs text-faint">
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

      <SymbolSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        currentSymbol={symbol}
        symbols={symbols}
        onSelectSymbol={(sym) => update({ symbol: sym })}
        onSymbolAdded={async () => {
          await refreshSymbols();
        }}
      />

      <StockSummaryModal
        isOpen={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        symbol={symbol}
        summary={summaryData?.summary ?? null}
        fundamentals={summaryData?.fundamentals ?? null}
      />
    </div>
  );
}
