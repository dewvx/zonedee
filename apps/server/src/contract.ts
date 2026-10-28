import type { ContractSpec } from '@zonedee/core';
import type { Mt5SymbolInfo } from './fetchers/mt5';
import type { CandleStore } from './store';
import type { SymbolConfig } from './symbols';

/** สเปกสัญญา + ข้อมูลบัญชี สำหรับเครื่องคิด lot */
export interface ContractInfo {
  spec: ContractSpec;
  /** leverage ของบัญชี (MT5) หรือค่าทั่วไป (static) · หุ้น = 1 */
  leverage: number | null;
  /** ยอดเงินในบัญชี MT5 (null = ไม่รู้ ให้ผู้ใช้กรอกเอง) */
  balance: number | null;
  accountCurrency: string;
  /** spread ปัจจุบันจาก MT5 (points) */
  spreadPoints: number | null;
  source: 'mt5' | 'static';
  note?: string;
}

/**
 * สเปกมาตรฐาน (ใช้เมื่อไม่ได้ดึงจาก MT5) — ค่าตามบัญชี XM Standard ทั่วไป
 * ถ้าบัญชีจริงต่างจากนี้ ตัวเลขใน MT5 คือของจริง
 */
export const STATIC: Record<string, Omit<ContractSpec, 'symbol' | 'tickValue'> & { quoteIsUsd: boolean }> = {
  XAUUSD: {
    contractSize: 100,
    tickSize: 0.01,
    volumeMin: 0.01,
    volumeStep: 0.01,
    volumeMax: 50,
    digits: 2,
    marginMode: 'quote',
    unit: 'lot',
    quoteIsUsd: true,
    swapLong: -28.5,
    swapShort: 14.2,
    swapMode: 'points',
    swap3Day: 3,
  },
  EURUSD: {
    contractSize: 100_000,
    tickSize: 0.00001,
    volumeMin: 0.01,
    volumeStep: 0.01,
    volumeMax: 50,
    digits: 5,
    marginMode: 'quote',
    unit: 'lot',
    quoteIsUsd: true,
    swapLong: -6.8,
    swapShort: 2.5,
    swapMode: 'points',
    swap3Day: 3,
  },
  GBPUSD: {
    contractSize: 100_000,
    tickSize: 0.00001,
    volumeMin: 0.01,
    volumeStep: 0.01,
    volumeMax: 50,
    digits: 5,
    marginMode: 'quote',
    unit: 'lot',
    quoteIsUsd: true,
    swapLong: -4.2,
    swapShort: -1.5,
    swapMode: 'points',
    swap3Day: 3,
  },
  USDJPY: {
    contractSize: 100_000,
    tickSize: 0.001,
    volumeMin: 0.01,
    volumeStep: 0.01,
    volumeMax: 50,
    digits: 3,
    marginMode: 'base',
    unit: 'lot',
    quoteIsUsd: false,
    swapLong: 12.5,
    swapShort: -24.8,
    swapMode: 'points',
    swap3Day: 3,
  },
};

/** สเปกจากตาราง static — tickValue ของคู่ที่สกุล quote ไม่ใช่ USD คิดจากราคาล่าสุด */
export function staticContract(cfg: SymbolConfig, lastPrice: number | null): ContractInfo {
  if (cfg.market === 'us-stock') {
    return {
      spec: {
        symbol: cfg.symbol,
        contractSize: 1,
        tickSize: 0.01,
        tickValue: 0.01,
        volumeMin: 0.0001,
        volumeStep: 0.0001,
        volumeMax: 1_000_000,
        digits: 2,
        marginMode: 'quote',
        unit: 'share',
      },
      leverage: 1,
      balance: null,
      accountCurrency: 'USD',
      spreadPoints: null,
      source: 'static',
      note: 'หุ้น: 1 หน่วย = 1 หุ้น (ซื้อเศษหุ้นได้) ไม่มี leverage',
    };
  }
  const s = STATIC[cfg.symbol];
  if (!s) throw new Error(`ยังไม่มีสเปกสัญญาของ ${cfg.symbol}`);
  const { quoteIsUsd, ...rest } = s;
  const price = lastPrice ?? cfg.samplePrice;
  return {
    spec: {
      symbol: cfg.symbol,
      ...rest,
      tickValue: quoteIsUsd ? s.tickSize * s.contractSize : (s.tickSize * s.contractSize) / price,
    },
    leverage: 1000,
    balance: null,
    accountCurrency: 'USD',
    spreadPoints: null,
    source: 'static',
    note: 'ค่ามาตรฐานบัญชี XM Standard — เปิด MT5 ไว้เพื่อใช้ค่าจริงของบัญชีคุณ',
  };
}

export function fromMt5Info(cfg: SymbolConfig, i: Mt5SymbolInfo): ContractInfo {
  return {
    spec: {
      symbol: cfg.symbol,
      contractSize: i.contractSize,
      tickSize: i.tickSize,
      tickValue: i.tickValue,
      volumeMin: i.volumeMin,
      volumeStep: i.volumeStep,
      volumeMax: i.volumeMax,
      digits: i.digits,
      marginMode: i.currencyBase === i.accountCurrency ? 'base' : 'quote',
      unit: 'lot',
      swapLong: i.swapLong,
      swapShort: i.swapShort,
      swapMode: i.swapMode,
      swap3Day: i.swap3Day,
    },
    leverage: i.leverage,
    balance: i.balance,
    accountCurrency: i.accountCurrency,
    spreadPoints: i.spreadPoints,
    source: 'mt5',
  };
}

const CACHE_MS = 60_000;

/**
 * ตัวหาสเปกสัญญา: symbol ที่ใช้แหล่ง mt5 → ถามสคริปต์ MT5 (cache 1 นาที) · พัง/แหล่งอื่น → ตาราง static
 */
export function createContractProvider(store: CandleStore, mt5Info: (symbol: string) => Promise<Mt5SymbolInfo>) {
  const cache = new Map<string, { at: number; info: ContractInfo }>();

  return async function getContract(cfg: SymbolConfig): Promise<ContractInfo> {
    const hit = cache.get(cfg.symbol);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;

    const lastPrice = store.latest(cfg.symbol, cfg.natives[0]!.tf, 1)[0]?.close ?? null;
    let info: ContractInfo;
    if (cfg.source === 'mt5') {
      try {
        info = fromMt5Info(cfg, await mt5Info(cfg.sourceSymbol));
      } catch (err) {
        info = { ...staticContract(cfg, lastPrice), note: `ดึงจาก MT5 ไม่ได้ (${(err as Error).message}) — ใช้ค่ามาตรฐานแทน` };
      }
    } else {
      info = staticContract(cfg, lastPrice);
    }
    cache.set(cfg.symbol, { at: Date.now(), info });
    return info;
  };
}
