import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { Candle, Timeframe } from '@zonedee/core';

/** สคริปต์ Python ที่คุยกับ MT5 (เปลี่ยนได้ด้วย env ZONEDEE_MT5_SCRIPT) */
const SCRIPT =
  process.env.ZONEDEE_MT5_SCRIPT ?? resolve(import.meta.dirname, '../../../../tools/mt5/mt5_export.py');
/** คำสั่ง Python (Windows ปกติคือ `python` หรือ `py`) เปลี่ยนได้ด้วย env ZONEDEE_PYTHON */
const PYTHON = process.env.ZONEDEE_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

interface Mt5Row {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export function parseMt5Output(stdout: string): Candle[] {
  const out: Candle[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as Mt5Row;
    out.push({ time: r.t, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v });
  }
  return out;
}

/** รันสคริปต์ Python ของ MT5 แล้วคืน stdout (error → ข้อความจาก stderr ของสคริปต์) */
function runScript(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PYTHON, [SCRIPT, ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    child.on('error', (err) =>
      reject(
        new Error(
          `เรียก Python ไม่ได้ (${PYTHON}: ${err.message}) — ติดตั้ง Python แล้วลองใหม่ หรือตั้ง env ZONEDEE_PYTHON`,
        ),
      ),
    );
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `mt5_export.py จบด้วย code ${code}`));
      else resolvePromise(stdout);
    });
  });
}

/**
 * ดึงแท่งจาก MT5 ผ่านสคริปต์ Python (MT5 ต้องเปิดและ login ค้างไว้)
 * ดูวิธีติดตั้งที่ tools/mt5/README.md
 */
export async function fetchMt5(symbol: string, tf: Timeframe, from: Date, to: Date): Promise<Candle[]> {
  const stdout = await runScript([
    '--symbol',
    symbol,
    '--timeframe',
    tf,
    '--from',
    from.toISOString(),
    '--to',
    to.toISOString(),
  ]);
  try {
    return parseMt5Output(stdout);
  } catch (err) {
    throw new Error(`อ่านผลจาก MT5 ไม่ได้: ${(err as Error).message}`);
  }
}

/** ผลจาก `mt5_export.py --info` */
export interface Mt5SymbolInfo {
  symbol: string;
  contractSize: number;
  tickSize: number;
  tickValue: number;
  volumeMin: number;
  volumeStep: number;
  volumeMax: number;
  digits: number;
  currencyBase: string;
  currencyProfit: string;
  spreadPoints: number;
  accountCurrency: string;
  leverage: number | null;
  balance: number | null;
}

/** สเปกสัญญา + leverage + ยอดเงินจากบัญชี MT5 ที่ login อยู่ */
export async function fetchMt5Info(symbol: string): Promise<Mt5SymbolInfo> {
  const stdout = await runScript(['--info', symbol]);
  return JSON.parse(stdout.trim()) as Mt5SymbolInfo;
}
