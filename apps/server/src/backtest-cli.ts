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
import { BacktestError, backtestCompare, backtestOne, backtestTune, backtestWalkForward, backtestMultiPair, strategyList } from './backtest';
import { CandleStore, DEFAULT_DB_PATH } from './store';
import { UserSymbolStore, createSymbolRegistry } from './user-symbols';

const { values } = parseArgs({
  options: {
    symbol: { type: 'string', short: 's', default: 'XAUUSD' },
    tf: { type: 'string', short: 't', default: 'M15' },
    strategy: { type: 'string', default: 'ema-cross' },
    all: { type: 'boolean', default: false },
    tune: { type: 'boolean', default: false },
    grid: { type: 'string', multiple: true },
    list: { type: 'boolean', default: false },
    param: { type: 'string', multiple: true, short: 'p' },
    spread: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    risk: { type: 'string' },
    balance: { type: 'string' },
    swing: { type: 'string' },
    'no-swap': { type: 'boolean', default: false },
    wf: { type: 'boolean', default: false },
    train: { type: 'string' },
    test: { type: 'string' },
    windows: { type: 'string' },
    multipair: { type: 'boolean', default: false },
    symbols: { type: 'string' },
    trades: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`
การใช้งาน backtest CLI:
  npm run backtest -- [options]

ตัวเลือก:
  -s, --symbol <symbol>    คู่เงิน/หุ้น (ค่าเริ่มต้น: XAUUSD)
  -t, --tf <timeframe>     Timeframe เช่น M5, M15, H1, D1 (ค่าเริ่มต้น: M15)
  --strategy <strategy>    ชื่อท่า เช่น ema-cross, sk-fibo, smc-breaker
  --all                    รันเปรียบเทียบทุกท่าพร้อมกัน
  --tune                   ค้นหาชุดพารามิเตอร์ที่ดีที่สุด (Grid Search)
  --grid <param=v1,v2>     ระบุช่วงค่าของ Grid Search
  --wf                     วิเคราะห์ความทนทานแบบ Walk-Forward
  --windows <n>            จำนวนรอบของ Walk-Forward (เช่น 3, 4, 5)
  --train <days>           จำนวนวันของ In-Sample Train (เช่น 180)
  --test <days>            จำนวนวันของ Out-of-Sample Test (เช่น 60)
  --multipair              จำลองพอร์ตโฟลิโอหลายคู่เงินพร้อมกัน
  --symbols <s1,s2,...>    คู่เงินสำหรับ Multi-Pair (เช่น XAUUSD,EURUSD,GBPUSD)
  --spread <points>        สเปรด (points)
  --risk <pct>             ความเสี่ยงต่อไม้ (% ของพอร์ต เช่น 1)
  --balance <amount>       เงินทุนเริ่มต้น (เช่น 1000)
  --no-swap                ปิดการคิดค่า Swap ข้ามคืน
  --trades                 พิมพ์รายการเทรดทั้งหมด
  --list                   ดูรายชื่อท่าและพารามิเตอร์ทั้งหมด
  -h, --help               แสดงคู่มือการใช้งานนี้
  `);
  process.exit(0);
}

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

const customGrid: Record<string, ParamValue[]> = {};
for (const kv of values.grid ?? []) {
  const [k = '', vals = ''] = kv.split('=');
  const type = specs.find((p) => p.key === k)?.type;
  customGrid[k] = vals.split(',').map((v) => {
    const trimmed = v.trim();
    if (type === 'number' || (!isNaN(Number(trimmed)) && trimmed !== '')) return Number(trimmed);
    if (type === 'boolean' || trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
    return trimmed;
  });
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
  enableSwap: !values['no-swap'],
};

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const line = (s: Stats) =>
  `${String(s.trades).padStart(5)} เทรด · ชนะ ${f(s.winRate * 100, 0)}% · เฉลี่ย ${f(s.expectancyR)}R · รวม ${f(s.totalR, 1)}R · PF ${s.profitFactor === null ? '∞' : f(s.profitFactor)} · DD ${f(s.maxDrawdownR, 1)}R · แพ้ติด ${s.maxConsecLosses}`;
const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '-');

const store = new CandleStore();
try {
  if (values.wf) {
    const r = backtestWalkForward(store, cfg, {
      ...req,
      trainDays: values.train ? Number(values.train) : undefined,
      testDays: values.test ? Number(values.test) : undefined,
      windowsCount: values.windows ? Number(values.windows) : undefined,
    });
    console.log(`\n🔄 Walk-Forward Analysis: ${r.strategyName} · ${r.meta.symbol} ${r.meta.tf} (${r.result.totalWindows} windows)`);
    console.log(`Walk-Forward Efficiency (WFE): ${r.result.walkForwardEfficiencyPct}% [${r.result.isRobust ? 'ROBUST ✓' : 'OVERFITTING ⚠'}]`);
    console.log(`Combined Out-of-Sample: ${line(r.result.combinedOutOfSampleStats)}\n`);
    console.log('รายละเอียดแต่ละรอบหน้าต่าง:');
    for (const step of r.result.steps) {
      const w = step.window;
      console.log(`รอบ #${w.index + 1} [${day(w.testStartTime)} → ${day(w.testEndTime)}]: Train ${step.inSampleTradesCount} ไม้ (${f(step.inSample.expectancyR)}R) → Test ${step.outOfSampleTradesCount} ไม้ (${f(step.outOfSample.expectancyR)}R) | WFE ${step.efficiencyPct}%`);
    }
  } else if (values.multipair) {
    const symList = (values as any).symbols ? ((values as any).symbols as string).split(',').map((x: string) => x.trim().toUpperCase()) : ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY'];
    const r = backtestMultiPair(store, createSymbolRegistry(userSymbols).list(), {
      symbols: symList,
      tf: values.tf!,
      strategy: values.strategy!,
      params,
      cfg: req.cfg,
      from: req.from,
      to: req.to,
      riskPct: req.riskPct,
      initialBalance: req.initialBalance,
      enableSwap: req.enableSwap,
    });
    console.log(`\n🌐 Multi-Pair Portfolio: ${r.meta.strategyName} · ${r.meta.symbols.join(', ')} (${r.meta.tf}) · Diversification Ratio: ${r.result.diversificationRatio}x`);
    console.log(`ผลรวมพอร์ตโฟลิโอ: ${line(r.result.portfolioStats)}\n`);
    console.log('ผลตอบแทนแยกตามคู่เงิน:');
    for (const sym of r.result.symbolSummaries) {
      console.log(`  ${sym.symbol.padEnd(8)} ${line(sym.stats)}`);
    }
  } else if (values.tune) {
    const r = backtestTune(store, cfg, {
      ...req,
      grid: Object.keys(customGrid).length > 0 ? customGrid : undefined,
    });
    console.log(
      `\n🎯 Grid Search Tuning: ${r.strategyName} · ${r.meta.symbol} ${r.meta.tf} · ${r.testedCombinations}/${r.totalCombinations} combinations (${r.meta.durationMs} ms)\n`,
    );
    if (r.best) {
      console.log(`🏆 ค่าที่ดีที่สุด: [${r.best.label}]`);
      console.log(`   ${line(r.best.stats)}${r.best.baseline ? ` · ชนะสุ่ม ${f(r.best.baseline.percentile, 0)}%` : ''}`);
      console.log(
        `   out-of-sample: ${r.best.outOfSample.trades} เทรด เฉลี่ย ${f(r.best.outOfSample.expectancyR)}R (DD ${f(r.best.stats.maxDrawdownR, 1)}R)\n`,
      );
    } else {
      console.log('⚠ ไม่พบ combination ที่ทำกำไรได้\n');
    }
    console.log('อันดับ 10 อันดับแรก:');
    for (let i = 0; i < Math.min(10, r.rows.length); i++) {
      const row = r.rows[i]!;
      const bestMark = row.isBest ? ' [BEST]' : row.isSignificant ? ' [PASS]' : '';
      const pct = row.baseline ? ` · ชนะสุ่ม ${f(row.baseline.percentile, 0)}%` : '';
      console.log(`#${String(i + 1).padEnd(2)}${bestMark.padEnd(8)} ${row.label}`);
      console.log(`    ${line(row.stats)}${pct} · OOS ${f(row.outOfSample.expectancyR)}R`);
    }
  } else if (req.strategy === 'all') {
    const r = backtestCompare(store, cfg, req);
    console.log(`\n${r.meta.symbol} ${r.meta.tf} · ${r.meta.bars.toLocaleString()} แท่ง (${day(r.meta.from)} → ${day(r.meta.to)} UTC) · spread ${r.meta.spreadPoints} pt · ${r.meta.durationMs} ms\n`);
    for (const row of r.rows) {
      const pct = row.percentile === null ? '' : ` · ชนะสุ่ม ${f(row.percentile, 0)}%`;
      console.log(`${row.strategyName.padEnd(26)} ${line(row.stats)}${pct}`);
      console.log(`${''.padEnd(26)}   out-of-sample: ${row.outOfSample.trades} เทรด เฉลี่ย ${f(row.outOfSample.expectancyR)}R`);
    }
  } else {
    const { meta, result } = backtestOne(store, cfg, req);
    const swapInfo = meta.swapLong !== undefined ? ` · swap long ${meta.swapLong}/short ${meta.swapShort} pt` : '';
    console.log(`\n${meta.strategyName} · ${meta.symbol} ${meta.tf} · ${meta.bars.toLocaleString()} แท่ง (${day(meta.from)} → ${day(meta.to)} UTC)`);
    console.log(`spread ${meta.spreadPoints} pt${swapInfo} · M1 แยก SL/TP: ${meta.fineData ? 'มี' : 'ไม่มี (นับเป็น SL)'} · สัญญาณ ${meta.signals} (ข้าม ${result.skipped}) · ${meta.durationMs} ms\n`);
    const swapStat = result.stats.totalSwapR ? ` (หัก swap ${f(result.stats.totalSwapR, 2)}R)` : '';
    console.log(`ทั้งหมด      ${line(result.stats)}${swapStat}`);
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
      for (const t of result.trades) {
        const nightStr = t.holdingNights ? ` [${t.holdingNights}n${t.swapR !== undefined ? ` ${f(t.swapR, 2)}R` : ''}]` : '';
        console.log(`${day(t.entryTime)} ${t.direction.padEnd(5)} ${f(t.entry, cfg.digits)} → ${f(t.exit, cfg.digits)} ${t.exitReason.padEnd(4)} ${f(t.r).padStart(6)}R${nightStr}  ${t.reason}`);
      }
    }
  }
} catch (err) {
  console.error(`✖ ${(err as Error).message}`);
  process.exitCode = err instanceof BacktestError ? 2 : 1;
} finally {
  store.close();
}
