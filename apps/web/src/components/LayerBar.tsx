import type { ReactNode } from 'react';
import type { LayerToggles } from '../overlays';

interface PillProps {
  active: boolean;
  onClick: () => void;
  /** สีจุดหน้าปุ่ม = สีที่ใช้วาดบนกราฟ */
  swatch: string;
  count?: number;
  title: string;
  children: ReactNode;
}

export function LayerPill({ active, onClick, swatch, count, title, children }: PillProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? 'border-slate-500 bg-line text-white'
          : 'border-line text-slate-500 hover:border-slate-600 hover:text-slate-300'
      }`}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: active ? swatch : '#475569' }} />
      {children}
      {active && count !== undefined && <span className="font-mono text-[10px] text-slate-400">{count}</span>}
    </button>
  );
}

interface Props {
  layers: LayerToggles;
  counts: Record<keyof LayerToggles, number>;
  onToggle: (key: keyof LayerToggles) => void;
  /** TF ใหญ่ที่จะแสดงกรอบ Bo ด้วย (ว่าง = TF นี้ไม่มีชุดของ Braron) */
  htfs: string[];
}

/** ปุ่มเปิดปิดชั้นโครงสร้างราคา (Phase 4) */
export function LayerBar({ layers, counts, onToggle, htfs }: Props) {
  return (
    <>
      <LayerPill
        active={layers.bos}
        onClick={() => onToggle('bos')}
        swatch="#f59e0b"
        count={counts.bos}
        title="BOS = ทะลุ swing ตามเทรนด์ (เส้นประ) · CHoCH/MSS = ทะลุสวนเทรนด์ (สีส้ม)"
      >
        BOS / CHoCH
      </LayerPill>
      <LayerPill
        active={layers.bo}
        onClick={() => onToggle('bo')}
        swatch="#22c55e"
        count={counts.bo + (layers.boHtf ? counts.boHtf : 0)}
        title="กรอบ Bo buy (เขียว) / Bo sell (แดง) ของ Braron: จาก swing ที่ถูกเบรก ถึงฐานที่ส่งราคาไปเบรก · เส้นประ = ราคากลับมาแตะแล้ว"
      >
        กรอบ Bo
      </LayerPill>
      {layers.bo && htfs.length > 0 && (
        <label
          className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-400"
          title="แสดงกรอบ Bo ของ TF ใหญ่ในชุดของ Braron ด้วย (กรอบขอบหนา)"
        >
          <input
            type="checkbox"
            checked={layers.boHtf}
            onChange={() => onToggle('boHtf')}
            className="accent-blue-500"
          />
          + {htfs.join(', ')}
        </label>
      )}
      <LayerPill
        active={layers.fvg}
        onClick={() => onToggle('fvg')}
        swatch="#60a5fa"
        count={counts.fvg}
        title="Fair Value Gap ที่ยังไม่ถูกปิด (ฟ้า = ขาขึ้น, ม่วง = ขาลง · เส้นประ = ปิดไปบางส่วน)"
      >
        FVG
      </LayerPill>
      <LayerPill
        active={layers.ob}
        onClick={() => onToggle('ob')}
        swatch="#2dd4bf"
        count={counts.ob}
        title="Order Block ที่ยังไม่ถูกทะลุ (เขียวอมฟ้า = ฝั่งซื้อ, ส้ม = ฝั่งขาย)"
      >
        OB
      </LayerPill>
      <LayerPill
        active={layers.sweep}
        onClick={() => onToggle('sweep')}
        swatch="#f59e0b"
        count={counts.sweep}
        title="Liquidity sweep: ไส้ทะลุ swing แต่ปิดกลับเข้ามา"
      >
        Sweep
      </LayerPill>
    </>
  );
}
