import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

interface Common {
  /** เวลากราฟ (เลื่อนเป็นเวลาไทยแล้ว) ต้องเป็นเวลาที่มีแท่งอยู่จริง */
  start: Time;
  /** null = ลากไปถึงขอบขวา */
  end: Time | null;
  stroke: string;
  dashed?: boolean;
  label?: string;
  labelColor?: string;
}

export type OverlayItem =
  | (Common & {
      kind: 'box';
      top: number;
      bottom: number;
      fill: string;
      /** ตำแหน่งป้าย: right = ชิดขวา (โซน) · left = มุมซ้ายบน (กรอบ) */
      labelPos?: 'left' | 'right';
      lineWidth?: number;
    })
  | (Common & {
      kind: 'line';
      price: number;
      lineWidth?: number;
    });

/**
 * วาดกล่อง / เส้นแนวนอน / ป้าย บนกราฟ ผ่าน series primitive ของ Lightweight Charts
 * ใช้ร่วมกันทุกชั้น: โซนแนวรับต้าน, กรอบ Bo, FVG, OB, เส้น BOS/CHoCH
 */
export class OverlayPrimitive implements ISeriesPrimitive<Time> {
  private items: OverlayItem[] = [];
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;

  private readonly view: IPrimitivePaneView = {
    zOrder: () => 'bottom',
    renderer: () => ({ draw: (target) => this.draw(target) }),
  };

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart as IChartApi;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setItems(items: OverlayItem[]) {
    this.items = items;
    this.requestUpdate?.();
  }

  paneViews() {
    return [this.view];
  }

  private draw(target: DrawTarget) {
    const chart = this.chart;
    const series = this.series;
    if (!chart || !series || this.items.length === 0) return;
    const timeScale = chart.timeScale();

    target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      ctx.font = `${Math.round(11 * vr)}px Inter, "Noto Sans Thai", "Leelawadee UI", sans-serif`;
      ctx.textBaseline = 'middle';

      const xOf = (t: Time | null, fallback: number) => {
        if (t === null) return fallback;
        const x = timeScale.timeToCoordinate(t);
        return x === null ? null : Math.round(x * hr);
      };

      const label = (text: string, x: number, y: number, color: string, align: 'left' | 'right' | 'center') => {
        const tw = ctx.measureText(text).width;
        const tx = align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x;
        ctx.fillStyle = 'rgba(11, 14, 20, 0.75)';
        ctx.fillRect(tx - 3 * hr, y - 7 * vr, tw + 6 * hr, 14 * vr);
        ctx.fillStyle = color;
        ctx.fillText(text, tx, y);
      };

      for (const item of this.items) {
        const xs = xOf(item.start, 0);
        const xe = xOf(item.end, bitmapSize.width);
        if (xs === null || xe === null) continue;
        const x1 = Math.max(0, Math.min(xs, xe));
        const x2 = Math.min(bitmapSize.width, Math.max(xs, xe));
        if (x2 <= 0 || x1 >= bitmapSize.width) continue;

        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = Math.max(1, Math.round((item.lineWidth ?? 1) * hr));
        ctx.setLineDash(item.dashed ? [6 * hr, 4 * hr] : []);

        if (item.kind === 'box') {
          const yt = series.priceToCoordinate(item.top);
          const yb = series.priceToCoordinate(item.bottom);
          if (yt === null || yb === null) continue;
          const y1 = Math.round(Math.min(yt, yb) * vr);
          const y2 = Math.round(Math.max(yt, yb) * vr);
          const h = Math.max(1, y2 - y1);
          ctx.fillStyle = item.fill;
          ctx.fillRect(x1, y1, Math.max(1, x2 - x1), h);
          ctx.beginPath();
          ctx.moveTo(x1, y1 + 0.5);
          ctx.lineTo(x2, y1 + 0.5);
          ctx.moveTo(x1, y2 - 0.5);
          ctx.lineTo(x2, y2 - 0.5);
          ctx.stroke();
          if (item.label) {
            const color = item.labelColor ?? item.stroke;
            if (item.labelPos === 'left') label(item.label, x1 + 4 * hr, y1 + 8 * vr, color, 'left');
            else label(item.label, x2 - 100 * hr, y1 + h / 2, color, 'right');
          }
        } else {
          const y = series.priceToCoordinate(item.price);
          if (y === null) continue;
          const yy = Math.round(y * vr) + 0.5;
          ctx.beginPath();
          ctx.moveTo(x1, yy);
          ctx.lineTo(x2, yy);
          ctx.stroke();
          if (item.label) label(item.label, (x1 + x2) / 2, yy - 8 * vr, item.labelColor ?? item.stroke, 'center');
        }
      }
      ctx.restore();
    });
  }
}
