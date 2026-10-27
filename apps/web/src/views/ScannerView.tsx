import { useEffect, useMemo, useState } from 'react';
import { SCAN_DEFAULTS, type ScanOptions, type ScanSignal, type Timeframe } from '@zonedee/core';
import { addUserSymbol, fetchScanSources, runScan, type ScanResponse, type ScanSource } from '../api';
import { formatThaiTime } from '../format';
import { Icon } from '../components/Icon';
import { Empty, Field, Note, Section, SidePanel } from '../components/ui';

interface ScanSettings {
  source: string;
  custom: string;
  count: number;
  options: ScanOptions;
  onlyPass: boolean;
  onlySignals: boolean;
  /** ต้องมีสัญญาณอย่างน้อย 1 ตัวในนี้ (ว่าง = ไม่กรอง) */
  want: ScanSignal[];
}

const KEY = 'zonedee:scanner';
const DEFAULT: ScanSettings = {
  source: 'small_cap_gainers',
  custom: 'SOFI, PLTR, RIVN, MARA, RIOT',
  count: 25,
  options: SCAN_DEFAULTS,
  onlyPass: true,
  onlySignals: false,
  want: [],
};

/** ชุดตั้งค่าสำเร็จรูป: หุ้นซิ่ง (เทรดสั้น) / หุ้นลงทุน (หาจังหวะตามแนวรับต้าน) */
const PRESETS: Record<'momentum' | 'invest', Partial<ScanSettings>> = {
  momentum: {
    source: 'small_cap_gainers',
    options: SCAN_DEFAULTS,
    want: [],
  },
  invest: {
    source: 'popular',
    options: { ...SCAN_DEFAULTS, minPrice: 1, maxPrice: 5000, minAvgDollarVolume: 20_000_000 },
    want: ['near-support', 'broke-resistance', 'broke-support'],
  },
};
function load(): ScanSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScanSettings>;
    return { ...DEFAULT, ...s, want: Array.isArray(s.want) ? s.want : [], options: { ...SCAN_DEFAULTS, ...s.options } };
  } catch {
    return DEFAULT;
  }
}

const SIGNAL_LABEL: Record<ScanSignal, { text: string; cls: string; help: string }> = {
  volume: { text: 'Vol พุ่ง', cls: 'bg-warn/15 text-warn', help: 'volume วันนี้ ≥ เกณฑ์ × ค่าเฉลี่ย' },
  gap: { text: 'Gap', cls: 'bg-violet/15 text-violet', help: 'เปิดกระโดดจากราคาปิดเมื่อวาน' },
  breakout: { text: 'ทะลุกรอบ', cls: 'bg-ok/15 text-ok', help: 'ปิดเหนือ high ของ N วันก่อน' },
  bos: { text: 'BOS ขึ้น', cls: 'bg-accent/15 text-accent', help: 'เบรกโครงสร้างขาขึ้นใน 3 แท่งล่าสุด' },
  'near-support': { text: 'ใกล้แนวรับ', cls: 'bg-accent/15 text-accent', help: 'ห่างแนวรับ D1 ไม่เกินเกณฑ์ %' },
  'broke-resistance': { text: 'ทะลุแนวต้าน', cls: 'bg-ok/15 text-ok', help: 'ปิดเหนือแนวต้าน D1 ภายใน 3 แท่ง' },
  'broke-support': { text: 'หลุดแนวรับ', cls: 'bg-bad/15 text-bad', help: 'ปิดใต้แนวรับ D1 ภายใน 3 แท่ง' },
};
const SIGNAL_ORDER: ScanSignal[] = ['volume', 'gap', 'breakout', 'bos', 'near-support', 'broke-resistance', 'broke-support'];

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
        (r) =>
          !r.scan ||
          ((!s.onlyPass || r.scan.passes) &&
            (!s.onlySignals || r.scan.signals.length > 0) &&
            (s.want.length === 0 || r.scan.signals.some((x) => s.want.includes(x)))),
      ),
    [result, s.onlyPass, s.onlySignals, s.want],
  );
  const hidden = (result?.rows.length ?? 0) - rows.length;
  const o = s.options;
  const num = (k: keyof ScanOptions, label: string, step = 1, help?: string) => (
    <label className="block" title={help}>
      <span className="label">{label}</span>
      <input type="number" step={step} value={o[k]} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setOpt(k, e.target.valueAsNumber)} className="field tabular-nums" />
    </label>
  );

  return (
    <div className="flex h-full min-w-0">
      <SidePanel
        footer={
          <>
            <button onClick={() => void run()} disabled={running} className="btn btn-primary w-full">
              <Icon name="scan" size={15} />
              {running ? 'กำลังสแกน…' : 'สแกน'}
            </button>
            <p className="text-xs leading-relaxed text-faint">
              ข้อมูล Yahoo Finance (ไม่ทางการ อาจช้ากว่าจริง) — ระหว่างตลาดเปิด volume วันนี้ยังไม่ครบวัน
            </p>
          </>
        }
      >
        <div>
          <h1 className="text-[15px] font-semibold leading-tight text-fg">สแกนหุ้น US</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted">คัดหุ้นที่มีอะไรเกิดขึ้นวันนี้ — volume พุ่ง, ทะลุกรอบ, ใกล้แนวรับ — แล้วกดดูกราฟต่อ</p>
          <div className="seg mt-3 w-full">
            <button className="flex-1" aria-pressed={s.source !== 'popular' && s.want.length === 0} onClick={() => update(PRESETS.momentum)}>
              หุ้นซิ่ง
            </button>
            <button className="flex-1" aria-pressed={s.source === 'popular'} onClick={() => update(PRESETS.invest)} title="หุ้นใหญ่ + ETF 100 ตัว หาตัวที่ใกล้แนวรับ / ทะลุแนวต้าน">
              หุ้นลงทุน
            </button>
          </div>
        </div>

        <Section title="รายชื่อ">
          <Field label="ดึงรายชื่อจาก">
            <select value={s.source} onChange={(e) => update({ source: e.target.value })} className="field">
              {sources.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
          {s.source === 'custom' ? (
            <Field label="ticker (คั่นด้วย , หรือเว้นวรรค)">
              <textarea rows={3} value={s.custom} onChange={(e) => update({ custom: e.target.value })} className="field" />
            </Field>
          ) : (
            s.source !== 'watchlist' && s.source !== 'popular' && (
              <Field label="จำนวน">
                <input type="number" min={5} max={100} value={s.count} onChange={(e) => update({ count: Math.min(100, Math.max(5, e.target.valueAsNumber || 25)) })} className="field tabular-nums" />
              </Field>
            )
          )}
        </Section>

        <Section title="สัญญาณ">
          <div className="grid grid-cols-2 gap-3">
            {num('minRelVolume', 'Vol ≥ กี่เท่า', 0.5, 'volume วันนี้เทียบค่าเฉลี่ย')}
            {num('volLookback', 'เฉลี่ยกี่วัน')}
            {num('minGapPct', 'Gap ≥ %', 0.5)}
            {num('breakoutLookback', 'ทะลุ high กี่วัน')}
            {num('levelNearPct', 'ใกล้แนวรับ ≤ %', 0.5, 'ห่างจากแนวรับ D1 ไม่เกินกี่ %')}
          </div>
          <div>
            <span className="label">แสดงเฉพาะตัวที่มี (ไม่เลือก = ทั้งหมด)</span>
            <div className="flex flex-wrap gap-1.5">
              {SIGNAL_ORDER.map((sig) => (
                <button
                  key={sig}
                  aria-pressed={s.want.includes(sig)}
                  onClick={() => update({ want: s.want.includes(sig) ? s.want.filter((x) => x !== sig) : [...s.want, sig] })}
                  className="chip"
                  title={SIGNAL_LABEL[sig].help}
                >
                  {SIGNAL_LABEL[sig].text}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="ตัวกรอง">
          <div className="grid grid-cols-2 gap-3">
            {num('minPrice', 'ราคาต่ำสุด $', 0.1)}
            {num('maxPrice', 'ราคาสูงสุด $', 1)}
          </div>
          <Field label="มูลค่าซื้อขาย/วัน ขั้นต่ำ (ล้าน $)" title="กันหุ้นที่ซื้อขายน้อยจนเข้าออกลำบาก">
            <input
              type="number"
              step={0.5}
              value={o.minAvgDollarVolume / 1e6}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setOpt('minAvgDollarVolume', e.target.valueAsNumber * 1e6)}
              className="field tabular-nums"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-fg-2">
            <input type="checkbox" checked={s.onlyPass} onChange={(e) => update({ onlyPass: e.target.checked })} />
            ซ่อนตัวที่ไม่ผ่านตัวกรอง
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-fg-2">
            <input type="checkbox" checked={s.onlySignals} onChange={(e) => update({ onlySignals: e.target.checked })} />
            เฉพาะตัวที่มีสัญญาณ
          </label>
          <button onClick={() => update({ options: SCAN_DEFAULTS })} className="text-xs text-accent hover:underline">
            คืนค่าเริ่มต้น
          </button>
        </Section>
      </SidePanel>

      <main className="min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
        {error && <Note kind="bad">{error}</Note>}
        {result?.error && <Note kind="warn">{result.error}</Note>}
        {!result && !error && (
          <Empty icon="scan" title="เลือกรายชื่อแล้วกดสแกน">
            ตัวที่คะแนนสูงคือมีหลายสัญญาณพร้อมกัน — โหมด "หุ้นลงทุน" สแกนหุ้นใหญ่ + ETF ยอดนิยม 100 ตัวหาตัวที่ใกล้แนวรับหรือเพิ่งทะลุแนวต้าน
            กด "กราฟ" เพื่อดู D1 พร้อมโซนและโครงสร้าง
          </Empty>
        )}
        {result && (
          <div className="card overflow-hidden">
            <div className="border-b border-line px-5 py-3 text-xs text-muted">
              สแกน {result.rows.length} ตัว เมื่อ {formatThaiTime(result.scannedAt, false)}
              {hidden > 0 && ` · ซ่อน ${hidden} ตัวที่ไม่ผ่านตัวกรอง/ไม่มีสัญญาณที่เลือก`}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th className="pl-5">หุ้น</th>
                  <th className="text-right">ราคา</th>
                  <th className="text-right">วันนี้</th>
                  <th className="text-right">Gap</th>
                  <th className="text-right" title="volume วันนี้ ÷ ค่าเฉลี่ย">Vol ×</th>
                  <th className="text-right">$ ต่อวัน</th>
                  <th className="text-right">Mkt cap</th>
                  <th className="text-right" title="ห่างจาก high ของ N วันก่อน">จาก high</th>
                  <th className="pl-3" title="แนวรับ / แนวต้านใกล้สุดจาก D1 (ห่างกี่ %)">แนวรับ · ต้าน</th>
                  <th className="pl-3">สัญญาณ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className={r.scan && !r.scan.passes ? 'opacity-50' : ''}>
                    <td className="pl-5">
                      <span className="tabular-nums font-semibold text-fg">{r.symbol}</span>{' '}
                      <span className="text-[11px] text-faint">{r.name !== r.symbol ? r.name : ''}</span>
                    </td>
                    {r.scan ? (
                      <>
                        <td className="text-right tabular-nums">{r.scan.close.toFixed(2)}</td>
                        <td className={`text-right tabular-nums ${r.scan.changePct >= 0 ? 'text-bull' : 'text-bear'}`}>{pct(r.scan.changePct)}</td>
                        <td className="text-right tabular-nums text-muted">{pct(r.scan.gapPct)}</td>
                        <td className={`text-right tabular-nums ${r.scan.relVolume >= o.minRelVolume ? 'text-warn' : ''}`}>{r.scan.relVolume.toFixed(1)}</td>
                        <td className="text-right tabular-nums text-muted">{money(r.scan.avgDollarVolume)}</td>
                        <td className="text-right tabular-nums text-muted">{money(r.marketCap)}</td>
                        <td className="text-right tabular-nums text-muted">{pct(r.scan.fromPriorHighPct)}</td>
                        <td className="whitespace-nowrap pl-3 text-xs tabular-nums text-muted">
                          {r.scan.levels?.supports[0] ? (
                            <span title={`แนวรับ ${r.scan.levels.supports[0].price.toFixed(2)}`}>
                              <span className="text-bull">รับ</span> {pct(r.scan.levels.supports[0].distancePct)}
                            </span>
                          ) : (
                            <span className="text-faint">ไม่มีรับ</span>
                          )}
                          <span className="mx-1.5 text-faint">·</span>
                          {r.scan.levels?.resistances[0] ? (
                            <span title={`แนวต้าน ${r.scan.levels.resistances[0].price.toFixed(2)}`}>
                              <span className="text-bear">ต้าน</span> {pct(r.scan.levels.resistances[0].distancePct)}
                            </span>
                          ) : (
                            <span className="text-faint">ไม่มีต้าน</span>
                          )}
                        </td>
                        <td className="pl-3">
                          <span className="flex flex-wrap gap-1">
                            {r.scan.signals.map((sig) => (
                              <span key={sig} title={SIGNAL_LABEL[sig].help} className={`rounded px-1.5 py-0.5 text-[11px] ${SIGNAL_LABEL[sig].cls}`}>
                                {SIGNAL_LABEL[sig].text}
                              </span>
                            ))}
                          </span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={9} className="text-xs text-faint">
                        {r.error ? `ดึงข้อมูลไม่ได้: ${r.error}` : 'ข้อมูลไม่พอ'}
                      </td>
                    )}
                    <td className="pr-5 text-right">
                      <button
                        onClick={() => void open(r.symbol, r.name)}
                        disabled={opening !== null}
                        className="btn btn-sm"
                      >
                        {opening === r.symbol ? 'กำลังเพิ่ม…' : 'กราฟ'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
