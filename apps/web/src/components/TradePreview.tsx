import { useEffect, useMemo, useState } from 'react';
import type { SeriesMarker, Time } from 'lightweight-charts';
import { TIMEFRAME_MS, type Candle, type Timeframe } from '@zonedee/core';
import { fetchCandles } from '../api';
import { snapTime, toChartTime } from '../chartTime';
import { fmtR, formatThaiTime } from '../format';
import { CandleChart } from './CandleChart';
import type { OverlayItem } from './OverlayPrimitive';

/** เทรดที่จะดู (ใช้ทั้งเทรดจาก backtest และ journal) */
export interface PreviewTrade {
  direction: 'long' | 'short';
  entryTime: number;
  exitTime: number | null;
  entry: number;
  sl: number;
  tp: number;
  exit: number | null;
  r: number | null;
  title: string;
  subtitle?: string;
}

interface Props {
  symbol: string;
  tf: Timeframe;
  digits: number;
  trade: PreviewTrade;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

const BARS_AFTER = 60;
const BARS_TOTAL = 400;

/** หน้าต่างดูเทรดบนกราฟจริง: กล่องกำไร/ขาดทุน + จุดเข้า/ออก */
export function TradePreview({ symbol, tf, digits, trade, onClose, onPrev, onNext }: Props) {
  const tfMs = TIMEFRAME_MS[tf];
  const endTime = trade.exitTime ?? trade.entryTime;
  const key = `${symbol}:${tf}:${trade.entryTime}`;
  // แท่งผูกกับ key ของเทรดที่โหลดมา (กันกราฟซูมผิดเทรดตอนกด ‹ ›)
  const [loaded, setLoaded] = useState<{ key: string; candles: Candle[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candles = loaded?.key === key ? loaded.candles : [];

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchCandles(symbol, tf, BARS_TOTAL, endTime + BARS_AFTER * tfMs)
      .then((r) => !cancelled && setLoaded({ key, candles: r.candles }))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [symbol, tf, endTime, tfMs, key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const view = useMemo(() => {
    if (candles.length === 0) return null;
    const start = toChartTime(snapTime(candles, trade.entryTime));
    // ยังไม่ปิด → ลากกล่องไปขอบขวา · เข้า-ออกแท่งเดียวกัน → กว้างอย่างน้อย 1 แท่งให้มองเห็น
    const exitIdx0 = candles.findIndex((c) => c.time >= endTime);
    const entryIdx0 = candles.findIndex((c) => c.time >= trade.entryTime);
    const endBar = candles[Math.min(candles.length - 1, Math.max(exitIdx0 < 0 ? candles.length - 1 : exitIdx0, entryIdx0 + 1))];
    const end = trade.exitTime === null ? null : toChartTime(endBar ? endBar.time : endTime);
    const exitMarkTime = toChartTime(snapTime(candles, endTime));
    const overlays: OverlayItem[] = [
      {
        kind: 'box', start, end,
        top: Math.max(trade.entry, trade.tp), bottom: Math.min(trade.entry, trade.tp),
        fill: 'rgba(34, 197, 94, 0.18)', stroke: 'rgba(34, 197, 94, 0.5)',
      },
      {
        kind: 'box', start, end,
        top: Math.max(trade.entry, trade.sl), bottom: Math.min(trade.entry, trade.sl),
        fill: 'rgba(239, 68, 68, 0.18)', stroke: 'rgba(239, 68, 68, 0.5)',
      },
    ];
    const long = trade.direction === 'long';
    const markers: SeriesMarker<Time>[] = [
      {
        time: start,
        position: long ? 'belowBar' : 'aboveBar',
        shape: long ? 'arrowUp' : 'arrowDown',
        color: long ? '#22c55e' : '#ef4444',
        text: long ? 'BUY' : 'SELL',
      },
    ];
    if (trade.exitTime !== null && trade.exit !== null) {
      markers.push({
        time: exitMarkTime,
        position: long ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: (trade.r ?? 0) >= 0 ? '#22c55e' : '#ef4444',
        text: trade.r !== null ? fmtR(trade.r) : 'ปิด',
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    const entryIdx = candles.findIndex((c) => c.time >= trade.entryTime);
    const exitIdx = candles.findIndex((c) => c.time >= endTime);
    const from = Math.max(0, (entryIdx < 0 ? candles.length : entryIdx) - 50);
    const to = (exitIdx < 0 ? candles.length - 1 : exitIdx) + 25;
    return { overlays, markers, focus: { from, to } };
  }, [candles, trade, endTime]);

  const fmt = (v: number) => v.toFixed(digits);
  const priceLines = [
    { id: 'entry', price: trade.entry, color: '#cbd5e1', title: `Entry ${fmt(trade.entry)}` },
    { id: 'sl', price: trade.sl, color: '#ef4444', title: `SL ${fmt(trade.sl)}` },
    { id: 'tp', price: trade.tp, color: '#22c55e', title: `TP ${fmt(trade.tp)}` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          <span className={`text-sm font-semibold ${trade.direction === 'long' ? 'text-bull' : 'text-bear'}`}>
            {trade.direction === 'long' ? 'BUY' : 'SELL'}
          </span>
          <span className="text-sm text-white">{trade.title}</span>
          <span className="truncate text-xs text-slate-400">
            {formatThaiTime(trade.entryTime)}
            {trade.subtitle ? ` · ${trade.subtitle}` : ''}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {onPrev && (
              <button onClick={onPrev} className="rounded px-2 py-0.5 text-slate-400 hover:bg-line hover:text-white" title="เทรดก่อนหน้า (←)">
                ‹
              </button>
            )}
            {onNext && (
              <button onClick={onNext} className="rounded px-2 py-0.5 text-slate-400 hover:bg-line hover:text-white" title="เทรดถัดไป (→)">
                ›
              </button>
            )}
            <button onClick={onClose} className="rounded px-2 py-0.5 text-slate-400 hover:bg-line hover:text-white" aria-label="ปิด">
              ✕
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {error ? (
            <div className="p-4 text-sm text-red-300">โหลดกราฟไม่ได้: {error}</div>
          ) : (
            <CandleChart
              candles={candles}
              digits={digits}
              emas={[]}
              resetKey={loaded?.key === key ? key : ''}
              overlays={view?.overlays}
              markers={view?.markers}
              priceLines={priceLines}
              focus={view?.focus}
            />
          )}
        </div>
      </div>
    </div>
  );
}
