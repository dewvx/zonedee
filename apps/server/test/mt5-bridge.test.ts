import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMt5Output } from '../src/fetchers/mt5';

const SCRIPT = resolve(import.meta.dirname, '../../../tools/mt5/mt5_export.py');
const FAKE = resolve(import.meta.dirname, 'fixtures/fake-mt5');
const PYTHON = process.env.ZONEDEE_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

function hasPython(): boolean {
  try {
    execFileSync(PYTHON, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(args: string[]): string {
  return execFileSync(PYTHON, [SCRIPT, ...args], {
    env: { ...process.env, PYTHONPATH: FAKE, PYTHONIOENCODING: 'utf-8' },
    encoding: 'utf8',
  });
}

describe.skipIf(!hasPython())('tools/mt5/mt5_export.py (ใช้ MetaTrader5 ปลอม)', () => {
  it('หน้าหนาว: แปลงเวลาเซิร์ฟเวอร์ GMT+2 กลับเป็น UTC และคืนตรงช่วงที่ขอ', () => {
    const from = '2026-01-12T10:00:00Z';
    const to = '2026-01-12T10:05:00Z';
    const candles = parseMt5Output(run(['--symbol', 'GOLD', '--timeframe', 'M1', '--from', from, '--to', to]));
    expect(candles.map((c) => new Date(c.time).toISOString())).toEqual([
      '2026-01-12T10:00:00.000Z',
      '2026-01-12T10:01:00.000Z',
      '2026-01-12T10:02:00.000Z',
      '2026-01-12T10:03:00.000Z',
      '2026-01-12T10:04:00.000Z',
    ]);
    expect(candles[0]).toMatchObject({ open: 2650, high: 2651, low: 2649, close: 2650.5, volume: 42 });
  });

  it('ช่วง US DST: ใช้ GMT+3', () => {
    const candles = parseMt5Output(
      run(['--symbol', 'GOLD', '--from', '2026-07-01T00:00:00Z', '--to', '2026-07-01T00:02:00Z']),
    );
    expect(candles.map((c) => new Date(c.time).toISOString())).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:01:00.000Z',
    ]);
  });

  it('--list แสดงชื่อ symbol', () => {
    expect(run(['--list', 'GOLD'])).toContain('GOLD');
  });

  it('symbol ไม่มีใน MT5 → error พร้อมชื่อที่ใกล้เคียง', () => {
    expect(() => run(['--symbol', 'XAUUSD', '--from', '2026-01-12T00:00:00Z', '--to', '2026-01-12T00:01:00Z'])).toThrow();
  });
});
