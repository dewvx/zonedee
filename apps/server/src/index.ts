import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';
import { createAlertEngine } from './alerts/engine';
import { createLineNotifier, lineConfigFromEnv } from './alerts/line';
import { AlertStore } from './alerts/store';
import { createContractProvider } from './contract';
import { FETCHERS } from './fetchers';
import { fetchMt5Info } from './fetchers/mt5';
import { createFetchRunner } from './fetch-runner';
import { JournalStore } from './journal';
import { CandleStore, DEFAULT_DB_PATH } from './store';
import { fetchYahoo, yahooScreener } from './fetchers/yahoo';
import { createScanner } from './scanner';
import { UserSymbolStore, createSymbolRegistry } from './user-symbols';
import { WatchlistStore } from './watchlist';

// ค่าลับ (LINE token) อยู่ใน <root>/.env — ไม่ขึ้น git (ดู .env.example)
const ENV_FILE = resolve(import.meta.dirname, '../../../.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const PORT = Number(process.env.PORT ?? 3001);
const store = new CandleStore();
const runFetch = createFetchRunner(store, FETCHERS);
const userSymbols = new UserSymbolStore(DEFAULT_DB_PATH);
const registry = createSymbolRegistry(userSymbols);
const watchlist = new WatchlistStore(DEFAULT_DB_PATH);
const scan = createScanner({
  screener: yahooScreener,
  daily: (symbol, from, to) => fetchYahoo(symbol, 'D1', from, to),
  watchlistSymbols: () => watchlist.list().map((w) => w.symbol),
});
const line = createLineNotifier(lineConfigFromEnv());
const alertStore = new AlertStore(DEFAULT_DB_PATH);
const engine = createAlertEngine({ store, alerts: alertStore, line, runFetch, findSymbol: registry.find, log: console.log });
const app = createApp({
  store,
  runFetch,
  getContract: createContractProvider(store, fetchMt5Info),
  dbPath: DEFAULT_DB_PATH,
  journal: new JournalStore(DEFAULT_DB_PATH),
  alerts: { store: alertStore, engine, line },
  registry,
  userSymbols,
  watchlist,
  scan,
});
engine.start(30_000);

app.listen(PORT, () => {
  console.log(`[zonedee] server พร้อมที่ http://localhost:${PORT}`);
  console.log(`[zonedee] ฐานข้อมูล: ${DEFAULT_DB_PATH}`);
  const rules = alertStore.rules().filter((r) => r.enabled).length;
  console.log(`[zonedee] แจ้งเตือน: เปิดอยู่ ${rules} กฎ · LINE ${line.configured ? 'พร้อม' : 'ยังไม่ได้ตั้งค่า (.env)'}`);
});
