import type { SymbolInfo, Timeframe } from '@zonedee/core';

/**
 * รายชื่อ symbol ที่แอปรู้จัก — อยากเพิ่มตัวไหน เพิ่มที่นี่แล้วรัน `npm run fetch`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ เปลี่ยนแหล่งข้อมูล forex/ทอง: แก้ FOREX_SOURCE ด้านล่าง แล้วรัน           │
 * │   npm run fetch -- --market forex --reset                                │
 * │ (--reset ลบข้อมูลเก่าของ symbol นั้นก่อน กันราคาต่างแหล่งปนกัน)          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * - 'yahoo'     ใช้ได้ทันที ไม่ต้องลงอะไร แต่ทองเป็น futures (GC=F) ไม่ใช่ spot
 *               และ M1 ย้อนหลังได้ ~1 เดือน, M5 ~60 วัน, H1 ~2 ปี
 * - 'mt5'       ดึงจาก MT5 ของ XM ราคาตรงกับที่เทรดจริง M1 ย้อนหลังยาว
 *               ต้องลง MT5 + Python ก่อน — ดู tools/mt5/README.md
 * - 'dukascopy' ฟรี M1 ย้อนหลังหลายปี (ช่วง ต.ค. 2026 เซิร์ฟเวอร์ตอบ 202 ใช้ไม่ได้)
 */
export type ForexSource = 'yahoo' | 'mt5' | 'dukascopy';
export const FOREX_SOURCE: ForexSource = 'mt5' as ForexSource;

export type DataSource = 'dukascopy' | 'yahoo' | 'mt5';

/** ชุดข้อมูลที่ดึงตรงจากแหล่ง (native) — TF อื่น resample จากชุดเหล่านี้ */
export interface NativeSeries {
  tf: Timeframe;
  /** แหล่งข้อมูลให้ย้อนหลังได้สูงสุดกี่วัน */
  maxDays: number;
  /** ดึงทีละกี่วันต่อ 1 request */
  chunkDays: number;
}

export interface SymbolConfig extends SymbolInfo {
  source: DataSource;
  /** ชื่อที่แหล่งข้อมูลใช้ เช่น Yahoo 'GC=F', XM 'GOLD' */
  sourceSymbol: string;
  /** TF ที่ดึงตรงจากแหล่ง เรียงจากเล็กไปใหญ่ */
  natives: NativeSeries[];
  /** TF ที่เปิดให้ดูในแอป */
  timeframes: Timeframe[];
  /** ดึงครั้งแรกย้อนหลังกี่วัน (ถูกจำกัดด้วย maxDays ของแต่ละ native) */
  defaultHistoryDays: number;
  /** ราคาเริ่มต้นของข้อมูลจำลอง ตอนยังไม่มีข้อมูลจริง */
  samplePrice: number;
}

const FOREX_TFS: Timeframe[] = ['M1', 'M5', 'M10', 'M15', 'M30', 'H1', 'H2', 'H4', 'D1', 'W1'];
const STOCK_TFS: Timeframe[] = ['D1', 'W1'];

const NATIVES: Record<DataSource | 'yahoo-stock', NativeSeries[]> = {
  // Yahoo intraday: 1m ได้ ~30 วัน (ทีละ 7 วัน), 5m ~60 วัน, 1h ~730 วัน
  yahoo: [
    { tf: 'M1', maxDays: 29, chunkDays: 7 },
    { tf: 'M5', maxDays: 59, chunkDays: 59 },
    { tf: 'H1', maxDays: 729, chunkDays: 729 },
  ],
  'yahoo-stock': [{ tf: 'D1', maxDays: 365 * 30, chunkDays: 365 * 30 }],
  mt5: [{ tf: 'M1', maxDays: 365 * 20, chunkDays: 30 }],
  dukascopy: [{ tf: 'M1', maxDays: 365 * 20, chunkDays: 7 }],
};

interface ForexDef {
  symbol: string;
  digits: number;
  description: string;
  samplePrice: number;
  /** ชื่อบนแต่ละแหล่ง — XM บางประเภทบัญชีมี suffix เช่น GOLD# / EURUSDm เช็กด้วย tools/mt5 --list */
  names: { yahoo: string; mt5: string; dukascopy: string };
}

const forex = (d: ForexDef, source: ForexSource = FOREX_SOURCE): SymbolConfig => ({
  symbol: d.symbol,
  market: 'forex',
  digits: d.digits,
  description:
    source === 'yahoo' && d.names.yahoo === 'GC=F' ? `${d.description} (Yahoo: Gold futures)` : d.description,
  source,
  sourceSymbol: d.names[source],
  natives: NATIVES[source],
  timeframes: FOREX_TFS,
  defaultHistoryDays: source === 'yahoo' ? 729 : 180,
  samplePrice: d.samplePrice,
});

const usStock = (symbol: string, description: string, samplePrice: number): SymbolConfig => ({
  symbol,
  market: 'us-stock',
  digits: 2,
  description,
  source: 'yahoo',
  sourceSymbol: symbol,
  natives: NATIVES['yahoo-stock'],
  timeframes: STOCK_TFS,
  defaultHistoryDays: 365 * 5,
  samplePrice,
});

export const SYMBOLS: SymbolConfig[] = [
  forex({
    symbol: 'XAUUSD',
    digits: 2,
    description: 'ทองคำ / ดอลลาร์สหรัฐ',
    samplePrice: 2650,
    names: { yahoo: 'GC=F', mt5: 'GOLD', dukascopy: 'xauusd' },
  }),
  forex({
    symbol: 'EURUSD',
    digits: 5,
    description: 'ยูโร / ดอลลาร์สหรัฐ',
    samplePrice: 1.085,
    names: { yahoo: 'EURUSD=X', mt5: 'EURUSD', dukascopy: 'eurusd' },
  }),
  forex({
    symbol: 'GBPUSD',
    digits: 5,
    description: 'ปอนด์ / ดอลลาร์สหรัฐ',
    samplePrice: 1.27,
    names: { yahoo: 'GBPUSD=X', mt5: 'GBPUSD', dukascopy: 'gbpusd' },
  }),
  forex({
    symbol: 'USDJPY',
    digits: 3,
    description: 'ดอลลาร์สหรัฐ / เยน',
    samplePrice: 150,
    names: { yahoo: 'JPY=X', mt5: 'USDJPY', dukascopy: 'usdjpy' },
  }),
  usStock('SPY', 'S&P 500 ETF', 600),
  usStock('AAPL', 'Apple', 230),
  usStock('NVDA', 'NVIDIA', 180),
  usStock('TSLA', 'Tesla', 400),
];

export function findSymbol(symbol: string): SymbolConfig | undefined {
  return SYMBOLS.find((s) => s.symbol === symbol.toUpperCase());
}

/** TF ที่ใช้เป็นต้นทางของ `target` = native ที่ใหญ่ที่สุดที่หาร target ลงตัว (null ถ้า target เป็น native เอง) */
export function parentNative(cfg: SymbolConfig, target: Timeframe, tfMs: Record<Timeframe, number>) {
  if (cfg.natives.some((n) => n.tf === target)) return null;
  const candidates = cfg.natives
    .filter((n) => tfMs[n.tf] < tfMs[target] && tfMs[target] % tfMs[n.tf] === 0)
    .sort((a, b) => tfMs[b.tf] - tfMs[a.tf]);
  return candidates[0]?.tf ?? null;
}
