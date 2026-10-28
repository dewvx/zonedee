import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { PositionResult } from '@zonedee/core';
import type { ContractInfo } from '../api';
import type { RiskSettings } from '../settings';

export interface TradePlan {
  entry: number | null;
  sl: number | null;
  tp: number | null;
  /** เวลาแท่งที่คลิกวาง (ขอบซ้ายของกล่อง) */
  startTime: number | null;
}

export const EMPTY_PLAN: TradePlan = { entry: null, sl: null, tp: null, startTime: null };

interface Props {
  symbol: string;
  digits: number;
  plan: TradePlan;
  onPlanChange: (patch: Partial<TradePlan>) => void;
  risk: RiskSettings;
  onRiskChange: (patch: Partial<RiskSettings>) => void;
  contract: ContractInfo | null;
  contractError: string | null;
  result: PositionResult | null;
  /** balance / leverage / spread ที่ใช้คำนวณจริง */
  effective: { balance: number; leverage: number | null; spreadPoints: number };
  onReset: () => void;
  onClose: () => void;
  /** บันทึกแผนนี้ลง journal พร้อมรูปกราฟ */
  onSaveJournal?: () => void;
  savingJournal?: boolean;
}

const fmtMoney = (v: number, cur: string) =>
  `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

function PriceInput(props: { label: string; color: string; value: number | null; digits: number; hint: string; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="flex w-14 items-center gap-1.5 text-xs font-semibold text-fg-2">
        <span className="h-2 w-2 rounded-full" style={{ background: props.color }} />
        {props.label}
      </span>
      <input
        type="number"
        step={10 ** -props.digits}
        value={props.value ?? ''}
        placeholder={props.hint}
        onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="field tabular-nums"
      />
    </label>
  );
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'good' ? 'text-bull' : tone === 'bad' ? 'text-bear' : tone === 'muted' ? 'text-faint' : 'text-fg';
  return (
    <div className="flex items-baseline justify-between gap-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={`text-right tabular-nums ${color}`}>{children}</span>
    </div>
  );
}

/** แผงเครื่องคิด lot / SL / R:R (กฎ Money Management ของ Braron: เสี่ยง 1–2%, R:R ≥ 1:2) */
export function RiskPanel(p: Props) {
  const { plan, result: r, contract, digits } = p;
  const cur = contract?.accountCurrency ?? 'USD';
  const unit = contract?.spec.unit === 'share' ? 'หุ้น' : 'lot';
  const nextStep = plan.entry === null ? 'Entry' : plan.sl === null ? 'SL' : plan.tp === null ? 'TP' : null;
  const round = (v: number) => Number(v.toFixed(digits));

  const setTpByRR = () => {
    if (plan.entry === null || plan.sl === null) return;
    p.onPlanChange({ tp: round(plan.entry + (plan.entry - plan.sl) * p.risk.minRR) });
  };
  const flip = () => {
    if (plan.entry === null || plan.sl === null) return;
    p.onPlanChange({
      sl: round(2 * plan.entry - plan.sl),
      tp: plan.tp === null ? null : round(2 * plan.entry - plan.tp),
    });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel px-5 py-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold leading-tight text-fg">คำนวณ lot</h2>
          <p className="text-xs text-muted">{p.symbol} — เสี่ยงตาม % ของเงิน</p>
        </div>
        <button onClick={p.onClose} className="btn btn-sm btn-ghost btn-icon" aria-label="ปิด">
          <Icon name="close" size={15} />
        </button>
      </div>

      {nextStep && (
        <div className="rounded-lg border border-accent/30 bg-accent/8 px-3 py-2 text-xs leading-relaxed text-accent">
          คลิกบนกราฟเพื่อวาง <b>{nextStep}</b>
          {nextStep !== 'Entry' && ' หรือพิมพ์ราคาด้านล่าง'} — ลากเส้นบนกราฟเพื่อปรับ
        </div>
      )}

      <div className="space-y-1.5">
        <PriceInput label="Entry" color="var(--c-muted)" value={plan.entry} digits={digits} hint="คลิกบนกราฟ" onChange={(v) => p.onPlanChange({ entry: v })} />
        <PriceInput label="SL" color="var(--c-bear)" value={plan.sl} digits={digits} hint="จุดตัดขาดทุน" onChange={(v) => p.onPlanChange({ sl: v })} />
        <PriceInput label="TP" color="var(--c-bull)" value={plan.tp} digits={digits} hint="จุดทำกำไร (ไม่ใส่ก็ได้)" onChange={(v) => p.onPlanChange({ tp: v })} />
        <div className="flex gap-1.5 pt-1">
          <button onClick={setTpByRR} disabled={plan.sl === null} className="btn btn-sm flex-1">
            TP = 1:{p.risk.minRR}
          </button>
          <button onClick={flip} disabled={plan.sl === null} className="btn btn-sm flex-1">
            สลับ Buy/Sell
          </button>
          <button onClick={p.onReset} className="btn btn-sm flex-1">
            วางใหม่
          </button>
        </div>
        {p.onSaveJournal && (
          <button
            onClick={p.onSaveJournal}
            disabled={plan.entry === null || plan.sl === null || p.savingJournal}
            title="บันทึก Entry/SL/TP/lot + รูปกราฟตอนนี้ ลงหน้า Journal"
            className="btn btn-sm w-full"
          >
            <Icon name="journal" size={14} />
            {p.savingJournal ? 'กำลังบันทึก…' : 'บันทึกลง Journal'}
          </button>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <label className="block text-xs">
          <span className="text-muted">ยอดเงินในบัญชี ({cur})</span>
          {contract?.balance != null && (
            <span className="float-right flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={p.risk.useMt5Balance}
                onChange={(e) => p.onRiskChange({ useMt5Balance: e.target.checked })}
                className="accent-accent"
              />
              ใช้ยอดจาก MT5
            </span>
          )}
          <input
            type="number"
            min={0}
            value={p.risk.useMt5Balance && contract?.balance != null ? contract.balance : p.risk.balance}
            disabled={p.risk.useMt5Balance && contract?.balance != null}
            onChange={(e) => p.onRiskChange({ balance: Number(e.target.value) })}
            className="field mt-1 tabular-nums disabled:opacity-60"
          />
        </label>
        <label className="block text-xs">
          <div className="flex justify-between">
            <span className="text-muted">เสี่ยงต่อไม้</span>
            <span className={`tabular-nums ${p.risk.riskPct > 2 ? 'text-warn' : 'text-fg'}`}>{p.risk.riskPct}%</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.25}
            value={p.risk.riskPct}
            onChange={(e) => p.onRiskChange({ riskPct: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            <span className="text-muted">Leverage</span>
            <input
              type="number"
              min={0}
              value={p.risk.leverage || ''}
              placeholder={p.effective.leverage ? `${p.effective.leverage}` : 'ไม่ทราบ'}
              onChange={(e) => p.onRiskChange({ leverage: Number(e.target.value) || 0 })}
              className="field mt-1 tabular-nums"
            />
          </label>
          <label>
            <span className="text-muted">Spread (points)</span>
            <input
              type="number"
              min={0}
              value={p.risk.spreadPoints >= 0 ? p.risk.spreadPoints : ''}
              placeholder={contract?.spreadPoints != null ? `${contract.spreadPoints} (MT5)` : '0'}
              onChange={(e) => p.onRiskChange({ spreadPoints: e.target.value === '' ? -1 : Number(e.target.value) })}
              className="field mt-1 tabular-nums"
            />
          </label>
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        {p.contractError && <div className="text-xs text-bad">โหลดสเปกสัญญาไม่ได้: {p.contractError}</div>}
        {!r && !p.contractError && <div className="text-xs text-faint">วาง Entry และ SL เพื่อดูผลคำนวณ</div>}
        {r && (
          <>
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className={`badge ${r.direction === 'long' ? 'bg-bull/12 text-bull' : 'bg-bear/12 text-bear'}`}
              >
                {r.direction === 'long' ? 'BUY' : 'SELL'}
              </span>
              <span className="text-[26px] font-semibold leading-none tracking-tight tabular-nums text-fg">
                {r.valid ? r.lots.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}{' '}
                <span className="text-sm font-normal text-muted">{unit}</span>
              </span>
            </div>
            {r.errors.map((e) => (
              <div key={e} className="text-xs text-bad">
                ✕ {e}
              </div>
            ))}
            {r.valid && (
              <>
                <Row label="เงินที่ยอมเสีย">{fmtMoney(r.riskAmount, cur)}</Row>
                <Row label="เสียจริงถ้าโดน SL" tone="bad">
                  {fmtMoney(-r.actualRisk, cur)} ({r.actualRiskPct.toFixed(2)}%)
                </Row>
                <Row label="ระยะ SL">
                  {r.slDistance.toFixed(digits)} · {r.slPoints.toLocaleString()} points
                  {r.slPips !== null ? ` · ${r.slPips.toFixed(1)} pips` : ''}
                </Row>
                {r.rr !== null && (
                  <>
                    <Row label="กำไรถ้าถึง TP" tone="good">
                      {fmtMoney(r.profit ?? 0, cur)}
                    </Row>
                    <Row label="R:R" tone={r.rr >= p.risk.minRR ? 'good' : 'bad'}>
                      1 : {r.rr.toFixed(2)}
                    </Row>
                  </>
                )}
                {r.margin !== null && <Row label={unit === 'หุ้น' ? 'เงินที่ใช้ซื้อ' : 'Margin ที่ใช้'}>{fmtMoney(r.margin, cur)}</Row>}
                {r.swapPerNight !== null && (
                  <Row
                    label="Swap ข้ามคืน"
                    tone={r.swapPerNight > 0 ? 'good' : r.swapPerNight < 0 ? 'bad' : 'muted'}
                  >
                    <span>
                      {r.swapPerNight > 0 ? '+' : ''}{fmtMoney(r.swapPerNight, cur)} / คืน
                      {r.swap3Day !== null && (
                        <span className="ml-1 text-[11px] text-muted">
                          (พุธ {r.swap3Day > 0 ? '+' : ''}{fmtMoney(r.swap3Day, cur)})
                        </span>
                      )}
                    </span>
                  </Row>
                )}
                {p.effective.spreadPoints > 0 && (
                  <Row label="นับ spread รวมแล้ว" tone="muted">
                    {p.effective.spreadPoints} points
                  </Row>
                )}
              </>
            )}
            {r.warnings.map((w) => (
              <div key={w} className="rounded-lg bg-warn/10 px-3 py-1.5 text-xs text-warn">
                ⚠ {w}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-auto border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
        {contract && (
          <>
            สเปกสัญญา: {contract.source === 'mt5' ? 'จาก MT5 (บัญชีของคุณ)' : 'ค่ามาตรฐาน'} · 1 {unit} ={' '}
            {contract.spec.contractSize.toLocaleString()} หน่วย · ขั้นต่ำ {contract.spec.volumeMin}
            {contract.spec.swapLong !== undefined && contract.spec.swapShort !== undefined && (
              <div className="mt-0.5 text-muted">
                Swap: Buy {contract.spec.swapLong > 0 ? `+${contract.spec.swapLong}` : contract.spec.swapLong} · Sell{' '}
                {contract.spec.swapShort > 0 ? `+${contract.spec.swapShort}` : contract.spec.swapShort} pt
              </div>
            )}
            {contract.note && <div className="mt-1 text-warn">{contract.note}</div>}
          </>
        )}
        <div className="mt-1">เครื่องมือช่วยคำนวณเท่านั้น ไม่ได้ส่งคำสั่งซื้อขาย</div>
      </div>
    </aside>
  );
}
