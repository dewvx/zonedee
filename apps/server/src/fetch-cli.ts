/**
 * ดึงราคาลง SQLite
 *
 *   npm run fetch                          ทุก symbol (ต่อจากของเดิม / ครั้งแรกย้อนหลังตามค่า default)
 *   npm run fetch -- --symbol XAUUSD       เฉพาะตัวที่เลือก (คั่นด้วย , ได้)
 *   npm run fetch -- --market forex        เฉพาะ forex (หรือ us-stock)
 *   npm run fetch -- --days 30             ครั้งแรกเอาย้อนหลังแค่ 30 วัน
 *   npm run fetch -- --from 2025-01-01     บังคับดึงตั้งแต่วันที่นี้
 *   npm run fetch -- --reset               ลบข้อมูลเดิมของ symbol ที่เลือกก่อน (ตอนเปลี่ยนแหล่งข้อมูล)
 */
import { parseArgs } from 'node:util';
import { FETCHERS } from './fetchers';
import { fetchSymbol } from './fetch-job';
import { CandleStore, DEFAULT_DB_PATH } from './store';
import { UserSymbolStore, createSymbolRegistry } from './user-symbols';

const { values } = parseArgs({
  options: {
    symbol: { type: 'string', short: 's' },
    days: { type: 'string', short: 'd' },
    from: { type: 'string', short: 'f' },
    market: { type: 'string', short: 'm' },
    reset: { type: 'boolean', default: false },
  },
});

const wanted = values.symbol?.split(',').map((s) => s.trim().toUpperCase());
// รวมหุ้นที่เพิ่มเองจากในแอป (หน้าสแกน / watchlist)
const userSymbols = new UserSymbolStore(DEFAULT_DB_PATH);
const SYMBOLS = createSymbolRegistry(userSymbols).list();
userSymbols.close();
const targets = SYMBOLS.filter(
  (s) => (!wanted || wanted.includes(s.symbol)) && (!values.market || s.market === values.market),
);

if (targets.length === 0) {
  console.error(`ไม่เจอ symbol ที่เลือก — มีให้เลือก: ${SYMBOLS.map((s) => s.symbol).join(', ')}`);
  process.exit(1);
}

const from = values.from ? Date.parse(`${values.from}T00:00:00Z`) : undefined;
if (values.from && Number.isNaN(from)) {
  console.error(`--from ต้องเป็นรูปแบบ YYYY-MM-DD (ได้ ${values.from})`);
  process.exit(1);
}
const days = values.days ? Number(values.days) : undefined;

const store = new CandleStore();
console.log(`[zonedee] ฐานข้อมูล: ${DEFAULT_DB_PATH}`);
console.log(`[zonedee] จะดึง: ${targets.map((t) => `${t.symbol}(${t.source})`).join(', ')}\n`);

let failed = 0;
for (const cfg of targets) {
  const started = Date.now();
  console.log(`▶ ${cfg.symbol} จาก ${cfg.source} (${cfg.sourceSymbol})`);
  if (values.reset) {
    console.log(`  ลบข้อมูลเดิม ${store.deleteSymbol(cfg.symbol).toLocaleString()} แถว`);
  }
  try {
    const res = await fetchSymbol(store, cfg, FETCHERS, { from, days, log: console.log });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (res.errors.length > 0 && res.total === 0) {
      failed++;
      console.error(`✖ ${cfg.symbol} ดึงไม่สำเร็จ (${secs} วิ)`);
      console.error('  ลองเช็กอินเทอร์เน็ต แล้วรันใหม่ — ส่วนที่ดึงสำเร็จแล้วถูกบันทึกไว้ รอบหน้าจะดึงต่อจากเดิม\n');
    } else if (res.errors.length > 0) {
      console.log(`◐ ${cfg.symbol} ได้ ${res.total.toLocaleString()} แท่ง แต่บาง TF ไม่สำเร็จ (${secs} วิ)\n`);
    } else {
      console.log(`✔ ${cfg.symbol} เสร็จ ${res.total.toLocaleString()} แท่ง (${secs} วิ)\n`);
    }
  } catch (err) {
    failed++;
    console.error(`✖ ${cfg.symbol} ดึงไม่สำเร็จ: ${(err as Error).message}\n`);
  }
}

store.close();
if (failed > 0) console.log(`สรุป: ไม่สำเร็จ ${failed} จาก ${targets.length} symbol`);
process.exitCode = failed > 0 ? 1 : 0;
