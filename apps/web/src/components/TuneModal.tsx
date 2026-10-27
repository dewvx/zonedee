import { useEffect, useMemo, useState } from 'react';
import { getDefaultTuningGrid, type TuningGrid } from '@zonedee/core';
import { Icon } from './Icon';
import { Note } from './ui';

export interface ParamSpecSummary {
  key: string;
  label: string;
  default: any;
  type: string;
}

interface TuneModalProps {
  isOpen: boolean;
  onClose: () => void;
  strategyId: string;
  strategyName: string;
  symbol: string;
  tf: string;
  availableParams: ParamSpecSummary[];
  onRun: (grid: TuningGrid, baselineRuns: number) => Promise<void>;
  running: boolean;
}

function parseCandidateValues(text: string): (string | number | boolean)[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const lower = s.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      const num = Number(s);
      return !isNaN(num) && s !== '' ? num : s;
    });
}

function initGridFromDefaults(stratId: string): Record<string, string> {
  const def = getDefaultTuningGrid(stratId);
  const out: Record<string, string> = {};
  for (const [k, vals] of Object.entries(def)) {
    out[k] = vals.join(', ');
  }
  return out;
}

export function TuneModal({
  isOpen,
  onClose,
  strategyId,
  strategyName,
  symbol,
  tf,
  availableParams,
  onRun,
  running,
}: TuneModalProps) {
  const [gridText, setGridText] = useState<Record<string, string>>(() => initGridFromDefaults(strategyId));
  const [baselineRuns, setBaselineRuns] = useState<number>(50);
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // เมื่อเปลี่ยนท่าหรือเปิด modal ให้โหลดค่าเริ่มต้น
  useEffect(() => {
    if (isOpen) {
      setGridText(initGridFromDefaults(strategyId));
      setError(null);
      setSelectedToAdd('');
    }
  }, [isOpen, strategyId]);

  // คำนวณจำนวนชุดค่าผสม
  const parsedGrid = useMemo(() => {
    const grid: TuningGrid = {};
    for (const [k, txt] of Object.entries(gridText)) {
      const vals = parseCandidateValues(txt);
      if (vals.length > 0) {
        grid[k] = vals;
      }
    }
    return grid;
  }, [gridText]);

  const totalCombinations = useMemo(() => {
    const keys = Object.keys(parsedGrid);
    if (keys.length === 0) return 0;
    return keys.reduce((acc, k) => acc * (parsedGrid[k]?.length ?? 1), 1);
  }, [parsedGrid]);

  // พารามิเตอร์ของกลยุทธ์ที่ยังไม่ได้เพิ่มใน grid
  const unselectedParams = useMemo(() => {
    return availableParams.filter((p) => !(p.key in gridText));
  }, [availableParams, gridText]);

  if (!isOpen) return null;

  const handleUpdateKey = (key: string, val: string) => {
    setGridText((prev) => ({ ...prev, [key]: val }));
  };

  const handleRemoveKey = (key: string) => {
    setGridText((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAddParam = () => {
    if (!selectedToAdd) return;
    const p = availableParams.find((x) => x.key === selectedToAdd);
    const defaultVal = p?.default !== undefined ? String(p.default) : '1';
    setGridText((prev) => ({ ...prev, [selectedToAdd]: defaultVal }));
    setSelectedToAdd('');
  };

  const handleResetDefaults = () => {
    setGridText(initGridFromDefaults(strategyId));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalCombinations === 0) {
      setError('กรุณากำหนดค่าอย่างน้อย 1 ตัวแปร');
      return;
    }
    setError(null);
    try {
      await onRun(parsedGrid, baselineRuns);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const getParamLabel = (k: string) => {
    if (k === 'swingLength') return 'swing (แท่ง D1)';
    if (k === 'breakBy') return 'ทะลุ (close / wick)';
    if (k === 'rr') return 'Risk:Reward (RR)';
    const spec = availableParams.find((p) => p.key === k);
    return spec?.label ? `${spec.label} (${k})` : k;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-12 backdrop-blur-[2px] sm:pt-16"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* หัว modal */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon name="sliders" size={17} className="text-accent" />
              <h2 className="text-[15px] font-semibold text-fg">จูนพารามิเตอร์อัตโนมัติ (Grid Search)</h2>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {strategyName} · {symbol} {tf}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
            title="ปิด"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* เนื้อหาฟอร์ม */}
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <Note kind="ok">
              ระบบจะทดสอบทุกชุดค่าผสม (Cartesian Product) หาชุดที่กำไรดีที่สุดทั้ง in-sample และ out-of-sample
              พร้อมวัดความได้เปรียบทางสถิติเทียบกับการสุ่ม (Random Baseline) ใน 8 อันดับแรก
            </Note>

            {error && <Note kind="bad">{error}</Note>}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-fg">ตัวแปรและช่วงค่าที่ต้องการทดสอบ</span>
                <span className="text-[11px] text-muted">พิมพ์คั่นด้วยเครื่องหมายจุลภาค (,)</span>
              </div>

              <div className="space-y-2.5">
                {Object.entries(gridText).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 rounded-lg border border-line bg-field/60 p-2.5">
                    <div className="w-44 shrink-0">
                      <span className="block text-xs font-medium text-fg">{getParamLabel(key)}</span>
                      <span className="text-[11px] text-faint">{key}</span>
                    </div>
                    <input
                      type="text"
                      value={val}
                      onChange={(e) => handleUpdateKey(key, e.target.value)}
                      placeholder="เช่น 2, 3, 5"
                      className="field flex-1 font-mono text-xs tabular-nums"
                      disabled={running}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveKey(key)}
                      disabled={running || Object.keys(gridText).length <= 1}
                      className="rounded p-1 text-muted hover:bg-hover hover:text-bad disabled:opacity-30"
                      title="ลบตัวแปรนี้ออกจากการค้นหา"
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* เพิ่มตัวแปรเสริมจากกลยุทธ์ */}
            {unselectedParams.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={selectedToAdd}
                  onChange={(e) => setSelectedToAdd(e.target.value)}
                  className="field max-w-xs text-xs"
                  disabled={running}
                >
                  <option value="">+ เพิ่มตัวแปรอื่นของท่านี้...</option>
                  {unselectedParams.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} ({p.key})
                    </option>
                  ))}
                </select>
                {selectedToAdd && (
                  <button type="button" onClick={handleAddParam} className="btn btn-sm" disabled={running}>
                    เพิ่ม
                  </button>
                )}
              </div>
            )}

            {/* ตั้งค่า Random Baseline */}
            <div className="border-t border-line pt-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">รอบสุ่ม Random Baseline (Top 8)</label>
                  <select
                    value={baselineRuns}
                    onChange={(e) => setBaselineRuns(Number(e.target.value))}
                    className="field text-xs"
                    disabled={running}
                  >
                    <option value={0}>ปิด (ไม่สุ่ม)</option>
                    <option value={50}>50 รอบ (เร็วและแม่นยำ)</option>
                    <option value={100}>100 รอบ (แม่นยำสูง)</option>
                    <option value={200}>200 รอบ (ละเอียดสูงสุด)</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                  <div className="rounded-lg border border-line bg-panel p-2 text-xs">
                    <span className="text-muted">ชุดค่าผสมทั้งหมด: </span>
                    <span className="font-semibold tabular-nums text-fg">{totalCombinations} ชุด</span>
                    {totalCombinations > 150 && (
                      <span className="ml-1.5 text-warn text-[11px]">(ค่อนข้างเยอะ อาจใช้เวลาเพิ่มขึ้น)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ท้าย modal */}
          <div className="flex items-center justify-between border-t border-line bg-panel px-5 py-3.5">
            <button
              type="button"
              onClick={handleResetDefaults}
              disabled={running}
              className="text-xs text-muted hover:text-fg hover:underline disabled:opacity-40"
            >
              คืนค่าเริ่มต้นของระบบ
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} disabled={running} className="btn">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={running || totalCombinations === 0}
                className="btn btn-primary min-w-36"
              >
                {running ? (
                  <>
                    <Icon name="refresh" size={14} className="animate-spin" />
                    กำลังประมวลผล…
                  </>
                ) : (
                  <>
                    <Icon name="sliders" size={14} />
                    เริ่มค้นหา ({totalCombinations} ชุด)
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
