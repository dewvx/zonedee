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
  type LevelCondition,
  type StrategyInfo,
  type SymbolSummary,
} from '../api';
import { ParamForm } from '../components/ParamForm';
import { TradePreview } from '../components/TradePreview';
import { formatThaiTime } from '../format';
import { Icon } from '../components/Icon';
import { Empty, Field, Note, PageHeader } from '../components/ui';

const LINE_BADGE: Record<AlertEvent['line'], { text: string; cls: string }> = {
  sent: { text: 'ส่ง LINE แล้ว', cls: 'bg-ok/12 text-ok' },
  failed: { text: 'ส่ง LINE ไม่ได้', cls: 'bg-bad/12 text-bad' },
  capped: { text: 'ครบโควต้าวันนี้', cls: 'bg-warn/12 text-warn' },
  off: { text: 'ในแอปเท่านั้น', cls: 'bg-hover text-muted' },
};
const CONDITION_LABEL = { 'cross-above': 'ปิดเหนือ', 'cross-below': 'ปิดใต้', touch: 'แตะ' } as const;
const LEVEL_LABEL: Record<LevelCondition, string> = {
  'near-support': 'ราคาลงมาใกล้แนวรับ',
  'near-resistance': 'ราคาขึ้นมาใกล้แนวต้าน',
  'broke-support': 'ปิดหลุดแนวรับ',
  'broke-resistance': 'ปิดทะลุแนวต้าน',
};
const KIND_TABS = [
  ['strategy', 'ท่าเทรด'],
  ['price', 'ราคา'],
  ['level', 'แนวรับต้าน'],
  ['earnings', 'วันงบ'],
] as const;

const EMPTY_RULE: AlertRuleInput = {
  kind: 'strategy',
  symbol: 'XAUUSD',
  tf: 'M15',
  strategy: 'ema-cross',
  params: {},
  condition: 'cross-above',
  price: null,
  once: true,
  levelCondition: 'near-support',
  daysBefore: 3,
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
      <PageHeader
        title="แจ้งเตือน"
        subtitle={
          status ? (
            <span className="flex flex-wrap gap-x-4">
              <span className={status.engine.running ? 'text-ok' : 'text-faint'}>
                {status.engine.running ? 'ตัวตรวจทำงานอยู่' : 'ตัวตรวจหยุดอยู่'}
              </span>
              <span>ตรวจล่าสุด {status.engine.lastTick ? formatThaiTime(status.engine.lastTick, false) : '—'}</span>
              <span className={status.line.configured ? 'text-ok' : 'text-warn'}>
                {status.line.configured ? `LINE พร้อม — วันนี้ส่ง ${status.lineSentToday}/${status.linePerDay}` : 'LINE ยังไม่ได้ตั้งค่า'}
              </span>
            </span>
          ) : undefined
        }
      >
        {typeof Notification !== 'undefined' && Notification.permission === 'default' && (
          <button
            onClick={() => void Notification.requestPermission().then(() => setMsg({ kind: 'ok', text: 'ตั้งค่าแจ้งเตือนบนเครื่องแล้ว' }))}
            className="btn btn-sm"
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
              className="btn btn-sm"
            >
              {quota ?? 'เช็กโควต้า LINE'}
            </button>
            <button onClick={() => void run(testLine, 'ส่งข้อความทดสอบแล้ว — ดูใน LINE')} disabled={busy} className="btn btn-sm">
              ส่งทดสอบ
            </button>
          </>
        )}
        <button onClick={() => void run(checkAlertsNow, 'ตรวจทุกกฎแล้ว')} disabled={busy} className="btn btn-sm">
          <Icon name="refresh" size={14} />
          ตรวจเดี๋ยวนี้
        </button>
        <button onClick={() => setEditing({ id: null, draft: { ...EMPTY_RULE } })} className="btn btn-primary btn-sm">
          <Icon name="plus" size={14} />
          เพิ่มการแจ้งเตือน
        </button>
      </PageHeader>
      {msg && (
        <div className="px-5 pt-4">
          <Note kind={msg.kind === 'ok' ? 'ok' : 'bad'} onClose={() => setMsg(null)}>
            {msg.text}
          </Note>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* กฎ */}
        <section className="w-[28rem] shrink-0 space-y-3 overflow-y-auto border-r border-line p-5">
          {editing && d && (
            <div className="card space-y-3 border-accent/40 p-5">
              <div>
                <span className="label">เตือนเมื่อ</span>
                <div className="seg flex w-full">
                  {KIND_TABS.map(([k, label]) => (
                    <button
                      key={k}
                      aria-pressed={d.kind === k}
                      onClick={() => {
                        // แนวรับต้าน / วันงบ ใช้กับกราฟรายวันเป็นหลัก
                        const daily = (k === 'level' || k === 'earnings') && (info?.timeframes ?? []).includes('D1');
                        setDraft({ kind: k, ...(daily ? { tf: 'D1' as Timeframe } : {}) });
                      }}
                      className="flex-1"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Symbol</span>
                  <select value={d.symbol} onChange={(e) => setDraft({ symbol: e.target.value })} className="field">
                    {symbols.map((s) => (
                      <option key={s.symbol}>{s.symbol}</option>
                    ))}
                  </select>
                </label>
                {d.kind === 'earnings' ? (
                  <label className="block">
                    <span className="label">เตือนล่วงหน้า (วัน)</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={d.daysBefore ?? 3}
                      onChange={(e) => setDraft({ daysBefore: e.target.valueAsNumber || 0 })}
                      className="field tabular-nums"
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="label">TF</span>
                    <select value={d.tf} onChange={(e) => setDraft({ tf: e.target.value as Timeframe })} className="field">
                      {(info?.timeframes ?? [d.tf!]).map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {d.kind === 'earnings' ? (
                <p className="text-xs leading-relaxed text-muted">
                  {info && info.market !== 'us-stock' ? (
                    <span className="text-warn">วันประกาศงบมีเฉพาะหุ้น US — เลือกหุ้นก่อน</span>
                  ) : (
                    'เตือนครั้งเดียวต่อรอบประกาศงบ วันที่ประมาณจาก Yahoo (อาจคลาด ±2 วัน) — ราคามักแกว่งแรงช่วงนี้'
                  )}
                </p>
              ) : d.kind === 'level' ? (
                <>
                  <label className="block">
                    <span className="label">เงื่อนไข</span>
                    <select value={d.levelCondition} onChange={(e) => setDraft({ levelCondition: e.target.value as LevelCondition })} className="field">
                      {(Object.keys(LEVEL_LABEL) as LevelCondition[]).map((k) => (
                        <option key={k} value={k}>
                          {LEVEL_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs leading-relaxed text-muted">
                    ใช้แนวรับต้านแบบง่ายตัวเดียวกับหน้าลงทุน ("ใกล้" = ห่างไม่เกิน 3%) · เตือนตอนเพิ่งเข้าเงื่อนไข ไม่เตือนซ้ำทุกแท่ง · แนะนำ D1
                  </p>
                </>
              ) : d.kind === 'strategy' ? (
                <>
                  <label className="block">
                    <span className="label">ท่า</span>
                    <select value={d.strategy} onChange={(e) => setDraft({ strategy: e.target.value, params: {} })} className="field">
                      {strategies.map((s) => (
                        <option key={s.id} value={s.id} disabled={!s.timeframes.includes(d.tf!)}>
                          {s.name} [{s.source}]
                        </option>
                      ))}
                    </select>
                  </label>
                  {strat && (
                    <details>
                      <summary className="flex items-center gap-1 text-xs text-accent">
                        <Icon name="right" size={12} className="chev" />
                        ปรับค่าของท่า (ใช้ค่าเดียวกับที่ backtest ได้)
                      </summary>
                      <div className="mt-2">
                        <ParamForm specs={strat.params} values={d.params ?? {}} onChange={(k, v) => setDraft({ params: { ...d.params, [k]: v } })} />
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="label">เงื่อนไข</span>
                    <select value={d.condition} onChange={(e) => setDraft({ condition: e.target.value as AlertRule['condition'] })} className="field">
                      <option value="cross-above">แท่งปิดเหนือ</option>
                      <option value="cross-below">แท่งปิดใต้</option>
                      <option value="touch">ไส้แตะ</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">ราคา</span>
                    <input type="number" step="any" value={d.price ?? ''} onChange={(e) => setDraft({ price: e.target.value === '' ? null : e.target.valueAsNumber })} className="field tabular-nums" />
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-fg-2">
                    <input type="checkbox" checked={d.once !== false} onChange={(e) => setDraft({ once: e.target.checked })} className="accent-accent" />
                    เตือนครั้งเดียวแล้วปิด
                  </label>
                </div>
              )}
              <label className="block">
                <span className="label">ชื่อ (ไม่ใส่ก็ได้)</span>
                <input value={d.name ?? ''} onChange={(e) => setDraft({ name: e.target.value })} className="field" />
              </label>
              <label className="flex items-center gap-2 text-fg-2">
                <input type="checkbox" checked={d.notifyLine !== false} onChange={(e) => setDraft({ notifyLine: e.target.checked })} className="accent-accent" />
                ส่งเข้า LINE ด้วย {!status?.line.configured && <span className="text-warn">(ยังไม่ได้ตั้งค่า LINE)</span>}
              </label>
              <div className="flex gap-2 pt-1">
                <button onClick={() => void saveRule()} disabled={busy} className="btn btn-primary flex-1">
                  บันทึก
                </button>
                <button onClick={() => setEditing(null)} className="btn">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {rules.length === 0 && !editing && (
            <p className="text-[13px] leading-relaxed text-muted">
              ยังไม่มีการแจ้งเตือน — กด "เพิ่มการแจ้งเตือน" แล้วเลือกท่าที่ backtest แล้วดูดี ระบบจะตรวจทุกครั้งที่แท่งปิด (ต้องเปิด npm run dev ค้างไว้
              และเปิด MT5 ไว้ถ้าใช้ข้อมูลจาก MT5)
            </p>
          )}
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className={`card p-4 transition-opacity ${r.enabled ? '' : 'opacity-55'}`}>
                <div className="flex items-center gap-2">
                  <button
                    role="switch"
                    aria-checked={r.enabled}
                    aria-label={r.enabled ? 'ปิดการแจ้งเตือนนี้' : 'เปิดการแจ้งเตือนนี้'}
                    onClick={() => void run(() => updateAlertRule(r.id, { enabled: !r.enabled }))}
                    className="switch"
                  />
                  <span className="truncate font-semibold text-fg">{r.name}</span>
                  {r.notifyLine && <span className="badge bg-ok/12 text-ok">LINE</span>}
                  <div className="ml-auto flex gap-1">
                    <button
                      onClick={() => {
                        const { id, createdAt: _c, updatedAt: _u, lastCheckedBar: _l, lastFiredAt: _f, lastError: _e, ...rest } = r;
                        setEditing({ id, draft: rest });
                      }}
                      className="btn btn-sm btn-ghost"
                    >
                      แก้
                    </button>
                    <button
                      onClick={() => window.confirm(`ลบ "${r.name}"?`) && void run(() => deleteAlertRule(r.id))}
                      className="btn btn-sm btn-ghost btn-danger"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-[13px] text-fg-2">
                  {r.kind === 'earnings' ? r.symbol : `${r.symbol} ${r.tf}`} —{' '}
                  {r.kind === 'strategy'
                    ? strategyName(r.strategy)
                    : r.kind === 'level'
                      ? LEVEL_LABEL[r.levelCondition]
                      : r.kind === 'earnings'
                        ? `ก่อนประกาศงบ ${r.daysBefore} วัน`
                        : `${CONDITION_LABEL[r.condition]} ${r.price}${r.once ? ' (ครั้งเดียว)' : ''}`}
                </div>
                <div className="mt-0.5 text-[11px] text-faint">
                  {r.kind === 'earnings'
                    ? r.lastCheckedBar
                      ? `เตือนรอบงบ ${formatThaiTime(r.lastCheckedBar, false)} แล้ว`
                      : 'รอใกล้วันประกาศงบ'
                    : `ตรวจถึงแท่ง ${r.lastCheckedBar ? formatThaiTime(r.lastCheckedBar, false) : '— (รอแท่งปิด)'}`}
                  {r.lastFiredAt ? ` · เตือนล่าสุด ${formatThaiTime(r.lastFiredAt, false)}` : ''}
                </div>
                {r.lastError && <div className="mt-1 text-[11px] text-warn">{r.lastError}</div>}
              </li>
            ))}
          </ul>

          {status && !status.line.configured && (
            <div className="card bg-field p-5 text-[13px] leading-relaxed text-muted">
              <div className="mb-1 font-medium text-fg">ตั้งค่าให้ส่งเข้า LINE (ทำครั้งเดียว)</div>
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
        <section className="min-w-0 flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-center">
            <h2 className="text-[13px] font-semibold text-fg">การแจ้งเตือนล่าสุด</h2>
            {events.length > 0 && (
              <button onClick={() => window.confirm('ล้างประวัติทั้งหมด?') && void run(clearAlertEvents)} className="btn btn-sm btn-ghost ml-auto">
                ล้างประวัติ
              </button>
            )}
          </div>
          {events.length === 0 && (
            <Empty icon="bell" title="ยังไม่มีการแจ้งเตือน">
              เมื่อเงื่อนไขเกิด จะขึ้นที่นี่ — และเด้งบนเครื่องถ้าอนุญาตไว้
            </Empty>
          )}
          <ul className="mx-auto max-w-3xl space-y-3">
            {events.map((e) => (
              <li key={e.id} className="card p-4">
                <div className="flex items-center gap-2">
                  {e.signal && (
                    <span className={`badge ${e.signal.direction === 'long' ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear'}`}>
                      {e.signal.direction === 'long' ? 'BUY' : 'SELL'}
                    </span>
                  )}
                  <span className="font-semibold text-fg">{e.ruleName}</span>
                  <span className={`badge ${LINE_BADGE[e.line].cls}`} title={e.lineError ?? undefined}>
                    {LINE_BADGE[e.line].text}
                  </span>
                  <span className="ml-auto text-[11px] text-faint">{formatThaiTime(e.firedAt)}</span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-fg-2">{e.message}</pre>
                {e.lineError && <div className="mt-1 text-[11px] text-bad">{e.lineError}</div>}
                {e.signal && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setPreview(e)} className="btn btn-sm">
                      <Icon name="chart" size={14} />
                      ดูบนกราฟ
                    </button>
                    <button onClick={() => void toJournal(e)} className="btn btn-sm">
                      <Icon name="journal" size={14} />
                      บันทึกลง Journal
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
