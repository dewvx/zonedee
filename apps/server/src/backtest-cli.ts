/**
 * backtest จากข้อมูลใน SQLite (ดึงข้อมูลก่อนด้วย npm run fetch)
 *
 *   npm run backtest -- --symbol XAUUSD --tf M5 --strategy sk-fibo
 *   npm run backtest -- --symbol XAUUSD --tf M15 --all              เทียบทุกท่า
 *   npm run backtest -- --list                                      ดูรายชื่อท่า + ค่าที่ปรับได้
 *   ตัวเลือกเพิ่ม: --param entryLevel=0.786 (ซ้ำได้) · --spread 35 (points) · --from 2026-09-01 · --to 2026-10-01
 *                --risk 1 · --balance 1000 · --swing 3 · --trades (พิมพ์ทุกเทรด)
 */
import { parseArgs } from 'node:util';
import type { ParamValue, Stats } from '@zonedee/core';
import { BacktestError, backtestCompare, backtestOne, strategyList } from './backtest';
import { CandleStore, DEFAULT_DB_PATH } from './store';
import { UserSymbolStore, createSymbolRegistry } from './user-symbols';

const { values } = parseArgs({
  options: {
    symbol: { type: 'string', short: 's', default: 'XAUUSD' },
    tf: { type: 'string', short: 't', default: 'M15' },
    strategy: { type: 'string', default: 'ema-cross' },
    all: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    param: { type: 'string', multiple: true, short: 'p' },
    spread: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    risk: { type: 'string' },
    balance: { type: 'string' },
    swing: { type: 'string' },
    trades: { type: 'boolean', default: false },
  },
});

if (values.list) {
  for (const s of strategyList()) {
    console.log(`\n${s.id.padEnd(10)} ${s.name}  [${s.source}]\n  ${s.description}`);
    for (const p of s.params) console.log(`    --param ${p.key}=${String(p.default).padEnd(8)} ${p.label}`);
  }
  process.exit(0);
}

const userSymbols = new UserSymbolStore(DEFAULT_DB_PATH);
const cfg = createSymbolRegistry(userSymbols).find(values.symbol!);
userSymbols.close();
if (!cfg) {
  console.error(`ไม่รู้จัก symbol: ${values.symbol}`);
  process.exit(1);
}
const date = (s?: string) => (s ? Date.parse(`${s}T00:00:00Z`) : undefined);
// ค่าที่ส่งด้วย --param แปลงชนิดตามที่ท่ากำหนด (number / boolean / select = ข้อความ)
const specs = strategyList().find((s) => s.id === values.strategy)?.params ?? [];
const params: Record<string, ParamValue> = {};
for (const kv of values.param ?? []) {
  const [k = '', v = ''] = kv.split('=');
  const type = specs.find((p) => p.key === k)?.type;
  params[k] = type === 'number' ? Number(v) : type === 'boolean' ? v === 'true' : v;
}

const req = {
  symbol: cfg.symbol,
  tf: values.tf!,
  strategy: values.all ? 'all' : values.strategy!,
  params,
  cfg: values.swing ? { swingLength: Number(values.swing) } : undefined,
  from: date(values.from),
  to: date(values.to),
  spreadPoints: values.spread !== undefined ? Number(values.spread) : undefined,
  riskPct: values.risk ? Number(values.risk) : undefined,
  initialBalance: values.balance ? Number(values.balance) : undefined,
};

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const line = (s: Stats) =>
  `${String(s.trades).padStart(5)} เทรด · ชนะ ${f(s.winRate * 100, 0)}% · เฉลี่ย ${f(s.expectancyR)}R · รวม ${f(s.totalR, 1)}R · PF ${s.profitFactor === null ? '∞' : f(s.profitFactor)} · DD ${f(s.maxDrawdownR, 1)}R · แพ้ติด ${s.maxConsecLosses}`;
const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '-');

const store = new CandleStore();
try {
  if (req.strategy === 'all') {
    const r = backtestCompare(store, cfg, req);
    console.log(`\n${r.meta.symbol} ${r.meta.tf} · ${r.meta.bars.toLocaleString()} แท่ง (${day(r.meta.from)} → ${day(r.meta.to)} UTC) · spread ${r.meta.spreadPoints} pt · ${r.meta.durationMs} ms\n`);
    for (const row of r.rows) {
      const pct = row.percentile === null ? '' : ` · ชนะสุ่ม ${f(row.percentile, 0)}%`;
      console.log(`${row.strategyName.padEnd(26)} ${line(row.stats)}${pct}`);
      console.log(`${''.padEnd(26)}   out-of-sample: ${row.outOfSample.trades} เทรด เฉลี่ย ${f(row.outOfSample.expectancyR)}R`);
    }
  } else {
    const { meta, result } = backtestOne(store, cfg, req);
    console.log(`\n${meta.strategyName} · ${meta.symbol} ${meta.tf} · ${meta.bars.toLocaleString()} แท่ง (${day(meta.from)} → ${day(meta.to)} UTC)`);
    console.log(`spread ${meta.spreadPoints} pt · M1 แยก SL/TP: ${meta.fineData ? 'มี' : 'ไม่มี (นับเป็น SL)'} · สัญญาณ ${meta.signals} (ข้าม ${result.skipped}) · ${meta.durationMs} ms\n`);
    console.log(`ทั้งหมด      ${line(result.stats)}`);
    console.log(`in-sample    ${line(result.inSample)}`);
    console.log(`out-sample   ${line(result.outOfSample)}  (ตั้งแต่ ${day(result.splitTime)})`);
    if (result.baseline) {
      const b = result.baseline;
      console.log(`\nเทียบเข้าสุ่ม ${b.runs} รอบ: สุ่มได้เฉลี่ย ${f(b.mean)}R (5%–95%: ${f(b.p5)} ถึง ${f(b.p95)}) → ท่านี้ดีกว่าสุ่ม ${f(b.percentile, 0)}% ของรอบ`);
    }
    console.log(`เงิน: ${f(result.equity[0]?.balance ?? req.initialBalance ?? 1000)} → ${f(result.stats.finalBalance)} (DD สูงสุด ${f(result.stats.maxDrawdownPct, 1)}%)`);
    if (result.stats.trades < 100) console.log('\n⚠ น้อยกว่า 100 เทรด — ยังสรุปอะไรไม่ได้ (ดู docs/rules.md)');
    if (values.trades) {
      console.log('');
      for (const t of result.trades)
        console.log(`${day(t.entryTime)} ${t.direction.padEnd(5)} ${f(t.entry, cfg.digits)} → ${f(t.exit, cfg.digits)} ${t.exitReason.padEnd(4)} ${f(t.r).padStart(6)}R  ${t.reason}`);
    }
  }
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exitCode = err instanceof BacktestError ? 2 : 1;
} finally {
  store.close();
}
