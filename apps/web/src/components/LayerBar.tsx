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
    <button onClick={onClick} title={title} aria-pressed={active} className="chip">
      <span
        className="inline-block h-2 w-2 rounded-full transition-opacity"
        style={{ background: swatch, opacity: active ? 1 : 0.35 }}
      />
      {children}
      {active && count !== undefined && <span className="tabular-nums text-xs text-muted">{count}</span>}
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
        swatch="#d99a1e"
        count={counts.bos}
        title="BOS = ทะลุ swing ตามเทรนด์ (เส้นประ) · CHoCH/MSS = ทะลุสวนเทรนด์ (สีส้ม)"
      >
        BOS / CHoCH
      </LayerPill>
      <LayerPill
        active={layers.bo}
        onClick={() => onToggle('bo')}
        swatch="#20a874"
        count={counts.bo + (layers.boHtf ? counts.boHtf : 0)}
        title="กรอบ Bo buy (เขียว) / Bo sell (แดง) ของ Braron: จาก swing ที่ถูกเบรก ถึงฐานที่ส่งราคาไปเบรก · เส้นประ = ราคากลับมาแตะแล้ว"
      >
        กรอบ Bo
      </LayerPill>
      {layers.bo && htfs.length > 0 && (
        <button
          onClick={() => onToggle('boHtf')}
          aria-pressed={layers.boHtf}
          title="แสดงกรอบ Bo ของ TF ใหญ่ในชุดของ Braron ด้วย (กรอบเส้นประ)"
          className="chip -ml-1"
        >
          + {htfs.join(', ')}
        </button>
      )}
      <LayerPill
        active={layers.fvg}
        onClick={() => onToggle('fvg')}
        swatch="#4c84f0"
        count={counts.fvg}
        title="Fair Value Gap ที่ยังไม่ถูกปิด (ฟ้า = ขาขึ้น, ม่วง = ขาลง · เส้นประ = ปิดไปบางส่วน)"
      >
        FVG
      </LayerPill>
      <LayerPill
        active={layers.ob}
        onClick={() => onToggle('ob')}
        swatch="#16aaa0"
        count={counts.ob}
        title="Order Block ที่ยังไม่ถูกทะลุ (เขียวอมฟ้า = ฝั่งซื้อ, ส้ม = ฝั่งขาย)"
      >
        OB
      </LayerPill>
      <LayerPill
        active={layers.sweep}
        onClick={() => onToggle('sweep')}
        swatch="#d99a1e"
        count={counts.sweep}
        title="Liquidity sweep: ไส้ทะลุ swing แต่ปิดกลับเข้ามา"
      >
        Sweep
      </LayerPill>
    </>
  );
}
