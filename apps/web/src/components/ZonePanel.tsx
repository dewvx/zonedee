import { useEffect, useRef, useState } from 'react';
import { DEFAULT_ZONE_SETTINGS, type ZoneSettings } from '../settings';

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
        <span className="text-slate-300">{props.label}</span>
        <span className="font-mono text-white">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1 w-full accent-blue-500"
      />
      <div className="text-[10px] leading-tight text-slate-500">{props.hint}</div>
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
    <div ref={ref} className="relative flex items-center gap-1.5">
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={value.show}
          onChange={(e) => onChange({ show: e.target.checked })}
          className="accent-blue-500"
        />
        แนวรับต้าน{value.show ? ` (${count})` : ''}
      </label>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded px-1 text-xs text-slate-400 hover:bg-line hover:text-white"
        aria-label="ตั้งค่าแนวรับต้าน"
        title="ตั้งค่าแนวรับต้าน"
      >
        ⚙
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-72 space-y-3 rounded-lg border border-line bg-panel p-3 shadow-xl">
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
          <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={value.ryuMode}
              onChange={(e) => onChange({ ryuMode: e.target.checked })}
              className="mt-0.5 accent-blue-500"
            />
            <span>
              โหมดริวเรน
              <span className="block text-[10px] text-slate-500">เอาเฉพาะโซนที่ยอด/ก้นมี "เนื้อเท่ากัน 2 แท่ง" (●)</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={value.showSwings}
              onChange={(e) => onChange({ showSwings: e.target.checked })}
              className="accent-blue-500"
            />
            แสดงจุด swing (▼ high / ▲ low)
          </label>
          <div className="flex items-center justify-between border-t border-line pt-2 text-[10px] text-slate-500">
            <span>R/S = ต้าน/รับ · RBS/SBR = กลับขั้ว (เส้นประ)</span>
            <button
              onClick={() => onChange({ ...DEFAULT_ZONE_SETTINGS, show: value.show })}
              className="text-blue-400 hover:underline"
            >
              ค่าเริ่มต้น
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
