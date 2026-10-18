import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Timeframe } from '@zonedee/core';
import { addWatch, fetchWatchlist, refreshWatchlist, removeWatch, updateWatch, type WatchInput, type WatchRow } from '../api';
import { inputCls } from '../components/ParamForm';
import { formatThaiDate } from '../format';

const pct = (v: number | null, d = 1) => (v === null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const usd = (v: number | null) =>
  v === null ? '-' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number | null) => (v === null ? 'text-slate-500' : v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : '');

const EMPTY: WatchInput = { symbol: '', shares: null, avgCost: null, dcaMonthly: null, note: '' };

function NumInput({ value, onChange, placeholder, step = 'any' }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string; step?: string }) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.valueAsNumber)}
      className={`${inputCls} font-mono`}
    />
  );
}

export default function WatchlistView({ onOpenChart }: { onOpenChart?: (symbol: string, tf: Timeframe) => void }) {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [draft, setDraft] = useState<WatchInput>(EMPTY);
  const [editing, setEditing] = useState<{ id: number; draft: WatchInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const reload = useCallback(
    () =>
      fetchWatchlist()
        .then(setRows)
        .catch((e: Error) => setMsg({ kind: 'error', text: e.message })),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (ok) setMsg({ kind: 'ok', text: typeof r === 'string' ? r : ok });
      await reload();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(() => {
    const held = rows.filter((r) => r.value !== null);
    const value = held.reduce((a, r) => a + (r.value ?? 0), 0);
    const costRows = held.filter((r) => r.cost !== null);
    const cost = costRows.reduce((a, r) => a + (r.cost ?? 0), 0);
    const valueWithCost = costRows.reduce((a, r) => a + (r.value ?? 0), 0);
    const dca = rows.reduce((a, r) => a + (r.dcaMonthly ?? 0), 0);
    const day = held.reduce((a, r) => {
      const c = r.metrics?.change1d;
      return c == null || r.value === null ? a : a + r.value - r.value / (1 + c / 100);
    }, 0);
    return { value, cost, pnl: costRows.length ? valueWithCost - cost : null, pnlPct: cost ? ((valueWithCost - cost) / cost) * 100 : null, dca, day };
  }, [rows]);
  const lastData = rows.reduce((a, r) => Math.max(a, r.metrics?.lastTime ?? 0), 0);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b border-line bg-panel px-4 py-2 text-xs">
        <h2 className="text-sm font-semibold text-white">Watchlist ลงทุน</h2>
        <span className="text-slate-400">
          มูลค่า <span className="font-mono text-white">{usd(total.value)}</span>
        </span>
        <span className="text-slate-400">
          กำไร <span className={`font-mono ${tone(total.pnl)}`}>{usd(total.pnl)}</span> <span className={tone(total.pnlPct)}>{pct(total.pnlPct)}</span>
        </span>
        <span className="text-slate-400">
          วันนี้ <span className={`font-mono ${tone(total.day)}`}>{usd(total.day)}</span>
        </span>
        {total.dca > 0 && (
          <span className="text-slate-400">
            DCA/เดือน <span className="font-mono text-white">{usd(total.dca)}</span>
          </span>
        )}
        {lastData > 0 && <span className="text-[11px] text-slate-500">ราคาปิดล่าสุด {formatThaiDate(lastData)}</span>}
        <button
          onClick={() => void run(async () => {
            const r = await refreshWatchlist();
            return r.errors.length ? `อัปเดต ${r.updated} ตัว · มีปัญหา: ${r.errors.join(' · ')}` : `อัปเดต ${r.updated} ตัวแล้ว`;
          }, 'อัปเดตแล้ว')}
          disabled={busy || rows.length === 0}
          className="ml-auto rounded border border-line px-2.5 py-1 text-slate-300 hover:bg-line disabled:opacity-50"
        >
          ⟳ อัปเดตราคา
        </button>
      </div>
      {msg && (
        <div className={`border-b px-4 py-1 text-xs ${msg.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/40 text-emerald-300' : 'border-red-900/50 bg-red-950/40 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.symbol) return;
            void run(async () => {
              await addWatch(draft);
              setDraft(EMPTY);
            }, `เพิ่ม ${String(draft.symbol).toUpperCase()} แล้ว`);
          }}
          className="mb-4 grid grid-cols-2 items-end gap-2 rounded-md border border-line bg-panel p-3 sm:grid-cols-6"
        >
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">ticker (เช่น VOO, NVDA)</span>
            <input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} className={`${inputCls} font-mono`} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">จำนวนหุ้น</span>
            <NumInput value={draft.shares} onChange={(v) => setDraft({ ...draft, shares: v })} placeholder="ไม่ใส่ = ติดตาม" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">ต้นทุนเฉลี่ย $</span>
            <NumInput value={draft.avgCost} onChange={(v) => setDraft({ ...draft, avgCost: v })} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">DCA/เดือน $</span>
            <NumInput value={draft.dcaMonthly} onChange={(v) => setDraft({ ...draft, dcaMonthly: v })} />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-slate-400">โน้ต</span>
            <input value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={inputCls} />
          </label>
          <button type="submit" disabled={busy || !draft.symbol} className="rounded-md bg-blue-600 py-1.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? 'กำลังเพิ่ม…' : '+ เพิ่ม'}
          </button>
        </form>

        {rows.length === 0 ? (
          <p className="mx-auto mt-10 max-w-md text-center leading-relaxed text-slate-400">
            ใส่หุ้น/ETF ที่ถือใน Dime (หรืออยากติดตาม) — แอปจะดึงราคา D1 ย้อนหลัง 5 ปีจาก Yahoo แล้วสรุปผลตอบแทน, ห่างจากจุดสูงสุด, เส้นค่าเฉลี่ย 50/200 วัน
            และมูลค่าพอร์ต
          </p>
        ) : (
          <table className="w-full">
            <thead className="text-left text-[10px] text-slate-500">
              <tr>
                <th className="pb-1 font-normal">หุ้น</th>
                <th className="pb-1 text-right font-normal">ราคา</th>
                <th className="pb-1 text-right font-normal">1 วัน</th>
                <th className="pb-1 text-right font-normal">1 สัปดาห์</th>
                <th className="pb-1 text-right font-normal">1 เดือน</th>
                <th className="pb-1 text-right font-normal">YTD</th>
                <th className="pb-1 text-right font-normal">1 ปี</th>
                <th className="pb-1 text-right font-normal" title="ห่างจากจุดสูงสุด 52 สัปดาห์">จาก high</th>
                <th className="pb-1 pl-3 font-normal" title="ราคาเทียบเส้นค่าเฉลี่ย 50 / 200 วัน">MA50 / 200</th>
                <th className="pb-1 text-right font-normal">RSI</th>
                <th className="pb-1 text-right font-normal">มูลค่า</th>
                <th className="pb-1 text-right font-normal">กำไร</th>
                <th className="pb-1 text-right font-normal">สัดส่วน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.metrics;
                const isEditing = editing?.id === r.id;
                return (
                  <tr key={r.id} className="border-t border-line/60 align-top">
                    <td className="py-1.5">
                      <span className="font-mono font-semibold text-white">{r.symbol}</span>
                      {r.note && <div className="max-w-[10rem] truncate text-[10px] text-slate-500" title={r.note}>{r.note}</div>}
                    </td>
                    {m ? (
                      <>
                        <td className="text-right font-mono">{m.close.toFixed(2)}</td>
                        <td className={`text-right font-mono ${tone(m.change1d)}`}>{pct(m.change1d)}</td>
                        <td className={`text-right font-mono ${tone(m.change1w)}`}>{pct(m.change1w)}</td>
                        <td className={`text-right font-mono ${tone(m.change1m)}`}>{pct(m.change1m)}</td>
                        <td className={`text-right font-mono ${tone(m.changeYtd)}`}>{pct(m.changeYtd)}</td>
                        <td className={`text-right font-mono ${tone(m.change1y)}`}>{pct(m.change1y)}</td>
                        <td className="text-right font-mono text-slate-400">{pct(m.fromHigh52Pct)}</td>
                        <td className="pl-3">
                          {[
                            ['50', m.sma50],
                            ['200', m.sma200],
                          ].map(([label, v]) => (
                            <span
                              key={label as string}
                              className={`mr-1 rounded px-1 text-[10px] ${v === null ? 'text-slate-600' : m.close >= (v as number) ? 'bg-emerald-950 text-emerald-300' : 'bg-red-950 text-red-300'}`}
                              title={v === null ? 'ข้อมูลไม่พอ' : `MA${label} = ${(v as number).toFixed(2)}`}
                            >
                              {v === null ? `—${label}` : `${m.close >= (v as number) ? '▲' : '▼'}${label}`}
                            </span>
                          ))}
                        </td>
                        <td className={`text-right font-mono ${m.rsi14 !== null && m.rsi14 >= 70 ? 'text-amber-300' : m.rsi14 !== null && m.rsi14 <= 30 ? 'text-blue-300' : 'text-slate-400'}`}>
                          {m.rsi14 === null ? '-' : m.rsi14.toFixed(0)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={9} className="text-slate-500">
                        ยังไม่มีราคา — กด ⟳ อัปเดตราคา
                      </td>
                    )}
                    <td className="text-right font-mono">
                      {isEditing ? (
                        <div className="ml-auto w-24 space-y-1">
                          <NumInput value={editing.draft.shares} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, shares: v } })} placeholder="หุ้น" />
                          <NumInput value={editing.draft.avgCost} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, avgCost: v } })} placeholder="ต้นทุน $" />
                          <NumInput value={editing.draft.dcaMonthly} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, dcaMonthly: v } })} placeholder="DCA/เดือน" />
                        </div>
                      ) : (
                        <>
                          {usd(r.value)}
                          {r.shares !== null && <div className="text-[10px] text-slate-500">{r.shares} หุ้น</div>}
                        </>
                      )}
                    </td>
                    <td className={`text-right font-mono ${tone(r.pnl)}`}>
                      {usd(r.pnl)}
                      {r.pnlPct !== null && <div className="text-[10px]">{pct(r.pnlPct)}</div>}
                    </td>
                    <td className="text-right font-mono text-slate-400">
                      {r.value !== null && total.value > 0 ? `${((r.value / total.value) * 100).toFixed(0)}%` : '-'}
                      {r.dcaMonthly ? <div className="text-[10px]">DCA {usd(r.dcaMonthly)}</div> : null}
                    </td>
                    <td className="whitespace-nowrap pl-2 text-right">
                      {isEditing ? (
                        <>
                          <button onClick={() => void run(async () => { await updateWatch(r.id, editing.draft); setEditing(null); })} className="rounded bg-blue-600 px-2 py-0.5 text-white">
                            บันทึก
                          </button>
                          <button onClick={() => setEditing(null)} className="ml-1 rounded px-1.5 text-slate-400 hover:bg-line">
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => onOpenChart?.(r.symbol, 'D1')} className="rounded px-1.5 text-slate-400 hover:bg-line hover:text-white">
                            กราฟ
                          </button>
                          <button onClick={() => setEditing({ id: r.id, draft: { shares: r.shares, avgCost: r.avgCost, dcaMonthly: r.dcaMonthly, note: r.note } })} className="rounded px-1.5 text-slate-400 hover:bg-line hover:text-white">
                            แก้
                          </button>
                          <button onClick={() => window.confirm(`เอา ${r.symbol} ออก?`) && void run(() => removeWatch(r.id))} className="rounded px-1.5 text-slate-500 hover:bg-line hover:text-red-300">
                            ลบ
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-[10px] leading-relaxed text-slate-500">
          ราคาจาก Yahoo Finance (ปรับ split แล้ว ไม่รวมปันผล) · มูลค่าเป็น USD · ตัวเลขเป็นข้อมูลประกอบ ไม่ใช่คำแนะนำซื้อขาย
        </p>
      </div>
    </div>
  );
}
