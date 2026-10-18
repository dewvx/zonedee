import { useCallback, useEffect, useMemo, useState } from 'react';
import { rMultiple, type Timeframe } from '@zonedee/core';
import {
  addJournalImage,
  createJournal,
  deleteJournal,
  fetchJournal,
  fetchStrategies,
  fetchSymbols,
  journalImageUrl,
  removeJournalImage,
  updateJournal,
  type JournalEntry,
  type JournalInput,
  type JournalStatus,
  type StrategyInfo,
  type SymbolSummary,
} from '../api';
import { Icon } from '../components/Icon';
import { Empty, Note, Stat } from '../components/ui';
import { TradePreview } from '../components/TradePreview';
import { fmtPct, fmtR, formatThaiTime } from '../format';

const STATUS_LABEL: Record<JournalStatus, string> = {
  plan: 'แผน',
  open: 'ถืออยู่',
  closed: 'ปิดแล้ว',
  cancelled: 'ไม่ได้เข้า',
};
const STATUS_CLS: Record<JournalStatus, string> = {
  plan: 'bg-hover text-fg-2',
  open: 'bg-accent/15 text-accent',
  closed: 'bg-ok/12 text-ok',
  cancelled: 'bg-hover text-faint',
};
const EMOTIONS = ['ตามแผน', 'มั่นใจ', 'ลังเล', 'FOMO', 'กลัว', 'เอาคืน', 'เบื่อ'];

/** เวลา (UTC ms) ↔ <input type="datetime-local"> แบบเวลาไทย */
const toLocal = (ms: number | null) => (ms === null ? '' : new Date(ms + 7 * 3_600_000).toISOString().slice(0, 16));
const fromLocal = (s: string) => (s ? Date.parse(`${s}:00+07:00`) : null);

const EMPTY: JournalInput = {
  symbol: 'XAUUSD',
  tf: 'M15',
  direction: 'long',
  status: 'plan',
  entryTime: null,
  entryPrice: null,
  sl: null,
  tp: null,
  lots: null,
  exitTime: null,
  exitPrice: null,
  pnl: null,
  strategy: '',
  signalTime: null,
  setup: '',
  lesson: '',
  emotion: '',
  followedPlan: null,
  tags: [],
};

function NumField({ label, value, onChange, step = 'any' }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.valueAsNumber)}
        className="field tabular-nums"
      />
    </label>
  );
}

export default function JournalView() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<JournalInput>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<JournalStatus | 'all'>('all');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [preview, setPreview] = useState(false);
  const [bigImage, setBigImage] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      fetchJournal()
        .then(setEntries)
        .catch((e: Error) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void reload();
    void fetchSymbols().then(setSymbols).catch(() => undefined);
    void fetchStrategies().then(setStrategies).catch(() => undefined);
  }, [reload]);

  const selected = typeof selectedId === 'number' ? entries.find((e) => e.id === selectedId) : undefined;

  const select = (id: number | 'new') => {
    if (dirty && !window.confirm('ยังไม่ได้บันทึกที่แก้ไว้ — ทิ้งไหม?')) return;
    setSelectedId(id);
    setDirty(false);
    if (id === 'new') setDraft({ ...EMPTY, entryTime: Date.now() });
    else {
      const e = entries.find((x) => x.id === id);
      if (e) {
        const { id: _i, createdAt: _c, updatedAt: _u, r: _r, images: _im, ...rest } = e;
        setDraft(rest);
      }
    }
  };
  const set = (patch: JournalInput) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = selectedId === 'new' || selectedId === null ? await createJournal(draft) : await updateJournal(selectedId, draft);
      await reload();
      setSelectedId(saved.id);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (typeof selectedId !== 'number' || !window.confirm('ลบรายการนี้ (รวมรูป)?')) return;
    try {
      await deleteJournal(selectedId);
      setSelectedId(null);
      setDirty(false);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addImage = async (dataUrl: string) => {
    if (typeof selectedId !== 'number') {
      setError('บันทึกรายการก่อน แล้วค่อยแนบรูป');
      return;
    }
    try {
      await addJournalImage(selectedId, dataUrl);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const readFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });

  // วางรูปจาก clipboard (เช่นแคปจาก MT5) — Ctrl+V ที่ไหนก็ได้ในหน้านี้
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file || typeof selectedId !== 'number') return;
      e.preventDefault();
      void readFile(file).then(addImage);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const filtered = entries.filter(
    (e) => (statusFilter === 'all' || e.status === statusFilter) && (symbolFilter === 'all' || e.symbol === symbolFilter),
  );

  const stats = useMemo(() => {
    const closed = entries.filter((e) => e.status === 'closed' && e.r !== null);
    const wins = closed.filter((e) => (e.r ?? 0) > 0).length;
    const totalR = closed.reduce((a, e) => a + (e.r ?? 0), 0);
    const pnl = entries.reduce((a, e) => a + (e.status === 'closed' ? (e.pnl ?? 0) : 0), 0);
    const judged = entries.filter((e) => e.followedPlan !== null);
    const followed = judged.filter((e) => e.followedPlan).length;
    const byStrategy = new Map<string, { n: number; r: number; wins: number }>();
    for (const e of closed) {
      const k = e.strategy || '(ไม่ระบุ)';
      const s = byStrategy.get(k) ?? { n: 0, r: 0, wins: 0 };
      s.n++;
      s.r += e.r ?? 0;
      if ((e.r ?? 0) > 0) s.wins++;
      byStrategy.set(k, s);
    }
    return {
      closed: closed.length,
      wins,
      totalR,
      avgR: closed.length ? totalR / closed.length : 0,
      pnl,
      followRate: judged.length ? followed / judged.length : null,
      byStrategy: [...byStrategy.entries()].sort((a, b) => b[1].n - a[1].n),
    };
  }, [entries]);

  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;
  const info = symbols.find((s) => s.symbol === draft.symbol);
  const digits = info?.digits ?? 2;
  const liveR =
    draft.status === 'closed' && draft.entryPrice != null && draft.exitPrice != null
      ? rMultiple(draft.direction ?? 'long', draft.entryPrice, draft.sl ?? null, draft.exitPrice)
      : null;
  const plannedRR =
    draft.entryPrice != null && draft.sl != null && draft.tp != null && draft.entryPrice !== draft.sl
      ? Math.abs(draft.tp - draft.entryPrice) / Math.abs(draft.entryPrice - draft.sl)
      : null;
  const canPreview = !!draft.tf && draft.entryTime != null && draft.entryPrice != null && draft.sl != null && draft.tp != null;
  const symbolsInJournal = [...new Set(entries.map((e) => e.symbol))];
  const isKnownStrategy = !draft.strategy || strategies.some((s) => s.id === draft.strategy);

  return (
    <div className="flex h-full min-w-0">
      {/* ── รายการ ─────────────────────────────────────────── */}
      <aside className="flex w-[22rem] shrink-0 flex-col border-r border-line bg-panel">
        <div className="space-y-4 border-b border-line px-5 py-4">
          <div className="flex items-center">
            <div>
              <h1 className="text-[15px] font-semibold leading-tight text-fg">Journal</h1>
              <p className="text-xs text-muted">จดทุกไม้ ทั้งที่ชนะและแพ้</p>
            </div>
            <button onClick={() => select('new')} className="btn btn-primary btn-sm ml-auto">
              <Icon name="plus" size={14} />
              บันทึกใหม่
            </button>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-3">
            <Stat label="ปิดแล้ว" value={stats.closed} />
            <Stat label="ชนะ" value={stats.closed ? fmtPct(stats.wins / stats.closed) : '-'} />
            <Stat label="รวม" value={fmtR(stats.totalR, 1)} tone={stats.totalR > 0 ? 'up' : stats.totalR < 0 ? 'down' : undefined} />
            <Stat label="เฉลี่ย/ไม้" value={stats.closed ? fmtR(stats.avgR) : '-'} />
            <Stat label="กำไร (เงิน)" value={stats.pnl.toFixed(2)} tone={stats.pnl > 0 ? 'up' : stats.pnl < 0 ? 'down' : undefined} />
            <Stat label="ทำตามแผน" value={stats.followRate === null ? '-' : fmtPct(stats.followRate)} />
          </div>
          {stats.byStrategy.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-fg-2">แยกตามท่า</div>
              <table className="w-full text-xs">
                <tbody>
                  {stats.byStrategy.slice(0, 5).map(([k, v]) => (
                    <tr key={k} className="text-muted">
                      <td className="max-w-0 truncate py-0.5 pr-2">{strategyName(k)}</td>
                      <td className="text-right tabular-nums">{v.n} ไม้</td>
                      <td className="pl-2 text-right tabular-nums">{fmtPct(v.wins / v.n)}</td>
                      <td className={`pl-2 text-right font-medium tabular-nums ${v.r >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtR(v.r, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as JournalStatus | 'all')} className="field" aria-label="สถานะ">
              <option value="all">ทุกสถานะ</option>
              {(Object.keys(STATUS_LABEL) as JournalStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} className="field" aria-label="symbol">
              <option value="all">ทุก symbol</option>
              {symbolsInJournal.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <li className="p-3 text-xs leading-relaxed text-muted">
              ยังไม่มีบันทึก — กด "บันทึกใหม่" หรือในหน้ากราฟเปิด "คำนวณ lot" วาง Entry/SL/TP แล้วกด "บันทึกลง Journal" (ได้รูปกราฟติดมาด้วย)
            </li>
          )}
          {filtered.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => select(e.id)}
                className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover ${selectedId === e.id ? 'bg-hover' : ''}`}
              >
                <span className={`badge w-12 justify-center ${e.direction === 'long' ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear'}`}>
                  {e.direction === 'long' ? 'BUY' : 'SELL'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">
                    {e.symbol} {e.tf ?? ''}
                    {e.strategy && <span className="font-normal text-muted"> — {strategyName(e.strategy)}</span>}
                  </span>
                  <span className="block text-xs text-faint">
                    {formatThaiTime(e.entryTime ?? e.createdAt)}
                    {e.images.length > 0 && ` · รูป ${e.images.length}`}
                  </span>
                </span>
                {e.r !== null ? (
                  <span className={`text-right font-semibold tabular-nums ${e.r > 0 ? 'text-bull' : 'text-bear'}`}>{fmtR(e.r, 1)}</span>
                ) : (
                  <span className={`badge ${STATUS_CLS[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ── รายละเอียด ─────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {error && <Note kind="bad">{error}</Note>}
        {selectedId === null ? (
          <Empty icon="journal" title="เลือกรายการ หรือกดบันทึกใหม่">
            เขียนเหตุผลก่อนเข้า แล้วกลับมาเติมผลหลังปิด — สถิติ "ทำตามแผน" กับ "แยกตามท่า" จะบอกว่าแพ้เพราะท่า หรือเพราะใจ
          </Empty>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-fg">{selectedId === 'new' ? 'บันทึกใหม่' : `${draft.symbol} ${draft.tf ?? ''} — #${selectedId}`}</h2>
              {selected && <span className="text-xs text-faint">แก้ไขล่าสุด {formatThaiTime(selected.updatedAt)}</span>}
              <div className="ml-auto flex gap-2">
                {canPreview && (
                  <button onClick={() => setPreview(true)} className="btn btn-sm">
                    <Icon name="chart" size={14} />
                    ดูบนกราฟ
                  </button>
                )}
                {typeof selectedId === 'number' && (
                  <button onClick={() => void remove()} className="btn btn-sm btn-danger">
                    ลบ
                  </button>
                )}
                <button
                  onClick={() => void save()}
                  disabled={saving || (!dirty && selectedId !== 'new')}
                  className="btn btn-primary btn-sm"
                >
                  {saving ? 'กำลังบันทึก…' : dirty || selectedId === 'new' ? 'บันทึก' : 'บันทึกแล้ว'}
                </button>
              </div>
            </div>

            <section className="grid grid-cols-2 gap-3 card p-5 sm:grid-cols-4">
              <label className="block">
                <span className="label">Symbol</span>
                <select value={draft.symbol} onChange={(e) => set({ symbol: e.target.value })} className="field">
                  {symbols.map((s) => (
                    <option key={s.symbol}>{s.symbol}</option>
                  ))}
                  {draft.symbol && !symbols.some((s) => s.symbol === draft.symbol) && <option>{draft.symbol}</option>}
                </select>
              </label>
              <label className="block">
                <span className="label">TF ที่ดูตอนเข้า</span>
                <select value={draft.tf ?? ''} onChange={(e) => set({ tf: (e.target.value || null) as Timeframe | null })} className="field">
                  <option value="">-</option>
                  {(info?.timeframes ?? []).map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <div>
                <span className="label">ทิศ</span>
                <div className="seg flex w-full">
                  {(['long', 'short'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => set({ direction: d })}
                      className={`flex-1 py-1 font-semibold ${draft.direction === d ? (d === 'long' ? 'bg-bull text-black' : 'bg-bear text-white') : 'text-muted hover:bg-hover'}`}
                    >
                      {d === 'long' ? 'BUY' : 'SELL'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="label">สถานะ</span>
                <select value={draft.status} onChange={(e) => set({ status: e.target.value as JournalStatus })} className="field">
                  {(Object.keys(STATUS_LABEL) as JournalStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-2 block">
                <span className="label">เวลาเข้า (เวลาไทย)</span>
                <input type="datetime-local" value={toLocal(draft.entryTime ?? null)} onChange={(e) => set({ entryTime: fromLocal(e.target.value) })} className="field" />
              </label>
              <NumField label="Entry" value={draft.entryPrice} onChange={(v) => set({ entryPrice: v })} />
              <NumField label="Lot" value={draft.lots} onChange={(v) => set({ lots: v })} step="0.01" />
              <NumField label="SL" value={draft.sl} onChange={(v) => set({ sl: v })} />
              <NumField label="TP" value={draft.tp} onChange={(v) => set({ tp: v })} />
              <div className="col-span-2 flex items-end gap-4 pb-1 text-xs text-muted">
                {plannedRR !== null && <span>R:R ที่วาง 1:{plannedRR.toFixed(2)}</span>}
                {draft.entryPrice != null && draft.sl != null && (
                  <span>SL {(Math.abs(draft.entryPrice - draft.sl) * 10 ** digits).toFixed(0)} points</span>
                )}
              </div>

              <label className="col-span-2 block">
                <span className="label">เวลาออก</span>
                <input type="datetime-local" value={toLocal(draft.exitTime ?? null)} onChange={(e) => set({ exitTime: fromLocal(e.target.value) })} className="field" />
              </label>
              <NumField label="ราคาออก" value={draft.exitPrice} onChange={(v) => set({ exitPrice: v, status: v !== null && draft.status !== 'closed' ? 'closed' : draft.status })} />
              <NumField label="กำไร/ขาดทุน (เงิน)" value={draft.pnl} onChange={(v) => set({ pnl: v })} />
              {liveR !== null && (
                <div className={`col-span-4 tabular-nums text-sm ${liveR > 0 ? 'text-bull' : 'text-bear'}`}>ผล {fmtR(liveR)}</div>
              )}
            </section>

            <section className="grid gap-3 card p-5 sm:grid-cols-2">
              <label className="block">
                <span className="label">ท่า (ผูกกับสัญญาณ)</span>
                <select
                  value={isKnownStrategy ? (draft.strategy ?? '') : '__other'}
                  onChange={(e) => set({ strategy: e.target.value === '__other' ? 'อื่นๆ' : e.target.value })}
                  className="field"
                >
                  <option value="">- ไม่ระบุ -</option>
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} [{s.source}]
                    </option>
                  ))}
                  <option value="__other">อื่นๆ (พิมพ์เอง)</option>
                </select>
                {!isKnownStrategy && (
                  <input value={draft.strategy} onChange={(e) => set({ strategy: e.target.value })} className="field mt-1" placeholder="ชื่อท่า" />
                )}
              </label>
              <label className="block">
                <span className="label">เวลาแท่งสัญญาณ (ถ้ามี)</span>
                <input type="datetime-local" value={toLocal(draft.signalTime ?? null)} onChange={(e) => set({ signalTime: fromLocal(e.target.value) })} className="field" />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">ทำไมถึงเข้า (setup ที่เห็น)</span>
                <textarea rows={3} value={draft.setup} onChange={(e) => set({ setup: e.target.value })} className="field" placeholder="เช่น H1 ทำ RBS, M5 CHoCH แล้ว BOS, ย่อมาแตะ 0.618" />
              </label>
              <div>
                <span className="label">อารมณ์ตอนเข้า</span>
                <div className="flex flex-wrap gap-1">
                  {EMOTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => set({ emotion: draft.emotion === m ? '' : m })}
                      aria-pressed={draft.emotion === m}
                      className="chip"
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="label">ทำตามแผนไหม</span>
                <div className="seg flex w-full">
                  {([
                    [true, 'ตามแผน'],
                    [false, 'ไม่ตาม'],
                    [null, 'ยังไม่รู้'],
                  ] as const).map(([v, label]) => (
                    <button
                      key={label}
                      onClick={() => set({ followedPlan: v })}
                      className={`flex-1 py-1 ${draft.followedPlan === v ? 'bg-accent text-on-accent' : 'text-muted hover:bg-hover'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block sm:col-span-2">
                <span className="label">บทเรียน / ผิดตรงไหน</span>
                <textarea rows={2} value={draft.lesson} onChange={(e) => set({ lesson: e.target.value })} className="field" />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">แท็ก (คั่นด้วย ,)</span>
                <input
                  value={(draft.tags ?? []).join(', ')}
                  onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()) })}
                  className="field"
                  placeholder="london, ข่าว, เทรดเกิน"
                />
              </label>
            </section>

            <section className="card p-5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-fg-2">รูปกราฟ</span>
                <span className="text-xs text-faint">Ctrl+V วางรูปที่แคปไว้ได้เลย</span>
                <label className={`ml-auto cursor-pointer rounded border border-line px-2 py-0.5 text-fg-2 hover:bg-hover ${typeof selectedId !== 'number' ? 'pointer-events-none opacity-40' : ''}`}>
                  แนบรูป
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void readFile(f).then(addImage);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {typeof selectedId !== 'number' ? (
                <p className="text-faint">บันทึกรายการก่อน แล้วค่อยแนบรูป</p>
              ) : selected && selected.images.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {selected.images.map((name) => (
                    <div key={name} className="group relative overflow-hidden rounded border border-line">
                      <img src={journalImageUrl(name)} alt="" className="h-32 w-full cursor-zoom-in object-cover" onClick={() => setBigImage(name)} />
                      <button
                        onClick={() => void removeJournalImage(selected.id, name).then(reload)}
                        className="absolute right-1 top-1 hidden rounded bg-black/70 px-1.5 text-[11px] text-bad group-hover:block"
                      >
                        ลบ
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-faint">ยังไม่มีรูป</p>
              )}
            </section>
          </div>
        )}
      </main>

      {preview && canPreview && (
        <TradePreview
          symbol={draft.symbol!}
          tf={draft.tf!}
          digits={digits}
          trade={{
            direction: draft.direction ?? 'long',
            entryTime: draft.entryTime!,
            exitTime: draft.exitTime ?? null,
            entry: draft.entryPrice!,
            sl: draft.sl!,
            tp: draft.tp!,
            exit: draft.exitPrice ?? null,
            r: liveR,
            title: `${draft.symbol} ${draft.tf}`,
            subtitle: draft.setup || undefined,
          }}
          onClose={() => setPreview(false)}
        />
      )}
      {bigImage && (
        <div className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-6" onClick={() => setBigImage(null)}>
          <img src={journalImageUrl(bigImage)} alt="" className="max-h-full max-w-full rounded border border-line" />
        </div>
      )}
    </div>
  );
}
