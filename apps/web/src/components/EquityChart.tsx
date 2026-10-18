import { useEffect, useRef } from 'react';
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { EquityPoint } from '@zonedee/core';
import { toChartTime } from '../chartTime';

interface Props {
  points: EquityPoint[];
  /** เวลาที่เริ่ม out-of-sample (วาดสีต่าง) */
  splitTime: number | null;
  mode: 'r' | 'balance';
}

/** เส้น equity ของ backtest — in-sample สีฟ้า · out-of-sample สีเหลือง */
export function EquityChart({ points, splitTime, mode }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const inRef = useRef<ISeriesApi<'Line'> | null>(null);
  const outRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const chart = createChart(boxRef.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { color: '#1a1f2b' }, horzLines: { color: '#1a1f2b' } },
      rightPriceScale: { borderColor: '#232937' },
      timeScale: { borderColor: '#232937', timeVisible: true },
      handleScale: { mouseWheel: false },
    });
    inRef.current = chart.addSeries(LineSeries, { color: '#60a5fa', lineWidth: 2, priceLineVisible: false });
    outRef.current = chart.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 2, priceLineVisible: false });
    chartRef.current = chart;
    return () => chart.remove();
  }, []);

  useEffect(() => {
    // เวลาซ้ำ (หลายเทรดปิดแท่งเดียวกัน) → เลื่อนทีละ 1 วินาที ให้ Lightweight Charts รับได้
    let lastT = -Infinity;
    const data = points.map((p) => {
      let t = toChartTime(p.time) as number;
      if (t <= lastT) t = lastT + 1;
      lastT = t;
      return { time: t as UTCTimestamp, value: mode === 'r' ? p.r : p.balance, raw: p.time };
    });
    const k = splitTime === null ? data.length : data.findIndex((d) => d.raw >= splitTime);
    const cut = k < 0 ? data.length : k;
    const strip = ({ time, value }: { time: UTCTimestamp; value: number }) => ({ time, value });
    inRef.current?.setData(data.slice(0, cut).map(strip));
    // จุดเชื่อมให้เส้นต่อกัน
    outRef.current?.setData(data.slice(Math.max(0, cut - 1)).map(strip).filter(() => cut < data.length));
    inRef.current?.applyOptions({ priceFormat: { type: 'price', precision: mode === 'r' ? 1 : 0, minMove: mode === 'r' ? 0.1 : 1 } });
    chartRef.current?.timeScale().fitContent();
  }, [points, splitTime, mode]);

  return <div ref={boxRef} className="h-full w-full" />;
}
