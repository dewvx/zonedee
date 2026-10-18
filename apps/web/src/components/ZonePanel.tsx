import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ZONE_SETTINGS, type ZoneSettings } from '../settings';
import { Icon } from './Icon';

interface Props {
  value: ZoneSettings;
  onChange: (patch: Partial<ZoneSettings>) => void;
  /** จำนวนโซนที่แสดงอยู่ (ไว้โชว์บนปุ่ม) */
  count: number;
}

function Slider(props: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-fg-2">{props.label}</span>
        <span className="tabular-nums text-fg">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1 w-full accent-accent"
      />
      <div className="text-[11px] leading-tight text-faint">{props.hint}</div>
    </label>
  );
}

/** ปุ่ม "แนวรับต้าน" + แผงตั้งค่า (ค่าทั้งหมดตรงกับ docs/rules.md) */
export function ZonePanel({ value, onChange, count }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => onChange({ show: !value.show })}
        aria-pressed={value.show}
        title="แนวรับแนวต้านอัตโนมัติ"
        className="chip rounded-r-none border-r-0 pr-2"
      >
        <span className="inline-flex gap-[2px]">
          <span className="h-2 w-1 rounded-sm bg-bear" style={{ opacity: value.show ? 0.9 : 0.35 }} />
          <span className="h-2 w-1 rounded-sm bg-bull" style={{ opacity: value.show ? 0.9 : 0.35 }} />
        </span>
        แนวรับต้าน
        {value.show && <span className="tabular-nums text-xs text-muted">{count}</span>}
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        className="chip rounded-l-none px-2"
        aria-label="ตั้งค่าแนวรับต้าน"
        title="ตั้งค่าแนวรับต้าน"
      >
        <Icon name="sliders" size={14} />
      </button>

      {open && (
        <div className="card absolute left-0 top-full z-20 mt-2 w-80 space-y-4 p-4" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <Slider
            label="Swing (แท่งซ้าย/ขวา)"
            hint="น้อย = เจอ swing เยอะ เส้นถี่ · มาก = เฉพาะยอด/ก้นสำคัญ (D1)"
            value={value.swingLength}
            min={1}
            max={10}
            step={1}
            onChange={(v) => onChange({ swingLength: v })}
          />
          <Slider
            label="รวมโซนที่ห่างกันไม่เกิน"
            hint="ระยะเป็นเท่าของ ATR(14) — มาก = โซนน้อยแต่กว้าง"
            value={value.zoneMergeAtr}
            min={0.1}
            max={1.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)} × ATR`}
            onChange={(v) => onChange({ zoneMergeAtr: v })}
          />
          <Slider
            label="แสดงสูงสุด"
            hint="เลือกโซนที่คะแนนสูงสุด (แตะบ่อย + ใหม่ + กลับขั้ว + เนื้อเท่ากัน)"
            value={value.maxZones}
            min={1}
            max={20}
            step={1}
            format={(v) => `${v} โซน`}
            onChange={(v) => onChange({ maxZones: v })}
          />
          <label className="flex cursor-pointer items-start gap-2 text-xs text-fg-2">
            <input
              type="checkbox"
              checked={value.ryuMode}
              onChange={(e) => onChange({ ryuMode: e.target.checked })}
              className="mt-0.5 accent-accent"
            />
            <span>
              โหมดริวเรน
              <span className="block text-[11px] text-faint">เอาเฉพาะโซนที่ยอด/ก้นมี "เนื้อเท่ากัน 2 แท่ง" (●)</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-2">
            <input
              type="checkbox"
              checked={value.showSwings}
              onChange={(e) => onChange({ showSwings: e.target.checked })}
              className="accent-accent"
            />
            แสดงจุด swing (▼ high / ▲ low)
          </label>
          <div className="flex items-center justify-between border-t border-line pt-2 text-[11px] text-faint">
            <span>R/S = ต้าน/รับ · RBS/SBR = กลับขั้ว (เส้นประ)</span>
            <button
              onClick={() => onChange({ ...DEFAULT_ZONE_SETTINGS, show: value.show })}
              className="text-accent hover:underline"
            >
              ค่าเริ่มต้น
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
