import { useEffect, useRef } from 'react';
import { ColorType, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { EquityPoint } from '@zonedee/core';
import { toChartTime } from '../chartTime';
import { CHART_PALETTE, FONT, useTheme } from '../theme';

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
  const pal = CHART_PALETTE[useTheme()];

  useEffect(() => {
    const chart = createChart(boxRef.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: pal.text, fontSize: 11, fontFamily: FONT, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScale: { mouseWheel: false },
    });
    inRef.current = chart.addSeries(LineSeries, { color: '#6ea8fe', lineWidth: 2, priceLineVisible: false });
    outRef.current = chart.addSeries(LineSeries, { color: '#f5b94a', lineWidth: 2, priceLineVisible: false });
    chartRef.current = chart;
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- สีอัปเดตใน effect ด้านล่าง
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ layout: { textColor: pal.text }, grid: { horzLines: { color: pal.grid } } });
  }, [pal]);

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
