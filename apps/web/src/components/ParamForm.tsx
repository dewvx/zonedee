import type { ParamSpec, ParamValue } from '@zonedee/core';

interface Props {
  specs: readonly ParamSpec[];
  values: Record<string, ParamValue>;
  onChange: (key: string, value: ParamValue) => void;
}

export const inputCls =
  'w-full rounded border border-line bg-surface px-2 py-1 text-xs text-white outline-none focus:border-blue-500';

/** ฟอร์มค่าของท่า สร้างจาก ParamSpec (ใช้ทั้ง backtest และแจ้งเตือน) */
export function ParamForm({ specs, values, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {specs.map((p) => {
        const v = values[p.key] ?? p.default;
        if (p.type === 'boolean') {
          return (
            <label key={p.key} title={p.help} className="col-span-2 flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(v)}
                onChange={(e) => onChange(p.key, e.target.checked)}
                className="accent-blue-500"
              />
              {p.label}
            </label>
          );
        }
        return (
          <label key={p.key} title={p.help} className={`block ${p.type === 'select' ? 'col-span-2' : ''}`}>
            <span className="mb-0.5 block text-[11px] text-slate-400">{p.label}</span>
            {p.type === 'select' ? (
              <select value={String(v)} onChange={(e) => onChange(p.key, e.target.value)} className={inputCls}>
                {p.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="number"
                value={Number(v)}
                min={p.min}
                max={p.max}
                step={p.step ?? 'any'}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (Number.isFinite(n)) onChange(p.key, n);
                }}
                className={`${inputCls} font-mono`}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
