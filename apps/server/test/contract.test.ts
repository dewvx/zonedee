import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calcPosition } from '@zonedee/core';
import { createContractProvider, fromMt5Info, staticContract } from '../src/contract';
import type { Mt5SymbolInfo } from '../src/fetchers/mt5';
import { CandleStore } from '../src/store';
import { findSymbol, type SymbolConfig } from '../src/symbols';

const goldInfo: Mt5SymbolInfo = {
  symbol: 'GOLD',
  contractSize: 100,
  tickSize: 0.01,
  tickValue: 1,
  volumeMin: 0.01,
  volumeStep: 0.01,
  volumeMax: 50,
  digits: 2,
  currencyBase: 'XAU',
  currencyProfit: 'USD',
  spreadPoints: 25,
  accountCurrency: 'USD',
  leverage: 1000,
  balance: 10_000,
};
const goldMt5: SymbolConfig = { ...findSymbol('XAUUSD')!, source: 'mt5', sourceSymbol: 'GOLD' };

let store: CandleStore;
beforeEach(() => (store = new CandleStore(':memory:')));
afterEach(() => store.close());

describe('contract specs', () => {
  it('MT5: ใช้ค่าจากบัญชี + margin แบบ quote สำหรับทอง', () => {
    const info = fromMt5Info(goldMt5, goldInfo);
    expect(info.source).toBe('mt5');
    expect(info.spec.marginMode).toBe('quote');
    expect(info.balance).toBe(10_000);
    expect(info.leverage).toBe(1000);
  });

  it('MT5: สกุลหลักเป็นสกุลบัญชี (USDJPY) → margin แบบ base', () => {
    const jpy = fromMt5Info(findSymbol('USDJPY')!, { ...goldInfo, currencyBase: 'USD', currencyProfit: 'JPY' });
    expect(jpy.spec.marginMode).toBe('base');
  });

  it('static: USDJPY tickValue คิดจากราคาล่าสุด', () => {
    const info = staticContract(findSymbol('USDJPY')!, 150);
    expect(info.spec.tickValue).toBeCloseTo((0.001 * 100_000) / 150);
  });

  it('static หุ้น: 1 หน่วย = 1 หุ้น, leverage 1', () => {
    const info = staticContract(findSymbol('AAPL')!, null);
    expect(info.spec.unit).toBe('share');
    expect(info.leverage).toBe(1);
  });

  it('static XAUUSD ใช้กับเครื่องคิดได้ (ตัวอย่างทอง SL $3)', () => {
    const { spec } = staticContract(findSymbol('XAUUSD')!, 4621);
    expect(spec.swapLong).toBe(-28.5);
    expect(spec.swapShort).toBe(14.2);
    expect(calcPosition({ spec, balance: 1000, riskPct: 1, entry: 4621, sl: 4618 }).lots).toBe(0.03);
  });

  it('provider: MT5 พัง → ใช้ static พร้อมหมายเหตุ · cache ไม่ถาม MT5 ซ้ำ', async () => {
    let calls = 0;
    const provider = createContractProvider(store, async () => {
      calls++;
      throw new Error('เชื่อมต่อ MT5 ไม่ได้');
    });
    const a = await provider(goldMt5);
    expect(a.source).toBe('static');
    expect(a.note).toContain('MT5');
    await provider(goldMt5);
    expect(calls).toBe(1);
  });
});

const PYTHON = process.env.ZONEDEE_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
const hasPython = (() => {
  try {
    execFileSync(PYTHON, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPython)('mt5_export.py --info (MetaTrader5 ปลอม)', () => {
  it('คืน JSON สเปกสัญญา + บัญชี', () => {
    const out = execFileSync(PYTHON, [resolve(import.meta.dirname, '../../../tools/mt5/mt5_export.py'), '--info', 'GOLD'], {
      env: { ...process.env, PYTHONPATH: resolve(import.meta.dirname, 'fixtures/fake-mt5'), PYTHONIOENCODING: 'utf-8' },
      encoding: 'utf8',
    });
    const info = JSON.parse(out) as Mt5SymbolInfo;
    expect(info).toMatchObject({
      contractSize: 100,
      tickSize: 0.01,
      tickValue: 1,
      leverage: 1000,
      balance: 10000,
      swapLong: -28.5,
      swapShort: 14.2,
      swapMode: 'points',
      swap3Day: 3,
    });
  });
});
