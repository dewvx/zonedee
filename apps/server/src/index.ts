import { createApp } from './app';
import { createContractProvider } from './contract';
import { FETCHERS } from './fetchers';
import { fetchMt5Info } from './fetchers/mt5';
import { createFetchRunner } from './fetch-runner';
import { CandleStore, DEFAULT_DB_PATH } from './store';

const PORT = Number(process.env.PORT ?? 3001);
const store = new CandleStore();
const app = createApp({
  store,
  runFetch: createFetchRunner(store, FETCHERS),
  getContract: createContractProvider(store, fetchMt5Info),
  dbPath: DEFAULT_DB_PATH,
});

app.listen(PORT, () => {
  console.log(`[zonedee] server พร้อมที่ http://localhost:${PORT}`);
  console.log(`[zonedee] ฐานข้อมูล: ${DEFAULT_DB_PATH}`);
});
