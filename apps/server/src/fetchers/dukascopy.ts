import { resolve } from 'node:path';
import { getHistoricalRates } from 'dukascopy-node';
import type { Candle, Timeframe } from '@zonedee/core';

export interface DukascopyItem {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** แปลงผลลัพธ์ของ dukascopy-node เป็น Candle (ตัดแท่งที่ข้อมูลไม่ครบทิ้ง) */
export function mapDukascopyItems(items: readonly DukascopyItem[]): Candle[] {
  return items
    .filter(
      (i) =>
        Number.isFinite(i.timestamp) &&
        [i.open, i.high, i.low, i.close].every((v) => Number.isFinite(v) && v > 0),
    )
    .map((i) => ({
      time: i.timestamp,
      open: i.open,
      high: i.high,
      low: i.low,
      close: i.close,
      volume: i.volume ?? 0,
    }));
}

const CACHE_DIR = resolve(import.meta.dirname, '../../../../data/.dukascopy-cache');

/**
 * ดึงแท่ง M1 (ราคา bid) จาก Dukascopy ในช่วง [from, to)
 * หมายเหตุ: ต.ค. 2026 เซิร์ฟเวอร์ Dukascopy ตอบ HTTP 202 (ล่มฝั่งเขา) — ใช้ yahoo / mt5 แทนไปก่อน
 */
export async function fetchDukascopy(
  instrument: string,
  tf: Timeframe,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  if (tf !== 'M1') throw new Error(`zonedee ดึงจาก Dukascopy เฉพาะ M1 (ได้ ${tf})`);
  const items = await getHistoricalRates({
    instrument: instrument as never,
    dates: { from, to },
    timeframe: 'm1',
    priceType: 'bid',
    format: 'json',
    volumes: true,
    ignoreFlats: true,
    batchSize: 10,
    pauseBetweenBatchesMs: 500,
    retryCount: 1,
    pauseBetweenRetriesMs: 1000,
    useCache: true,
    cacheFolderPath: CACHE_DIR,
  });
  return mapDukascopyItems(items);
}
