import { useCallback, useEffect, useState } from 'react';
import type { Timeframe } from '@zonedee/core';
import {
  checkAlertsNow,
  clearAlertEvents,
  createAlertRule,
  createJournal,
  deleteAlertRule,
  fetchAlertEvents,
  fetchAlertRules,
  fetchAlertStatus,
  fetchLineQuota,
  fetchStrategies,
  fetchSymbols,
  testLine,
  updateAlertRule,
  type AlertEvent,
  type AlertRule,
  type AlertRuleInput,
  type AlertStatus,
  type StrategyInfo,
  type SymbolSummary,
} from '../api';
import { ParamForm, inputCls } from '../components/ParamForm';
import { TradePreview } from '../components/TradePreview';
import { formatThaiTime } from '../format';

const LINE_BADGE: Record<AlertEvent['line'], { text: string; cls: string }> = {
  sent: { text: 'ส่ง LINE แล้ว', cls: 'bg-emerald-950 text-emerald-300' },
  failed: { text: 'LINE ล้มเหลว', cls: 'bg-red-950 text-red-300' },
  capped: { text: 'ครบโควต้าวันนี้', cls: 'bg-amber-950 text-amber-300' },
  off: { text: 'ในแอปเท่านั้น', cls: 'bg-slate-800 text-slate-400' },
};
const CONDITION_LABEL = { 'cross-above': 'ปิดเหนือ', 'cross-below': 'ปิดใต้', touch: 'แตะ' } as const;

const EMPTY_RULE: AlertRuleInput = {
  kind: 'strategy',
  symbol: 'XAUUSD',
  tf: 'M15',
  strategy: 'ema-cross',
  params: {},
  condition: 'cross-above',
  price: null,
  once: true,
  notifyLine: true,
  name: '',
};

export default function AlertsView({ onEventsSeen }: { onEventsSeen?: (lastId: number) => void }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [symbols, setSymbols] = useState<SymbolSummary[]>([]);
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [editing, setEditing] = useState<{ id: number | null; draft: AlertRuleInput } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quota, setQuota] = useState<string | null>(null);
  const [preview, setPreview] = useState<AlertEvent | null>(null);

  const reload = useCallback(async () => {
    try {
      const [r, e, s] = await Promise.all([fetchAlertRules(), fetchAlertEvents(), fetchAlertStatus()]);
      setRules(r);
      setEvents(e);
      setStatus(s);
      if (e[0]) onEventsSeen?.(e[0].id);
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    }
  }, [onEventsSeen]);

  useEffect(() => {
    void reload();
    void fetchSymbols().then(setSymbols).catch(() => undefined);
    void fetchStrategies().then(setStrategies).catch(() => undefined);
    const id = setInterval(() => void reload(), 20_000);
    return () => clearInterval(id);
  }, [reload]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ kind: 'ok', text: ok });
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveRule = () =>
    editing &&
    run(async () => {
      if (editing.id === null) await createAlertRule(editing.draft);
      else await updateAlertRule(editing.id, editing.draft);
      setEditing(null);
    }, 'บันทึกการแจ้งเตือนแล้ว — จะเริ่มตรวจเมื่อแท่งถัดไปปิด');

  const toJournal = (e: AlertEvent) =>
    e.signal &&
    run(
      () =>
        createJournal({
          symbol: e.symbol,
          tf: e.tf,
          direction: e.signal!.direction,
          status: 'plan',
          entryTime: e.barTime,
          entryPrice: e.signal!.entry,
          sl: e.signal!.sl,
          tp: e.signal!.tp,
          strategy: e.strategy,
          signalTime: e.barTime,
          setup: e.signal!.reason,
        }),
      'บันทึกลง Journal แล้ว (สถานะ: แผน)',
    );

  const d = editing?.draft;
  const info = symbols.find((s) => s.symbol === d?.symbol);
  const strat = strategies.find((s) => s.id === d?.strategy);
  const setDraft = (patch: AlertRuleInput) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* สถานะ */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2 text-xs">
        <h2 className="text-sm font-semibold text-white">แจ้งเตือน</h2>
        {status && (
          <>
            <span className={status.engine.running ? 'text-emerald-400' : 'text-slate-500'}>
              ● ตัวตรวจ{status.engine.running ? 'ทำงานอยู่' : 'หยุดอยู่'}
            </span>
            <span className="text-slate-400">
              ตรวจล่าสุด {status.engine.lastTick ? formatThaiTime(status.engine.lastTick, false) : '-'}
            </span>
            <span className={status.line.configured ? 'text-emerald-400' : 'text-amber-300'}>
              LINE {status.line.configured ? `พร้อม · วันนี้ส่ง ${status.lineSentToday}/${status.linePerDay}` : 'ยังไม่ได้ตั้งค่า'}
            </span>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
            <button
              onClick={() => void Notification.requestPermission().then(() => setMsg({ kind: 'ok', text: 'ตั้งค่าแจ้งเตือนบนเครื่องแล้ว' }))}
              className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line"
              title="เด้งแจ้งเตือนของ Windows ตอนเปิดแอปค้างไว้ (แม้อยู่หน้าอื่น)"
            >
              เปิดแจ้งเตือนบนเครื่อง
            </button>
          )}
          {status?.line.configured && (
            <>
              <button
                onClick={() =>
                  void fetchLineQuota()
                    .then((q) => setQuota(q.limit === null ? `ใช้ไป ${q.used} (ไม่จำกัด)` : `เดือนนี้ใช้ ${q.used}/${q.limit}`))
                    .catch((e: Error) => setMsg({ kind: 'error', text: e.message }))
                }
                className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line"
              >
                {quota ?? 'เช็กโควต้า LINE'}
              </button>
              <button onClick={() => void run(testLine, 'ส่งข้อความทดสอบแล้ว — ดูใน LINE')} disabled={busy} className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line disabled:opacity-50">
                ส่งทดสอบ
              </button>
            </>
          )}
          <button onClick={() => void run(checkAlertsNow, 'ตรวจทุกกฎแล้ว')} disabled={busy} className="rounded border border-line px-2 py-1 text-slate-300 hover:bg-line disabled:opacity-50">
            ตรวจเดี๋ยวนี้
          </button>
          <button onClick={() => setEditing({ id: null, draft: { ...EMPTY_RULE } })} className="rounded-md bg-blue-600 px-2.5 py-1 font-semibold text-white hover:bg-blue-500">
            + เพิ่มการแจ้งเตือน
          </button>
        </div>
      </div>
      {msg && (
        <div className={`border-b px-4 py-1 text-xs ${msg.kind === 'ok' ? 'border-emerald-900/50 bg-emerald-950/40 text-emerald-300' : 'border-red-900/50 bg-red-950/40 text-red-300'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* กฎ */}
        <section className="w-[26rem] shrink-0 overflow-y-auto border-r border-line p-3 text-xs">
          {editing && d && (
            <div className="mb-3 space-y-2 rounded-md border border-blue-800/60 bg-panel p-3">
              <div className="flex overflow-hidden rounded border border-line">
                {(
                  [
                    ['strategy', 'เมื่อท่าเกิดสัญญาณ'],
                    ['price', 'เมื่อราคาถึงระดับ'],
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} onClick={() => setDraft({ kind: k })} className={`flex-1 py-1 ${d.kind === k ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-line'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-slate-400">Symbol</span>
                  <select value={d.symbol} onChange={(e) => setDraft({ symbol: e.target.value })} className={inputCls}>
                    {symbols.map((s) => (
                      <option key={s.symbol}>{s.symbol}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-slate-400">TF</span>
                  <select value={d.tf} onChange={(e) => setDraft({ tf: e.target.value as Timeframe })} className={inputCls}>
                    {(info?.timeframes ?? [d.tf!]).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
              {d.kind === 'strategy' ? (
                <>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-slate-400">ท่า</span>
                    <select value={d.strategy} onChange={(e) => setDraft({ strategy: e.target.value, params: {} })} className={inputCls}>
                      {strategies.map((s) => (
                        <option key={s.id} value={s.id} disabled={!s.timeframes.includes(d.tf!)}>
                          {s.name} [{s.source}]
                        </option>
                      ))}
                    </select>
                  </label>
                  {strat && (
                    <details>
                      <summary className="cursor-pointer text-[11px] text-slate-400">ปรับค่าของท่า (ใช้ค่าเดียวกับที่ backtest ได้)</summary>
                      <div className="mt-2">
                        <ParamForm specs={strat.params} values={d.params ?? {}} onChange={(k, v) => setDraft({ params: { ...d.params, [k]: v } })} />
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-slate-400">เงื่อนไข</span>
                    <select value={d.condition} onChange={(e) => setDraft({ condition: e.target.value as AlertRule['condition'] })} className={inputCls}>
                      <option value="cross-above">แท่งปิดเหนือ</option>
                      <option value="cross-below">แท่งปิดใต้</option>
                      <option value="touch">ไส้แตะ</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-slate-400">ราคา</span>
                    <input type="number" step="any" value={d.price ?? ''} onChange={(e) => setDraft({ price: e.target.value === '' ? null : e.target.valueAsNumber })} className={`${inputCls} font-mono`} />
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-slate-300">
                    <input type="checkbox" checked={d.once !== false} onChange={(e) => setDraft({ once: e.target.checked })} className="accent-blue-500" />
                    เตือนครั้งเดียวแล้วปิด
                  </label>
                </div>
              )}
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-slate-400">ชื่อ (ไม่ใส่ก็ได้)</span>
                <input value={d.name ?? ''} onChange={(e) => setDraft({ name: e.target.value })} className={inputCls} />
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={d.notifyLine !== false} onChange={(e) => setDraft({ notifyLine: e.target.checked })} className="accent-blue-500" />
                ส่งเข้า LINE ด้วย {!status?.line.configured && <span className="text-amber-300">(ยังไม่ได้ตั้งค่า LINE)</span>}
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => void saveRule()} disabled={busy} className="flex-1 rounded bg-blue-600 py-1 font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                  บันทึก
                </button>
                <button onClick={() => setEditing(null)} className="rounded border border-line px-3 py-1 text-slate-300 hover:bg-line">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {rules.length === 0 && !editing && (
            <p className="leading-relaxed text-slate-500">
              ยังไม่มีการแจ้งเตือน — กด "+ เพิ่มการแจ้งเตือน" แล้วเลือกท่าที่ backtest แล้วดูดี ระบบจะตรวจทุกครั้งที่แท่งปิด (ต้องเปิด npm run dev ค้างไว้
              และ MT5 เปิดอยู่ถ้าใช้ข้อมูลจาก MT5)
            </p>
          )}
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className={`rounded-md border border-line bg-panel p-2.5 ${r.enabled ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex cursor-pointer items-center" title={r.enabled ? 'ปิด' : 'เปิด'}>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => void run(() => updateAlertRule(r.id, { enabled: e.target.checked }))} className="peer sr-only" />
                    <span className="h-4 w-7 rounded-full bg-slate-600 transition-colors peer-checked:bg-blue-600" />
                    <span className="absolute left-0.5 h-3 w-3 rounded-full bg-white transition-transform peer-checked:translate-x-3" />
                  </label>
                  <span className="truncate font-medium text-white">{r.name}</span>
                  {r.notifyLine && <span className="text-[10px] text-emerald-400">LINE</span>}
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => {
                        const { id, createdAt: _c, updatedAt: _u, lastCheckedBar: _l, lastFiredAt: _f, lastError: _e, ...rest } = r;
                        setEditing({ id, draft: rest });
                      }}
                      className="rounded px-1.5 text-slate-400 hover:bg-line hover:text-white"
                    >
                      แก้
                    </button>
                    <button
                      onClick={() => window.confirm(`ลบ "${r.name}"?`) && void run(() => deleteAlertRule(r.id))}
                      className="rounded px-1.5 text-slate-500 hover:bg-line hover:text-red-300"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {r.symbol} {r.tf} ·{' '}
                  {r.kind === 'strategy' ? strategyName(r.strategy) : `${CONDITION_LABEL[r.condition]} ${r.price}${r.once ? ' (ครั้งเดียว)' : ''}`}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  ตรวจถึงแท่ง {r.lastCheckedBar ? formatThaiTime(r.lastCheckedBar, false) : '— (รอแท่งปิด)'}
                  {r.lastFiredAt ? ` · เตือนล่าสุด ${formatThaiTime(r.lastFiredAt, false)}` : ''}
                </div>
                {r.lastError && <div className="mt-1 text-[10px] text-amber-300">{r.lastError}</div>}
              </li>
            ))}
          </ul>

          {status && !status.line.configured && (
            <div className="mt-4 rounded-md border border-line bg-surface p-3 leading-relaxed text-slate-400">
              <div className="mb-1 font-medium text-slate-200">ตั้งค่าให้ส่งเข้า LINE (ทำครั้งเดียว)</div>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>สร้าง LINE Official Account (ฟรี) ที่ manager.line.biz</li>
                <li>ในหน้า OA → ตั้งค่า → Messaging API → เปิดใช้ (จะได้ channel ใน developers.line.biz)</li>
                <li>developers.line.biz → channel นั้น → แท็บ Messaging API → ออก Channel access token</li>
                <li>แท็บ Basic settings → คัดลอก Your user ID (ขึ้นต้นด้วย U)</li>
                <li>แอด OA ของตัวเองเป็นเพื่อนใน LINE (สแกน QR ในแท็บ Messaging API)</li>
                <li>
                  คัดลอก <code>.env.example</code> เป็น <code>.env</code> ใส่ค่าทั้งสอง แล้วเปิด <code>npm run dev</code> ใหม่
                </li>
              </ol>
              <p className="mt-1">แผนฟรีส่งได้จำกัดต่อเดือน — แอปจำกัดไว้ {status.linePerDay} ข้อความ/วันกันหมดโควต้า</p>
            </div>
          )}
        </section>

        {/* เหตุการณ์ */}
        <section className="min-w-0 flex-1 overflow-y-auto p-3 text-xs">
          <div className="mb-2 flex items-center">
            <span className="text-[11px] font-medium text-slate-300">การแจ้งเตือนล่าสุด</span>
            {events.length > 0 && (
              <button onClick={() => window.confirm('ล้างประวัติทั้งหมด?') && void run(clearAlertEvents)} className="ml-auto text-[10px] text-slate-500 underline hover:text-slate-300">
                ล้างประวัติ
              </button>
            )}
          </div>
          {events.length === 0 && <p className="text-slate-500">ยังไม่มี — เมื่อเงื่อนไขเกิด จะขึ้นที่นี่ (และเด้งแจ้งเตือนบนเครื่องถ้าอนุญาต)</p>}
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-md border border-line bg-panel p-2.5">
                <div className="flex items-center gap-2">
                  {e.signal && (
                    <span className={`font-semibold ${e.signal.direction === 'long' ? 'text-bull' : 'text-bear'}`}>{e.signal.direction === 'long' ? 'BUY' : 'SELL'}</span>
                  )}
                  <span className="font-medium text-white">{e.ruleName}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${LINE_BADGE[e.line].cls}`} title={e.lineError ?? undefined}>
                    {LINE_BADGE[e.line].text}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-500">{formatThaiTime(e.firedAt)}</span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-slate-300">{e.message}</pre>
                {e.lineError && <div className="mt-1 text-[10px] text-red-300">{e.lineError}</div>}
                {e.signal && (
                  <div className="mt-1.5 flex gap-2">
                    <button onClick={() => setPreview(e)} className="rounded border border-line px-2 py-0.5 text-slate-300 hover:bg-line">
                      ดูบนกราฟ
                    </button>
                    <button onClick={() => void toJournal(e)} className="rounded border border-line px-2 py-0.5 text-slate-300 hover:bg-line">
                      📓 บันทึกลง Journal
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {preview?.signal && (
        <TradePreview
          symbol={preview.symbol}
          tf={preview.tf}
          digits={symbols.find((s) => s.symbol === preview.symbol)?.digits ?? 2}
          trade={{
            direction: preview.signal.direction,
            entryTime: preview.barTime,
            exitTime: null,
            entry: preview.signal.entry,
            sl: preview.signal.sl,
            tp: preview.signal.tp,
            exit: null,
            r: null,
            title: preview.ruleName,
            subtitle: preview.signal.reason,
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
