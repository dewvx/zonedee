import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IPriceLine,
  type ISeriesMarkersPluginApi,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { ema, type Candle } from '@zonedee/core';
import { fromChartTime, toChartTime } from '../chartTime';
import { OverlayPrimitive, type OverlayItem } from './OverlayPrimitive';

export interface EmaSetting {
  period: number;
  color: string;
}

interface Props {
  candles: Candle[];
  digits: number;
  emas: EmaSetting[];
  /** เปลี่ยนค่านี้ = เปลี่ยน symbol/TF → จัดมุมมองใหม่ (ไม่งั้นคงตำแหน่งที่ผู้ใช้เลื่อนไว้) */
  resetKey: string;
  /** แท่งสุดท้ายยังไม่ปิด → วาดจางลง */
  lastBarOpen?: boolean;
  /** เลื่อนกราฟจนใกล้แท่งซ้ายสุด → ให้ App โหลดแท่งเก่าเพิ่ม */
  onNearLeftEdge?: () => void;
  /** กล่อง/เส้นที่วาดทับกราฟ (โซน, กรอบ Bo, FVG, OB, BOS) — สร้างใน overlays.ts */
  overlays?: OverlayItem[];
  /** เครื่องหมายบนแท่ง (จุด swing, sweep) เรียงตามเวลาแล้ว */
  markers?: SeriesMarker<Time>[];
  /** เส้นราคาแนวนอนพร้อมป้ายบนแกนราคา (Entry / SL / TP ของเครื่องคิด lot) */
  priceLines?: ChartPriceLine[];
  /** คลิกบนกราฟ → ราคาตรงเคอร์เซอร์ + เวลาแท่ง (UTC ms) */
  onChartClick?: (price: number, time: number) => void;
  /** ลากเส้นที่ draggable → ราคาใหม่ */
  onLineDrag?: (id: string, price: number) => void;
}

export interface ChartPriceLine {
  id: string;
  price: number;
  color: string;
  title: string;
  draggable?: boolean;
  dashed?: boolean;
}

/** ระยะ (px) จากเส้นที่ถือว่าจับเส้นได้ */
const DRAG_HIT_PX = 6;

/** จำนวนแท่งที่แสดงตอนเปิด symbol/TF ใหม่ */
const INITIAL_VISIBLE_BARS = 180;
/** เหลือแท่งทางซ้ายน้อยกว่านี้ → ขอโหลดเพิ่ม */
const LOAD_MORE_THRESHOLD = 40;

const BULL = '#22c55e';
const BEAR = '#ef4444';
const BULL_OPEN = 'rgba(34, 197, 94, 0.45)';
const BEAR_OPEN = 'rgba(239, 68, 68, 0.45)';

export function CandleChart({
  candles,
  digits,
  emas,
  resetKey,
  lastBarOpen,
  onNearLeftEdge,
  overlays = [],
  markers = [],
  priceLines = [],
  onChartClick,
  onLineDrag,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const lastResetKeyRef = useRef<string | null>(null);
  const overlayRef = useRef<OverlayPrimitive | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const onNearLeftEdgeRef = useRef(onNearLeftEdge);
  onNearLeftEdgeRef.current = onNearLeftEdge;
  const onChartClickRef = useRef(onChartClick);
  onChartClickRef.current = onChartClick;
  const onLineDragRef = useRef(onLineDrag);
  onLineDragRef.current = onLineDrag;
  const linesRef = useRef<ChartPriceLine[]>(priceLines);
  linesRef.current = priceLines;
  const priceLineApisRef = useRef<IPriceLine[]>([]);
  const candlesRef = useRef(candles);
  candlesRef.current = candles;

  // สร้างกราฟครั้งเดียว
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#8b93a7',
        fontFamily: "'Inter', 'Noto Sans Thai', 'Leelawadee UI', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: '#161b25' },
        horzLines: { color: '#161b25' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#232937' },
      timeScale: { borderColor: '#232937', timeVisible: true, secondsVisible: false, rightOffset: 6 },
      localization: {
        // เวลาถูกเลื่อนเป็นเวลาไทยแล้วใน toChartTime → format แบบ UTC ห้ามเลื่อนซ้ำ
        timeFormatter: (t: number) =>
          new Date(t * 1000).toLocaleString('th-TH', {
            timeZone: 'UTC',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }),
      },
    });

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: BULL,
      downColor: BEAR,
      borderUpColor: BULL,
      borderDownColor: BEAR,
      wickUpColor: BULL,
      wickDownColor: BEAR,
    });
    chartRef.current = chart;

    const overlay = new OverlayPrimitive();
    candleSeriesRef.current.attachPrimitive(overlay);
    overlayRef.current = overlay;
    markersRef.current = createSeriesMarkers(candleSeriesRef.current, []);

    const onRange = (range: LogicalRange | null) => {
      if (range && range.from < LOAD_MORE_THRESHOLD) onNearLeftEdgeRef.current?.();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    // คลิก → ราคา/เวลา
    // ใช้ click ของ DOM เอง (click ของไลบรารีกลืนคลิกที่ 2 ที่ตามมาเร็วๆ เพราะนับเป็น double-click)
    // ข้ามคลิกที่จริงๆ คือการลากเลื่อนกราฟ (ขยับเกิน 4px) หรือการลากเส้น
    let suppressClickUntil = 0;
    let downAt: { x: number; y: number } | null = null;
    const onNativeDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onNativeClick = (e: MouseEvent) => {
      const series = candleSeriesRef.current;
      if (!series || Date.now() < suppressClickUntil) return;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x > chart.timeScale().width()) return; // คลิกบนแกนราคา
      const price = series.coordinateToPrice(y);
      if (price === null) return;
      const t = chart.timeScale().coordinateToTime(x);
      const time = t !== null ? fromChartTime(t as number) : candlesRef.current.at(-1)?.time;
      if (time !== undefined) onChartClickRef.current?.(price, time);
    };
    el.addEventListener('pointerdown', onNativeDown, true);
    el.addEventListener('click', onNativeClick);

    // ลากเส้น Entry/SL/TP: จับก่อนที่กราฟจะเอาไปใช้เลื่อน (capture phase + ปิด scroll ชั่วคราว)
    let dragging: string | null = null;
    const yOf = (e: PointerEvent) => e.clientY - el.getBoundingClientRect().top;
    const hitLine = (y: number) => {
      const series = candleSeriesRef.current;
      if (!series) return undefined;
      return linesRef.current.find((l) => {
        if (!l.draggable) return false;
        const ly = series.priceToCoordinate(l.price);
        return ly !== null && Math.abs(ly - y) <= DRAG_HIT_PX;
      });
    };
    const setCursor = (c: string) => {
      el.style.cursor = c;
      el.querySelectorAll('canvas').forEach((cv) => (cv.style.cursor = c));
    };
    const onDown = (e: PointerEvent) => {
      const line = hitLine(yOf(e));
      if (!line) return;
      dragging = line.id;
      e.preventDefault();
      e.stopPropagation();
      chart.applyOptions({ handleScroll: false, handleScale: false });
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const y = yOf(e);
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
        const price = candleSeriesRef.current?.coordinateToPrice(y);
        if (price != null) onLineDragRef.current?.(dragging, price);
        return;
      }
      setCursor(hitLine(y) ? 'ns-resize' : '');
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = null;
      suppressClickUntil = Date.now() + 300;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('pointerup', onUp, true);

    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('pointerup', onUp, true);
      el.removeEventListener('pointerdown', onNativeDown, true);
      el.removeEventListener('click', onNativeClick);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      priceLineApisRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = [];
      lastResetKeyRef.current = null;
      overlayRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // อัปเดตแท่งเทียน + EMA
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const isReset = lastResetKeyRef.current !== resetKey;
    // จำช่วงเวลาที่ผู้ใช้กำลังดูไว้ (กันกราฟกระโดดตอนโหลดแท่งเก่าเพิ่ม / อัปเดตแท่งล่าสุด)
    const keepRange = isReset ? null : chart.timeScale().getVisibleRange();

    series.applyOptions({
      priceFormat: { type: 'price', precision: digits, minMove: 1 / 10 ** digits },
    });
    series.setData(
      candles.map((c, i) => {
        const bar = { time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close };
        if (lastBarOpen && i === candles.length - 1) {
          const color = c.close >= c.open ? BULL_OPEN : BEAR_OPEN;
          return { ...bar, color, borderColor: color, wickColor: color };
        }
        return bar;
      }),
    );

    for (const s of emaSeriesRef.current) chart.removeSeries(s);
    const closes = candles.map((c) => c.close);
    emaSeriesRef.current = emas.map(({ period, color }) => {
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: `EMA ${period}`,
      });
      const values = ema(closes, period);
      line.setData(
        candles.flatMap((c, i) => {
          const v = values[i];
          return v == null ? [] : [{ time: toChartTime(c.time), value: v }];
        }),
      );
      return line;
    });

    if (candles.length === 0) return;
    if (isReset) {
      lastResetKeyRef.current = resetKey;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - INITIAL_VISIBLE_BARS),
        to: candles.length + 5,
      });
    } else if (keepRange) {
      chart.timeScale().setVisibleRange(keepRange);
    }
  }, [candles, digits, emas, resetKey, lastBarOpen]);

  // ชั้นที่วาดทับ (หลังตั้งข้อมูลแท่งแล้ว เพื่อให้หาพิกัดเวลาได้)
  useEffect(() => {
    overlayRef.current?.setItems(overlays);
    markersRef.current?.setMarkers(markers);
  }, [overlays, markers]);

  // เส้นราคา Entry / SL / TP (สร้างใหม่ทุกครั้งที่ค่าเปลี่ยน — มีไม่กี่เส้น)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const l of priceLineApisRef.current) series.removePriceLine(l);
    priceLineApisRef.current = priceLines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 2,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
  }, [priceLines]);

  return <div ref={containerRef} className="h-full w-full" />;
}
