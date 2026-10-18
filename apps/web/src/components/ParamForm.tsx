import type { ParamSpec, ParamValue } from '@zonedee/core';

interface Props {
  specs: readonly ParamSpec[];
  values: Record<string, ParamValue>;
  onChange: (key: string, value: ParamValue) => void;
}

export const inputCls =
  'field';

/** ฟอร์มค่าของท่า สร้างจาก ParamSpec (ใช้ทั้ง backtest และแจ้งเตือน) */
export function ParamForm({ specs, values, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {specs.map((p) => {
        const v = values[p.key] ?? p.default;
        if (p.type === 'boolean') {
          return (
            <label key={p.key} title={p.help} className="col-span-2 flex cursor-pointer items-center gap-2 text-xs text-fg-2">
              <input
                type="checkbox"
                checked={Boolean(v)}
                onChange={(e) => onChange(p.key, e.target.checked)}
                className="accent-accent"
              />
              {p.label}
            </label>
          );
        }
        return (
          <label key={p.key} title={p.help} className={`block ${p.type === 'select' ? 'col-span-2' : ''}`}>
            <span className="label">{p.label}</span>
            {p.type === 'select' ? (
              <select value={String(v)} onChange={(e) => onChange(p.key, e.target.value)} className="field">
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
                className="field tabular-nums"
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
