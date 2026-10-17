import type { ReactNode } from 'react';
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
}

const fmtMoney = (v: number, cur: string) =>
  `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

function PriceInput(props: { label: string; color: string; value: number | null; digits: number; hint: string; onChange: (v: number | null) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 text-xs font-semibold" style={{ color: props.color }}>
        {props.label}
      </span>
      <input
        type="number"
        step={10 ** -props.digits}
        value={props.value ?? ''}
        placeholder={props.hint}
        onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500"
      />
    </label>
  );
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'good' ? 'text-bull' : tone === 'bad' ? 'text-bear' : tone === 'muted' ? 'text-slate-500' : 'text-white';
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className={`text-right font-mono ${color}`}>{children}</span>
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
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-line bg-panel p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">เครื่องคิด lot · {p.symbol}</h2>
        <button onClick={p.onClose} className="text-slate-500 hover:text-white" aria-label="ปิด">
          ✕
        </button>
      </div>

      {nextStep && (
        <div className="rounded border border-blue-900/60 bg-blue-950/40 px-2 py-1.5 text-xs text-blue-200">
          คลิกบนกราฟเพื่อวาง <b>{nextStep}</b>
          {nextStep !== 'Entry' && ' (หรือพิมพ์ราคาด้านล่าง)'} · ลากเส้นบนกราฟเพื่อปรับ
        </div>
      )}

      <div className="space-y-1.5">
        <PriceInput label="Entry" color="#cbd5e1" value={plan.entry} digits={digits} hint="คลิกบนกราฟ" onChange={(v) => p.onPlanChange({ entry: v })} />
        <PriceInput label="SL" color="#f87171" value={plan.sl} digits={digits} hint="จุดตัดขาดทุน" onChange={(v) => p.onPlanChange({ sl: v })} />
        <PriceInput label="TP" color="#4ade80" value={plan.tp} digits={digits} hint="จุดทำกำไร (ไม่ใส่ก็ได้)" onChange={(v) => p.onPlanChange({ tp: v })} />
        <div className="flex gap-1.5 pt-1">
          <button onClick={setTpByRR} disabled={plan.sl === null} className="flex-1 rounded border border-line px-2 py-1 text-[11px] text-slate-300 hover:bg-line disabled:opacity-40">
            TP = 1:{p.risk.minRR}
          </button>
          <button onClick={flip} disabled={plan.sl === null} className="flex-1 rounded border border-line px-2 py-1 text-[11px] text-slate-300 hover:bg-line disabled:opacity-40">
            สลับ Buy/Sell
          </button>
          <button onClick={p.onReset} className="flex-1 rounded border border-line px-2 py-1 text-[11px] text-slate-300 hover:bg-line">
            วางใหม่
          </button>
        </div>
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <label className="block text-xs">
          <span className="text-slate-400">ยอดเงินในบัญชี ({cur})</span>
          {contract?.balance != null && (
            <span className="float-right flex items-center gap-1 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={p.risk.useMt5Balance}
                onChange={(e) => p.onRiskChange({ useMt5Balance: e.target.checked })}
                className="accent-blue-500"
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
            className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono text-sm text-white outline-none focus:border-blue-500 disabled:opacity-60"
          />
        </label>
        <label className="block text-xs">
          <div className="flex justify-between">
            <span className="text-slate-400">เสี่ยงต่อไม้</span>
            <span className={`font-mono ${p.risk.riskPct > 2 ? 'text-amber-300' : 'text-white'}`}>{p.risk.riskPct}%</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.25}
            value={p.risk.riskPct}
            onChange={(e) => p.onRiskChange({ riskPct: Number(e.target.value) })}
            className="w-full accent-blue-500"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>
            <span className="text-slate-400">Leverage</span>
            <input
              type="number"
              min={0}
              value={p.risk.leverage || ''}
              placeholder={p.effective.leverage ? `${p.effective.leverage}` : 'ไม่ทราบ'}
              onChange={(e) => p.onRiskChange({ leverage: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
            />
          </label>
          <label>
            <span className="text-slate-400">Spread (points)</span>
            <input
              type="number"
              min={0}
              value={p.risk.spreadPoints >= 0 ? p.risk.spreadPoints : ''}
              placeholder={contract?.spreadPoints != null ? `${contract.spreadPoints} (MT5)` : '0'}
              onChange={(e) => p.onRiskChange({ spreadPoints: e.target.value === '' ? -1 : Number(e.target.value) })}
              className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono text-white outline-none placeholder:text-slate-500 focus:border-blue-500"
            />
          </label>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        {p.contractError && <div className="text-xs text-red-300">โหลดสเปกสัญญาไม่ได้: {p.contractError}</div>}
        {!r && !p.contractError && <div className="text-xs text-slate-500">วาง Entry และ SL เพื่อดูผลคำนวณ</div>}
        {r && (
          <>
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-bold ${r.direction === 'long' ? 'bg-emerald-900/60 text-emerald-300' : 'bg-red-900/60 text-red-300'}`}
              >
                {r.direction === 'long' ? 'BUY' : 'SELL'}
              </span>
              <span className="font-mono text-2xl font-bold text-white">
                {r.valid ? r.lots.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '—'}{' '}
                <span className="text-sm font-normal text-slate-400">{unit}</span>
              </span>
            </div>
            {r.errors.map((e) => (
              <div key={e} className="text-xs text-red-300">
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
                {p.effective.spreadPoints > 0 && (
                  <Row label="นับ spread รวมแล้ว" tone="muted">
                    {p.effective.spreadPoints} points
                  </Row>
                )}
              </>
            )}
            {r.warnings.map((w) => (
              <div key={w} className="rounded bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
                ⚠ {w}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="mt-auto border-t border-line pt-2 text-[10px] leading-relaxed text-slate-500">
        {contract && (
          <>
            สเปกสัญญา: {contract.source === 'mt5' ? 'จาก MT5 (บัญชีของคุณ)' : 'ค่ามาตรฐาน'} · 1 {unit} ={' '}
            {contract.spec.contractSize.toLocaleString()} หน่วย · ขั้นต่ำ {contract.spec.volumeMin}
            {contract.note && <div className="mt-1 text-amber-400/80">{contract.note}</div>}
          </>
        )}
        <div className="mt-1">เครื่องมือช่วยคำนวณเท่านั้น ไม่ได้ส่งคำสั่งซื้อขาย</div>
      </div>
    </aside>
  );
}
