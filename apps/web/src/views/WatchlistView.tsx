import { useCallback, useEffect, useMemo, useState } from 'react';
import { LEVEL_STATUS_TH, rebalance, type KeyLevels, type LevelStatus, type Timeframe } from '@zonedee/core';
import { addWatch, fetchWatchlist, refreshWatchlist, removeWatch, updateWatch, type WatchInput, type WatchRow } from '../api';
import { formatThaiDate } from '../format';
import { Icon } from '../components/Icon';
import { Empty, Field, Note, PageHeader, Stat } from '../components/ui';
import { StockSummaryModal } from '../components/StockSummaryModal';

const pct = (v: number | null, d = 1) => (v === null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const usd = (v: number | null) =>
  v === null ? '-' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (v: number | null) => (v === null ? 'text-faint' : v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : '');

const EMPTY: WatchInput = { symbol: '', shares: null, avgCost: null, dcaMonthly: null, targetPct: null, note: '' };

const DAY = 86_400_000;
const STATUS_CLS: Record<LevelStatus, string> = {
  'near-support': 'bg-accent/15 text-accent',
  'near-resistance': 'bg-warn/15 text-warn',
  'broke-support': 'bg-bad/15 text-bad',
  'broke-resistance': 'bg-ok/15 text-ok',
  between: '',
};

/** แนวรับ/แนวต้านใกล้สุด + ป้ายสถานะ */
function LevelCell({ lv }: { lv: KeyLevels | null }) {
  if (!lv) return <td className="pl-3 text-faint">-</td>;
  const r = lv.resistances[0];
  const s = lv.supports[0];
  const line = (label: string, v: typeof r, cls: string) => (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className={`w-7 text-[11px] ${cls}`}>{label}</span>
      {v ? (
        <>
          <span className="text-fg-2" title={`แตะ ${v.touches} ครั้ง`}>{v.price.toFixed(2)}</span>
          <span className="text-[11px] text-faint">{pct(v.distancePct)}</span>
          <span className="text-[10px] tracking-tighter text-faint" title="ความแข็งของระดับ (จำนวนครั้งที่ราคากลับตัว)">
            {'●'.repeat(v.strength)}
          </span>
        </>
      ) : (
        <span className="text-[11px] text-faint">ไม่มี</span>
      )}
    </div>
  );
  return (
    <td className="pl-3 tabular-nums">
      {line('ต้าน', r, 'text-bear')}
      {line('รับ', s, 'text-bull')}
      {lv.status !== 'between' && <span className={`badge mt-1 ${STATUS_CLS[lv.status]}`}>{LEVEL_STATUS_TH[lv.status]}</span>}
    </td>
  );
}

/** ป้ายวันประกาศงบ — เตือนถ้าเหลือไม่ถึง 7 วัน */
function EarningsBadge({ t }: { t: number | null }) {
  if (t === null) return null;
  const days = Math.ceil((t - Date.now()) / DAY);
  if (days < -1) return null;
  const soon = days <= 7;
  return (
    <div className={`mt-0.5 text-[11px] ${soon ? 'text-warn' : 'text-faint'}`} title="วันประกาศงบ (ประมาณจาก Yahoo อาจคลาด ±2 วัน)">
      งบ {new Date(t).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })}
      {soon && ` · ${days <= 0 ? 'วันนี้' : `อีก ${days} วัน`}`}
    </div>
  );
}

/** จัดพอร์ตเดือนนี้: แบ่งเงิน DCA ให้กลับเข้าสัดส่วนเป้าหมาย */
function RebalanceCard({ rows, defaultBudget }: { rows: WatchRow[]; defaultBudget: number }) {
  const [budget, setBudget] = useState<number | null>(null);
  const [allowSell, setAllowSell] = useState(false);
  const money = budget ?? defaultBudget;
  const withTarget = rows.filter((r) => r.targetPct !== null && r.targetPct > 0 && r.metrics);
  const result = useMemo(
    () =>
      rebalance(
        withTarget.map((r) => ({ symbol: r.symbol, value: r.value ?? 0, price: r.metrics!.close, targetPct: r.targetPct })),
        { budget: allowSell ? 0 : money, allowSell },
      ),
    [withTarget, money, allowSell],
  );

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3">
        <div className="mr-auto">
          <h2 className="text-[13px] font-semibold text-fg">จัดพอร์ตเดือนนี้</h2>
          <p className="text-xs text-muted">ใส่ "เป้า %" ให้แต่ละตัว (กด แก้) แล้วแอปคิดว่าเงินก้อนนี้ควรลงตัวไหนเท่าไร</p>
        </div>
        <div className="seg">
          <button aria-pressed={!allowSell} onClick={() => setAllowSell(false)}>
            ซื้ออย่างเดียว (DCA)
          </button>
          <button aria-pressed={allowSell} onClick={() => setAllowSell(true)}>
            ปรับเต็ม (ซื้อ + ขาย)
          </button>
        </div>
        {!allowSell && (
          <label className="flex items-center gap-2 text-xs text-muted">
            เงินเดือนนี้ $
            <input
              type="number"
              min={0}
              value={money || ''}
              placeholder="0"
              onChange={(e) => setBudget(e.target.value === '' ? 0 : e.target.valueAsNumber)}
              className="field w-24 tabular-nums"
            />
          </label>
        )}
      </div>
      {!result ? (
        <p className="px-5 py-4 text-[13px] text-muted">ยังไม่มีตัวไหนตั้งเป้า % — กด "แก้" ที่แถวหุ้นแล้วใส่ เช่น VOO 60, QQQ 40</p>
      ) : (
        <>
          {Math.abs(result.targetSum - 100) > 0.01 && (
            <p className="px-5 pt-3 text-xs text-warn">เป้ารวมได้ {result.targetSum.toFixed(0)}% — แอปปรับสัดส่วนให้รวมเป็น 100% ให้เอง</p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th className="pl-5">หุ้น</th>
                <th className="w-[40%]">ตอนนี้ → เป้า</th>
                <th className="text-right">{allowSell ? 'ซื้อ / ขาย' : 'ซื้อเพิ่ม'}</th>
                <th className="text-right">≈ หุ้น</th>
                <th className="pr-5 text-right">หลังปรับ</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((x) => (
                <tr key={x.symbol}>
                  <td className="pl-5 font-semibold text-fg">{x.symbol}</td>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="relative h-1.5 flex-1 rounded-full bg-field">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-accent/60" style={{ width: `${Math.min(x.currentPct, 100)}%` }} />
                        <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-fg" style={{ left: `${Math.min(x.targetPct, 100)}%` }} title={`เป้า ${x.targetPct.toFixed(1)}%`} />
                      </div>
                      <span className="w-24 text-right text-xs tabular-nums text-muted">
                        {x.currentPct.toFixed(1)}% → {x.targetPct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className={`text-right tabular-nums ${x.trade > 0.005 ? 'text-bull' : x.trade < -0.005 ? 'text-bear' : 'text-faint'}`}>
                    {Math.abs(x.trade) < 0.005 ? '-' : `${x.trade > 0 ? '+' : ''}${usd(x.trade)}`}
                  </td>
                  <td className="text-right tabular-nums text-muted">{Math.abs(x.shares) < 0.0005 ? '-' : x.shares.toFixed(3)}</td>
                  <td className="pr-5 text-right tabular-nums text-fg-2">{x.afterPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-3 text-xs text-faint">
            {allowSell
              ? 'ขายตัวที่เกินเป้าแล้วซื้อตัวที่ขาด ให้ตรงเป้าพอดี — การขายอาจมีภาษี/ค่าธรรมเนียม'
              : 'ไม่ขายของเดิม ใส่เงินใหม่ให้ตัวที่ต่ำกว่าเป้าก่อน — Dime ซื้อเศษหุ้นได้'}
            {' · '}ตัวเลขช่วยคิด ไม่ใช่คำแนะนำการลงทุน
          </p>
        </>
      )}
    </div>
  );
}

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
  const [selectedSummaryRow, setSelectedSummaryRow] = useState<WatchRow | null>(null);

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
          className="card grid grid-cols-2 items-end gap-3 p-5 sm:grid-cols-7"
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
          <Field label="เป้า % ในพอร์ต">
            <NumInput value={draft.targetPct} onChange={(v) => setDraft({ ...draft, targetPct: v })} placeholder="เช่น 40" />
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
                <th className="text-right">1 เดือน</th>
                <th className="text-right">YTD</th>
                <th className="text-right">1 ปี</th>
                <th className="text-right" title="ห่างจากจุดสูงสุด 52 สัปดาห์">จาก high</th>
                <th className="pl-3" title="ราคาเทียบเส้นค่าเฉลี่ย 50 / 200 วัน">MA50 / 200</th>
                <th className="text-right">RSI</th>
                <th className="pl-3" title="แนวรับต้านแบบง่ายจากกราฟ D1 (● = ความแข็ง)">แนวรับ / ต้าน</th>
                <th className="pl-3" title="สรุปวิเคราะห์ทางเทคนิคและอัตราส่วนงบการเงิน">วิเคราะห์ & งบ</th>
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
                      <EarningsBadge t={r.earnings} />
                      {r.note && <div className="max-w-[10rem] truncate text-[11px] text-faint" title={r.note}>{r.note}</div>}
                    </td>
                    {m ? (
                      <>
                        <td className="text-right tabular-nums">{m.close.toFixed(2)}</td>
                        <td className={`text-right tabular-nums ${tone(m.change1d)}`}>{pct(m.change1d)}</td>
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
                        <LevelCell lv={r.levels} />
                        <td className="pl-3">
                          {r.summary ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => setSelectedSummaryRow(r)}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 ${
                                  r.summary.bias === 'bullish'
                                    ? 'bg-bull/15 text-bull'
                                    : r.summary.bias === 'bearish'
                                      ? 'bg-bear/15 text-bear'
                                      : 'bg-accent/15 text-accent'
                                }`}
                                title="คลิกเพื่อดูบทวิเคราะห์และงบการเงินเต็ม"
                              >
                                <span>
                                  {r.summary.bias === 'bullish' ? '▲ ขาขึ้น' : r.summary.bias === 'bearish' ? '▼ ขาลง' : '● พักตัว'}
                                </span>
                                <span className="text-[10px] text-muted underline">สรุป</span>
                              </button>
                              <div className="flex items-center gap-2 text-[11px] tabular-nums text-faint">
                                <span>P/E {r.fundamentals?.pe != null ? r.fundamentals.pe.toFixed(1) : '-'}</span>
                                {r.fundamentals?.revenueGrowth != null && (
                                  <span className={r.fundamentals.revenueGrowth >= 0 ? 'text-bull' : 'text-bear'}>
                                    โต {(r.fundamentals.revenueGrowth * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-faint">-</span>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan={10} className="text-faint">
                        ยังไม่มีราคา — กด ⟳ อัปเดตราคา
                      </td>
                    )}
                    <td className="text-right tabular-nums">
                      {isEditing ? (
                        <div className="ml-auto w-24 space-y-1">
                          <NumInput value={editing.draft.shares} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, shares: v } })} placeholder="หุ้น" />
                          <NumInput value={editing.draft.avgCost} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, avgCost: v } })} placeholder="ต้นทุน $" />
                          <NumInput value={editing.draft.dcaMonthly} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, dcaMonthly: v } })} placeholder="DCA/เดือน" />
                          <NumInput value={editing.draft.targetPct} onChange={(v) => setEditing({ ...editing, draft: { ...editing.draft, targetPct: v } })} placeholder="เป้า %" />
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
                      {r.targetPct !== null && <div className="text-[11px]">เป้า {r.targetPct}%</div>}
                      {r.dcaMonthly ? <div className="text-[11px]">DCA {usd(r.dcaMonthly)}</div> : null}
                    </td>
                    <td className="whitespace-nowrap pl-2 pr-4 text-right">
                      {isEditing ? (
                        <>
                          <button onClick={() => void run(async () => { await updateWatch(r.id, editing.draft); setEditing(null); })} className="btn btn-sm btn-primary">
                            บันทึก
                          </button>
                          <button onClick={() => setEditing(null)} className="btn btn-sm btn-ghost ml-1">
                            ยกเลิก
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setSelectedSummaryRow(r)} className="btn btn-sm btn-ghost" title="ดูสรุปวิเคราะห์หุ้นและงบการเงิน">
                            สรุป
                          </button>
                          <button onClick={() => onOpenChart?.(r.symbol, 'D1')} className="btn btn-sm btn-ghost">
                            กราฟ
                          </button>
                          <button onClick={() => setEditing({ id: r.id, draft: { shares: r.shares, avgCost: r.avgCost, dcaMonthly: r.dcaMonthly, targetPct: r.targetPct, note: r.note } })} className="btn btn-sm btn-ghost">
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
        {rows.length > 0 && <RebalanceCard rows={rows} defaultBudget={total.dca} />}

        <p className="text-xs leading-relaxed text-faint">
          แนวรับต้านคำนวณจาก swing ของกราฟ D1 (● ยิ่งมากยิ่งแข็ง) · วันประกาศงบประมาณจาก Yahoo อาจคลาด ±2 วัน · ราคาจาก Yahoo Finance (ปรับ split แล้ว ไม่รวมปันผล) มูลค่าเป็น USD — ตัวเลขเป็นข้อมูลประกอบ ไม่ใช่คำแนะนำซื้อขาย
        </p>
        </div>
      </div>

      <StockSummaryModal
        isOpen={!!selectedSummaryRow}
        onClose={() => setSelectedSummaryRow(null)}
        symbol={selectedSummaryRow?.symbol ?? ''}
        summary={selectedSummaryRow?.summary ?? null}
        fundamentals={selectedSummaryRow?.fundamentals ?? null}
        onOpenChart={(s) => onOpenChart?.(s, 'D1')}
      />
    </div>
  );
}
