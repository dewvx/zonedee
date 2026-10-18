import { useEffect, useMemo, useState } from 'react';
import { SCAN_DEFAULTS, type ScanOptions, type ScanSignal, type Timeframe } from '@zonedee/core';
import { addUserSymbol, fetchScanSources, runScan, type ScanResponse, type ScanSource } from '../api';
import { inputCls } from '../components/ParamForm';
import { formatThaiTime } from '../format';

interface ScanSettings {
  source: string;
  custom: string;
  count: number;
  options: ScanOptions;
  onlyPass: boolean;
  onlySignals: boolean;
}

const KEY = 'zonedee:scanner';
const DEFAULT: ScanSettings = {
  source: 'small_cap_gainers',
  custom: 'SOFI, PLTR, RIVN, MARA, RIOT',
  count: 25,
  options: SCAN_DEFAULTS,
  onlyPass: true,
  onlySignals: false,
};
function load(): ScanSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScanSettings>;
    return { ...DEFAULT, ...s, options: { ...SCAN_DEFAULTS, ...s.options } };
  } catch {
    return DEFAULT;
  }
}

const SIGNAL_LABEL: Record<ScanSignal, { text: string; cls: string; help: string }> = {
  volume: { text: 'Vol พุ่ง', cls: 'bg-amber-900/60 text-amber-200', help: 'volume วันนี้ ≥ เกณฑ์ × ค่าเฉลี่ย' },
  gap: { text: 'Gap', cls: 'bg-purple-900/60 text-purple-200', help: 'เปิดกระโดดจากราคาปิดเมื่อวาน' },
  breakout: { text: 'ทะลุกรอบ', cls: 'bg-emerald-900/60 text-emerald-200', help: 'ปิดเหนือ high ของ N วันก่อน' },
  bos: { text: 'BOS ขึ้น', cls: 'bg-blue-900/60 text-blue-200', help: 'เบรกโครงสร้างขาขึ้นใน 3 แท่งล่าสุด' },
};

const money = (v: number | null) =>
  v === null ? '-' : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

export default function ScannerView({ onOpenChart }: { onOpenChart?: (symbol: string, tf: Timeframe) => void }) {
  const [s, setS] = useState<ScanSettings>(load);
  const update = (patch: Partial<ScanSettings>) => setS((c) => ({ ...c, ...patch }));
  const setOpt = (k: keyof ScanOptions, v: number) => setS((c) => ({ ...c, options: { ...c.options, [k]: v } }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ไม่เป็นไร */
    }
  }, [s]);

  const [sources, setSources] = useState<ScanSource[]>([]);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    void fetchScanSources().then(setSources).catch((e: Error) => setError(e.message));
  }, []);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(
        await runScan({
          source: s.source,
          symbols: s.source === 'custom' ? s.custom.split(/[\s,]+/) : undefined,
          count: s.count,
          options: s.options,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const open = async (symbol: string, name: string) => {
    setOpening(symbol);
    setError(null);
    try {
      await addUserSymbol(symbol, name);
      onOpenChart?.(symbol, 'D1');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(null);
    }
  };

  const rows = useMemo(
    () =>
      (result?.rows ?? []).filter(
        (r) => !r.scan || ((!s.onlyPass || r.scan.passes) && (!s.onlySignals || r.scan.signals.length > 0)),
      ),
    [result, s.onlyPass, s.onlySignals],
  );
  const hidden = (result?.rows.length ?? 0) - rows.length;
  const o = s.options;
  const num = (k: keyof ScanOptions, label: string, step = 1, help?: string) => (
    <label className="block" title={help}>
      <span className="mb-0.5 block text-[11px] text-slate-400">{label}</span>
      <input type="number" step={step} value={o[k]} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setOpt(k, e.target.valueAsNumber)} className={`${inputCls} font-mono`} />
    </label>
  );

  return (
    <div className="flex h-full min-w-0">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-line bg-panel p-3 text-xs">
        <h2 className="text-sm font-semibold text-white">สแกนหุ้นซิ่ง US</h2>
        <p className="mt-1 leading-relaxed text-slate-400">คัดหุ้นที่ "มีอะไรเกิดขึ้น" วันนี้ (volume พุ่ง, gap, ทะลุกรอบ) จากแท่ง D1 ของ Yahoo แล้วกดดูกราฟต่อ</p>

        <label className="mt-3 block">
          <span className="mb-0.5 block text-[11px] text-slate-400">รายชื่อจาก</span>
          <select value={s.source} onChange={(e) => update({ source: e.target.value })} className={inputCls}>
            {sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        {s.source === 'custom' ? (
          <label className="mt-2 block">
            <span className="mb-0.5 block text-[11px] text-slate-400">ticker (คั่นด้วย , หรือเว้นวรรค)</span>
            <textarea rows={3} value={s.custom} onChange={(e) => update({ custom: e.target.value })} className={`${inputCls} font-mono`} />
          </label>
        ) : (
          s.source !== 'watchlist' && (
            <label className="mt-2 block">
              <span className="mb-0.5 block text-[11px] text-slate-400">จำนวน</span>
              <input type="number" min={5} max={100} value={s.count} onChange={(e) => update({ count: Math.min(100, Math.max(5, e.target.valueAsNumber || 25)) })} className={`${inputCls} font-mono`} />
            </label>
          )
        )}

        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-medium text-slate-300">สัญญาณ</div>
          <div className="grid grid-cols-2 gap-2">
            {num('minRelVolume', 'Vol ≥ กี่เท่า', 0.5, 'volume วันนี้เทียบค่าเฉลี่ย')}
            {num('volLookback', 'เฉลี่ยกี่วัน')}
            {num('minGapPct', 'Gap ≥ %', 0.5)}
            {num('breakoutLookback', 'ทะลุ high กี่วัน')}
          </div>
          <div className="mb-2 mt-3 text-[11px] font-medium text-slate-300">ตัวกรอง</div>
          <div className="grid grid-cols-2 gap-2">
            {num('minPrice', 'ราคาต่ำสุด $', 0.1)}
            {num('maxPrice', 'ราคาสูงสุด $', 1)}
            <label className="col-span-2 block" title="มูลค่าซื้อขายเฉลี่ยต่อวัน — กันหุ้นที่ซื้อขายน้อยจนเข้าออกลำบาก">
              <span className="mb-0.5 block text-[11px] text-slate-400">มูลค่าซื้อขาย/วัน ขั้นต่ำ (ล้าน $)</span>
              <input
                type="number"
                step={0.5}
                value={o.minAvgDollarVolume / 1e6}
                onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setOpt('minAvgDollarVolume', e.target.valueAsNumber * 1e6)}
                className={`${inputCls} font-mono`}
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={s.onlyPass} onChange={(e) => update({ onlyPass: e.target.checked })} className="accent-blue-500" />
            ซ่อนตัวที่ไม่ผ่านตัวกรอง
          </label>
          <label className="mt-1 flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={s.onlySignals} onChange={(e) => update({ onlySignals: e.target.checked })} className="accent-blue-500" />
            เฉพาะตัวที่มีสัญญาณ
          </label>
          <button onClick={() => update({ options: SCAN_DEFAULTS })} className="mt-1 text-[11px] text-slate-500 underline hover:text-slate-300">
            คืนค่าเริ่มต้น
          </button>
        </div>

        <button onClick={() => void run()} disabled={running} className="mt-3 w-full rounded-md bg-blue-600 py-1.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
          {running ? 'กำลังสแกน…' : '🔎 สแกน'}
        </button>
        <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
          ข้อมูล Yahoo Finance (API ไม่ทางการ ราคาอาจช้ากว่าจริง) · ระหว่างตลาดเปิด แท่งวันนี้ยังไม่จบ volume จะยังไม่ครบวัน · หุ้นเล็กผันผวนสูง ใช้เพื่อคัดกรองเท่านั้น
        </p>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-4 text-xs">
        {error && <div className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-red-300">{error}</div>}
        {result?.error && <div className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-amber-300">{result.error}</div>}
        {!result && !error && (
          <div className="mx-auto mt-16 max-w-md text-center text-sm leading-relaxed text-slate-400">
            <p className="text-base text-slate-200">เลือกรายชื่อแล้วกด 🔎 สแกน</p>
            <p className="mt-2">ตัวที่ได้คะแนนสูง = มีหลายสัญญาณพร้อมกัน (volume พุ่ง + ทะลุกรอบ + gap) — คลิก "กราฟ" เพื่อดู D1 พร้อมโซน/โครงสร้าง</p>
          </div>
        )}
        {result && (
          <>
            <div className="mb-2 text-[11px] text-slate-500">
              สแกน {result.rows.length} ตัว เมื่อ {formatThaiTime(result.scannedAt, false)}
              {hidden > 0 && ` · ซ่อน ${hidden} ตัวที่ไม่ผ่านตัวกรอง`}
            </div>
            <table className="w-full">
              <thead className="text-left text-[10px] text-slate-500">
                <tr>
                  <th className="pb-1 font-normal">หุ้น</th>
                  <th className="pb-1 text-right font-normal">ราคา</th>
                  <th className="pb-1 text-right font-normal">วันนี้</th>
                  <th className="pb-1 text-right font-normal">Gap</th>
                  <th className="pb-1 text-right font-normal" title="volume วันนี้ ÷ ค่าเฉลี่ย">Vol ×</th>
                  <th className="pb-1 text-right font-normal">$ ต่อวัน</th>
                  <th className="pb-1 text-right font-normal">Mkt cap</th>
                  <th className="pb-1 text-right font-normal" title="ห่างจาก high ของ N วันก่อน">จาก high</th>
                  <th className="pb-1 pl-3 font-normal">สัญญาณ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className={`border-t border-line/60 ${r.scan && !r.scan.passes ? 'opacity-50' : ''}`}>
                    <td className="py-1.5">
                      <span className="font-mono font-semibold text-white">{r.symbol}</span>{' '}
                      <span className="text-[10px] text-slate-500">{r.name !== r.symbol ? r.name : ''}</span>
                    </td>
                    {r.scan ? (
                      <>
                        <td className="text-right font-mono">{r.scan.close.toFixed(2)}</td>
                        <td className={`text-right font-mono ${r.scan.changePct >= 0 ? 'text-bull' : 'text-bear'}`}>{pct(r.scan.changePct)}</td>
                        <td className="text-right font-mono text-slate-400">{pct(r.scan.gapPct)}</td>
                        <td className={`text-right font-mono ${r.scan.relVolume >= o.minRelVolume ? 'text-amber-300' : ''}`}>{r.scan.relVolume.toFixed(1)}</td>
                        <td className="text-right font-mono text-slate-400">{money(r.scan.avgDollarVolume)}</td>
                        <td className="text-right font-mono text-slate-400">{money(r.marketCap)}</td>
                        <td className="text-right font-mono text-slate-400">{pct(r.scan.fromPriorHighPct)}</td>
                        <td className="pl-3">
                          <span className="flex flex-wrap gap-1">
                            {r.scan.signals.map((sig) => (
                              <span key={sig} title={SIGNAL_LABEL[sig].help} className={`rounded px-1.5 py-0.5 text-[10px] ${SIGNAL_LABEL[sig].cls}`}>
                                {SIGNAL_LABEL[sig].text}
                              </span>
                            ))}
                          </span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={8} className="text-[11px] text-slate-500">
                        {r.error ? `ดึงข้อมูลไม่ได้: ${r.error}` : 'ข้อมูลไม่พอ'}
                      </td>
                    )}
                    <td className="text-right">
                      <button
                        onClick={() => void open(r.symbol, r.name)}
                        disabled={opening !== null}
                        className="rounded border border-line px-2 py-0.5 text-slate-300 hover:bg-line disabled:opacity-50"
                      >
                        {opening === r.symbol ? 'กำลังเพิ่ม…' : 'กราฟ'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    </div>
  );
}
