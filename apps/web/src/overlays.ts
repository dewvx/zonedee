import type { SeriesMarker, Time } from 'lightweight-charts';
import {
  TIMEFRAME_MS,
  detectBoBoxes,
  detectFVGs,
  detectOrderBlocks,
  detectStructure,
  detectSweeps,
  isBucketClosed,
  resample,
  type Candle,
  type SwingPoint,
  type Timeframe,
  type Zone,
} from '@zonedee/core';
import { snapTime, toChartTime } from './chartTime';
import type { OverlayItem } from './components/OverlayPrimitive';

/** ชั้นที่เปิดปิดได้บนกราฟ */
export interface LayerToggles {
  bos: boolean;
  fvg: boolean;
  ob: boolean;
  sweep: boolean;
  bo: boolean;
  /** แสดงกรอบ Bo ของ TF ใหญ่ตามชุด TF ของ Braron ด้วย */
  boHtf: boolean;
}

export const DEFAULT_LAYERS: LayerToggles = { bos: true, fvg: false, ob: false, sweep: false, bo: true, boHtf: true };

/** จำนวนสูงสุดที่วาดต่อชั้น (ล่าสุดก่อน) กันกราฟรก */
const MAX = { bos: 10, fvg: 8, ob: 5, bo: 4, boHtf: 2, sweep: 20 };

/**
 * ชุด TF ของ Braron (หน้า 44): M30-M15-M5, H4-H1-M30, W1-D1-H4, M15-M5-M1
 * ดู TF เล็ก → แสดงกรอบของ TF กลางและ TF ใหญ่ในชุดนั้นด้วย
 */
export const BO_HTF: Partial<Record<Timeframe, Timeframe[]>> = {
  M1: ['M5', 'M15'],
  M5: ['M15', 'M30'],
  M15: ['M30'],
  M30: ['H1', 'H4'],
  H1: ['H4'],
  H4: ['D1', 'W1'],
  D1: ['W1'],
};

const C = {
  bull: '#22c55e',
  bear: '#ef4444',
  choch: '#f59e0b',
  zoneR: { fill: 'rgba(239, 68, 68, 0.08)', line: 'rgba(239, 68, 68, 0.5)', text: '#fca5a5' },
  zoneS: { fill: 'rgba(34, 197, 94, 0.08)', line: 'rgba(34, 197, 94, 0.5)', text: '#86efac' },
  fvgBull: { fill: 'rgba(96, 165, 250, 0.14)', line: 'rgba(96, 165, 250, 0.45)' },
  fvgBear: { fill: 'rgba(192, 132, 252, 0.14)', line: 'rgba(192, 132, 252, 0.45)' },
  obBull: { fill: 'rgba(45, 212, 191, 0.16)', line: 'rgba(45, 212, 191, 0.7)' },
  obBear: { fill: 'rgba(251, 146, 60, 0.16)', line: 'rgba(251, 146, 60, 0.7)' },
  boBull: { fill: 'rgba(34, 197, 94, 0.18)', line: 'rgba(34, 197, 94, 0.9)' },
  boBear: { fill: 'rgba(239, 68, 68, 0.18)', line: 'rgba(239, 68, 68, 0.9)' },
};

export interface BuildInput {
  candles: readonly Candle[];
  tf: Timeframe;
  swingLength: number;
  zones: Zone[];
  swings: SwingPoint[];
  layers: LayerToggles;
}

export interface BuildOutput {
  overlays: OverlayItem[];
  markers: SeriesMarker<Time>[];
  /** จำนวนที่วาดของแต่ละชั้น (โชว์บนปุ่ม) */
  counts: Record<keyof LayerToggles | 'zones', number>;
}

/** แปลงผลจาก core ทั้งหมด → สิ่งที่วาดบนกราฟ (เวลา snap เข้ากับแท่งจริงแล้ว) */
export function buildOverlays({ candles, tf, swingLength, zones, swings, layers }: BuildInput): BuildOutput {
  const overlays: OverlayItem[] = [];
  const markers: SeriesMarker<Time>[] = [];
  const counts = { zones: zones.length, bos: 0, fvg: 0, ob: 0, sweep: 0, bo: 0, boHtf: 0 };
  if (candles.length === 0) return { overlays, markers, counts };

  const t = (ms: number) => toChartTime(snapTime(candles, ms));
  const cfg = { swingLength };

  // โซนแนวรับต้าน (ล่างสุด)
  for (const z of zones) {
    const s = z.role === 'resistance' ? C.zoneR : C.zoneS;
    overlays.push({
      kind: 'box',
      start: t(z.startTime),
      end: null,
      top: z.top,
      bottom: z.bottom,
      fill: s.fill,
      stroke: s.line,
      dashed: z.state === 'flipped',
      label: `${z.label} ×${z.touches}${z.equalBodies ? ' ●' : ''}`,
      labelColor: s.text,
      labelPos: 'right',
    });
  }

  if (layers.fvg) {
    const fvgs = detectFVGs(candles, cfg).filter((f) => f.state !== 'filled').slice(-MAX.fvg);
    counts.fvg = fvgs.length;
    for (const f of fvgs) {
      const s = f.direction === 'bull' ? C.fvgBull : C.fvgBear;
      overlays.push({
        kind: 'box',
        start: t(f.startTime),
        end: null,
        top: f.top,
        bottom: f.bottom,
        fill: s.fill,
        stroke: s.line,
        dashed: f.state === 'partial',
        label: 'FVG',
        labelPos: 'left',
      });
    }
  }

  if (layers.ob) {
    const obs = detectOrderBlocks(candles, cfg).slice(-MAX.ob);
    counts.ob = obs.length;
    for (const o of obs) {
      const s = o.direction === 'bull' ? C.obBull : C.obBear;
      overlays.push({
        kind: 'box',
        start: t(o.startTime),
        end: null,
        top: o.top,
        bottom: o.bottom,
        fill: s.fill,
        stroke: s.line,
        dashed: o.state === 'tested',
        label: o.direction === 'bull' ? 'OB+' : 'OB−',
        labelPos: 'left',
      });
    }
  }

  if (layers.bo) {
    const add = (data: readonly Candle[], boxTf: Timeframe, max: number, htf: boolean) => {
      const boxes = detectBoBoxes(data, cfg).slice(-max);
      for (const b of boxes) {
        const s = b.direction === 'bull' ? C.boBull : C.boBear;
        overlays.push({
          kind: 'box',
          start: t(b.startTime),
          end: null,
          top: b.top,
          bottom: b.bottom,
          fill: htf ? s.fill.replace('0.18', '0.10') : s.fill,
          stroke: s.line,
          lineWidth: htf ? 2 : 1,
          dashed: b.state === 'tested',
          label: `Bo ${b.direction === 'bull' ? 'buy' : 'sell'} ${boxTf}`,
          labelPos: 'left',
        });
      }
      return boxes.length;
    };
    counts.bo = add(candles, tf, MAX.bo, false);
    if (layers.boHtf) {
      for (const htf of BO_HTF[tf] ?? []) {
        let htfCandles = resample(candles, htf);
        // แท่ง TF ใหญ่ล่าสุดที่ยังไม่ปิด ห้ามใช้ (กฎ no-look-ahead)
        const lastHtf = htfCandles.at(-1);
        const now = candles.at(-1)!.time + TIMEFRAME_MS[tf];
        if (lastHtf && !isBucketClosed(lastHtf.time, htf, now)) htfCandles = htfCandles.slice(0, -1);
        counts.boHtf += add(htfCandles, htf, MAX.boHtf, true);
      }
    }
  }

  if (layers.bos) {
    const events = detectStructure(candles, cfg).slice(-MAX.bos);
    counts.bos = events.length;
    for (const e of events) {
      const color = e.type === 'CHoCH' ? C.choch : e.direction === 'bull' ? C.bull : C.bear;
      overlays.push({
        kind: 'line',
        start: t(e.swingTime),
        end: t(e.breakTime),
        price: e.level,
        stroke: color,
        dashed: e.type === 'BOS',
        label: e.type,
        labelColor: color,
      });
    }
  }

  // markers ต้องเรียงตามเวลา
  if (swings.length > 0) {
    for (const s of swings) {
      markers.push({
        time: toChartTime(s.time),
        position: s.kind === 'high' ? 'aboveBar' : 'belowBar',
        shape: s.kind === 'high' ? 'arrowDown' : 'arrowUp',
        color: s.kind === 'high' ? 'rgba(252, 165, 165, 0.7)' : 'rgba(134, 239, 172, 0.7)',
        size: 0.6,
      });
    }
  }
  if (layers.sweep) {
    const sweeps = detectSweeps(candles, cfg).slice(-MAX.sweep);
    counts.sweep = sweeps.length;
    for (const s of sweeps) {
      markers.push({
        time: toChartTime(s.time),
        position: s.direction === 'bear' ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: C.choch,
        text: 'sweep',
        size: 0.7,
      });
    }
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));

  return { overlays, markers, counts };
}
