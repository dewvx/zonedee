import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Timeframe } from '@zonedee/core';
import { addWatch, fetchWatchlist, refreshWatchlist, removeWatch, updateWatch, type WatchInput, type WatchRow } from '../api';
import { formatThaiDate } from '../format';
import { Icon } from '../components/Icon';
import { Empty, Field, Note, PageHeader, Stat } from '../components/ui';

const pct = (v: number | null, d = 1) => (v === null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const usd = (v: number | null) =>
  v === null ? '-' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number | null) => (v === null ? 'text-faint' : v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : '');

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
      className="field tabular-nums"
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
      <PageHeader title="Watchlist ลงทุน" subtitle={lastData > 0 ? `หุ้น/ETF ระยะยาว (Dime) — ราคาปิดล่าสุด ${formatThaiDate(lastData)}` : 'หุ้น/ETF ระยะยาว (Dime)'}>
        <button
          onClick={() => void run(async () => {
            const r = await refreshWatchlist();
            return r.errors.length ? `อัปเดต ${r.updated} ตัว — มีปัญหา: ${r.errors.join(' / ')}` : `อัปเดต ${r.updated} ตัวแล้ว`;
          }, 'อัปเดตแล้ว')}
          disabled={busy || rows.length === 0}
          className="btn"
        >
          <Icon name="refresh" size={15} className={busy ? 'animate-spin' : ''} />
          อัปเดตราคา
        </button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1280px] space-y-5 p-6">
        {msg && (
          <Note kind={msg.kind === 'ok' ? 'ok' : 'bad'} onClose={() => setMsg(null)}>
            {msg.text}
          </Note>
        )}

        {rows.length > 0 && (
          <div className="card flex flex-wrap items-end gap-x-10 gap-y-4 px-6 py-5">
            <div>
              <div className="text-xs text-muted">มูลค่าพอร์ต</div>
              <div className="text-[28px] font-semibold leading-tight tracking-tight tabular-nums text-fg">{usd(total.value)}</div>
            </div>
            <Stat label="กำไร/ขาดทุน" value={usd(total.pnl)} sub={pct(total.pnlPct)} tone={total.pnl === null ? undefined : total.pnl >= 0 ? 'up' : 'down'} />
            <Stat label="วันนี้" value={usd(total.day)} tone={total.day >= 0 ? 'up' : 'down'} />
            {total.dca > 0 && <Stat label="DCA ต่อเดือน" value={usd(total.dca)} />}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.symbol) return;
            void run(async () => {
              await addWatch(draft);
              setDraft(EMPTY);
            }, `เพิ่ม ${String(draft.symbol).toUpperCase()} แล้ว`);
          }}
          className="card grid grid-cols-2 items-end gap-3 p-5 sm:grid-cols-6"
        >
          <Field label="ticker (เช่น VOO, NVDA)">
            <input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} className="field" />
          </Field>
          <Field label="จำนวนหุ้น">
            <NumInput value={draft.shares} onChange={(v) => setDraft({ ...draft, shares: v })} placeholder="ไม่ใส่ = แค่ติดตาม" />
          </Field>
          <Field label="ต้นทุนเฉลี่ย $">
            <NumInput value={draft.avgCost} onChange={(v) => setDraft({ ...draft, avgCost: v })} />
          </Field>
          <Field label="DCA/เดือน $">
            <NumInput value={draft.dcaMonthly} onChange={(v) => setDraft({ ...draft, dcaMonthly: v })} />
          </Field>
          <Field label="โน้ต">
            <input value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="field" />
          </Field>
          <button type="submit" disabled={busy || !draft.symbol} className="btn btn-primary">
            <Icon name="plus" size={14} />
            {busy ? 'กำลังเพิ่ม…' : 'เพิ่มหุ้น'}
          </button>
        </form>

        {rows.length === 0 ? (
          <Empty icon="invest" title="ยังไม่มีหุ้นใน watchlist">
            ใส่หุ้น/ETF ที่ถือใน Dime หรือที่อยากติดตาม — แอปจะดึงราคา D1 ย้อนหลัง 5 ปีจาก Yahoo แล้วสรุปผลตอบแทน ระยะห่างจากจุดสูงสุด
            เส้นค่าเฉลี่ย 50/200 วัน และมูลค่าพอร์ต
          </Empty>
        ) : (
          <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-5">หุ้น</th>
                <th className="text-right">ราคา</th>
                <th className="text-right">1 วัน</th>
                <th className="text-right">1 สัปดาห์</th>
                <th className="text-right">1 เดือน</th>
                <th className="text-right">YTD</th>
                <th className="text-right">1 ปี</th>
                <th className="text-right" title="ห่างจากจุดสูงสุด 52 สัปดาห์">จาก high</th>
                <th className="pl-3" title="ราคาเทียบเส้นค่าเฉลี่ย 50 / 200 วัน">MA50 / 200</th>
                <th className="text-right">RSI</th>
                <th className="text-right">มูลค่า</th>
                <th className="text-right">กำไร</th>
                <th className="text-right">สัดส่วน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.metrics;
                const isEditing = editing?.id === r.id;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="pl-5">
                      <span className="tabular-nums font-semibold text-fg">{r.symbol}</span>
                      {r.note && <div className="max-w-[10rem] truncate text-[11px] text-faint" title={r.note}>{r.note}</div>}
                    </td>
                    {m ? (
                      <>
                        <td className="text-right tabular-nums">{m.close.toFixed(2)}</td>
                        <td className={`text-right tabular-nums ${tone(m.change1d)}`}>{pct(m.change1d)}</td>
                        <td className={`text-right tabular-nums ${tone(m.change1w)}`}>{pct(m.change1w)}</td>
                        <td className={`text-right tabular-nums ${tone(m.change1m)}`}>{pct(m.change1m)}</td>
                        <td className={`text-right tabular-nums ${tone(m.changeYtd)}`}>{pct(m.changeYtd)}</td>
                        <td className={`text-right tabular-nums ${tone(m.change1y)}`}>{pct(m.change1y)}</td>
                        <td className="text-right tabular-nums text-muted">{pct(m.fromHigh52Pct)}</td>
                        <td className="pl-3">
                          {[
                            ['50', m.sma50],
                            ['200', m.sma200],
                          ].map(([label, v]) => (
                            <span
                              key={label as string}
                              className={`mr-1 rounded px-1 text-[11px] ${v === null ? 'text-faint' : m.close >= (v as number) ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad'}`}
                              title={v === null ? 'ข้อมูลไม่พอ' : `MA${label} = ${(v as number).toFixed(2)}`}
                            >
                              {v === null ? `—${label}` : `${m.close >= (v as number) ? '▲' : '▼'}${label}`}
                            </span>
                          ))}
                        </td>
                        <td className={`text-right tabular-nums ${m.rsi14 !== null && m.rsi14 >= 70 ? 'text-warn' : m.rsi14 !== null && m.rsi14 <= 30 ? 'text-accent' : 'text-muted'}`}>
                          {m.rsi14 === null ? '-' : m.rsi14.toFixed(0)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={9} className="text-faint">
                        ยังไม่มีราคา — กด ⟳ อัปเดตราคา
                      </td>
                    )}
                    <td className="text-right tabular-nums">
                      {isEditing ? (
                        <div className="ml-auto w-24 space-y-1">
                          <NumInput value={editing.draft.shares} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, shares: v } })} placeholder="หุ้น" />
                          <NumInput value={editing.draft.avgCost} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, avgCost: v } })} placeholder="ต้นทุน $" />
                          <NumInput value={editing.draft.dcaMonthly} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, dcaMonthly: v } })} placeholder="DCA/เดือน" />
                        </div>
                      ) : (
                        <>
                          {usd(r.value)}
                          {r.shares !== null && <div className="text-[11px] text-faint">{r.shares} หุ้น</div>}
                        </>
                      )}
                    </td>
                    <td className={`text-right tabular-nums ${tone(r.pnl)}`}>
                      {usd(r.pnl)}
                      {r.pnlPct !== null && <div className="text-[11px]">{pct(r.pnlPct)}</div>}
                    </td>
                    <td className="text-right tabular-nums text-muted">
                      {r.value !== null && total.value > 0 ? `${((r.value / total.value) * 100).toFixed(0)}%` : '-'}
                      {r.dcaMonthly ? <div className="text-[11px]">DCA {usd(r.dcaMonthly)}</div> : null}
                    </td>
                    <td className="whitespace-nowrap pl-2 pr-4 text-right">
                      {isEditing ? (
                        <>
                          <button onClick={() => void run(async () => { await updateWatch(r.id, editing.draft); setEditing(null); })} className="rounded bg-accent px-2 py-0.5 text-on-accent">
                            บันทึก
                          </button>
                          <button onClick={() => setEditing(null)} className="btn btn-sm btn-ghost ml-1">
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => onOpenChart?.(r.symbol, 'D1')} className="btn btn-sm btn-ghost">
                            กราฟ
                          </button>
                          <button onClick={() => setEditing({ id: r.id, draft: { shares: r.shares, avgCost: r.avgCost, dcaMonthly: r.dcaMonthly, note: r.note } })} className="btn btn-sm btn-ghost">
                            แก้
                          </button>
                          <button onClick={() => window.confirm(`เอา ${r.symbol} ออก?`) && void run(() => removeWatch(r.id))} className="btn btn-sm btn-ghost btn-danger">
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
          </div>
        )}
        <p className="text-xs leading-relaxed text-faint">
          ราคาจาก Yahoo Finance (ปรับ split แล้ว ไม่รวมปันผล) มูลค่าเป็น USD — ตัวเลขเป็นข้อมูลประกอบ ไม่ใช่คำแนะนำซื้อขาย
        </p>
        </div>
      </div>
    </div>
  );
}
