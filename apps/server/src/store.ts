import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Candle, Timeframe } from '@zonedee/core';

/** ที่เก็บไฟล์ฐานข้อมูล: <root>/data/zonedee.sqlite (เปลี่ยนได้ด้วย env ZONEDEE_DB) */
export const DEFAULT_DB_PATH =
  process.env.ZONEDEE_DB ?? resolve(import.meta.dirname, '../../../data/zonedee.sqlite');

export interface SeriesStats {
  symbol: string;
  timeframe: Timeframe;
  count: number;
  first: number;
  last: number;
}

/**
 * เก็บแท่งเทียนลง SQLite (ใช้ node:sqlite ที่มากับ Node — ไม่ต้องคอมไพล์ native module บน Windows)
 * ตาราง candles: 1 แถว = 1 แท่ง ของ (symbol, timeframe)
 */
export class CandleStore {
  private db: DatabaseSync;
  private stmtUpsert: StatementSync;
  private stmtLatest: StatementSync;
  private stmtLatestBefore: StatementSync;
  private stmtRange: StatementSync;
  private stmtAfter: StatementSync;
  private stmtLastTime: StatementSync;

  constructor(path: string = DEFAULT_DB_PATH) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS candles (
        symbol    TEXT    NOT NULL,
        timeframe TEXT    NOT NULL,
        time      INTEGER NOT NULL,
        open      REAL    NOT NULL,
        high      REAL    NOT NULL,
        low       REAL    NOT NULL,
        close     REAL    NOT NULL,
        volume    REAL    NOT NULL,
        PRIMARY KEY (symbol, timeframe, time)
      ) WITHOUT ROWID;
    `);

    this.stmtUpsert = this.db.prepare(`
      INSERT INTO candles (symbol, timeframe, time, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (symbol, timeframe, time) DO UPDATE SET
        open = excluded.open, high = excluded.high, low = excluded.low,
        close = excluded.close, volume = excluded.volume
    `);
    this.stmtLatest = this.db.prepare(`
      SELECT time, open, high, low, close, volume FROM candles
      WHERE symbol = ? AND timeframe = ? ORDER BY time DESC LIMIT ?
    `);
    this.stmtLatestBefore = this.db.prepare(`
      SELECT time, open, high, low, close, volume FROM candles
      WHERE symbol = ? AND timeframe = ? AND time < ? ORDER BY time DESC LIMIT ?
    `);
    this.stmtRange = this.db.prepare(`
      SELECT time, open, high, low, close, volume FROM candles
      WHERE symbol = ? AND timeframe = ? AND time >= ? AND time < ? ORDER BY time ASC
    `);
    this.stmtAfter = this.db.prepare(`
      SELECT time, open, high, low, close, volume FROM candles
      WHERE symbol = ? AND timeframe = ? AND time >= ? ORDER BY time ASC LIMIT ?
    `);
    this.stmtLastTime = this.db.prepare(`
      SELECT MAX(time) AS last FROM candles WHERE symbol = ? AND timeframe = ?
    `);
  }

  /** เพิ่ม/อัปเดตแท่งเทียน (ทำใน transaction เดียว) คืนจำนวนแถว */
  upsert(symbol: string, tf: Timeframe, candles: readonly Candle[]): number {
    if (candles.length === 0) return 0;
    this.db.exec('BEGIN');
    try {
      for (const c of candles) {
        this.stmtUpsert.run(symbol, tf, c.time, c.open, c.high, c.low, c.close, c.volume);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return candles.length;
  }

  /** แท่งล่าสุด `count` แท่ง (ก่อนเวลา `before` ถ้าระบุ) เรียงเก่า → ใหม่ */
  latest(symbol: string, tf: Timeframe, count: number, before?: number): Candle[] {
    const rows =
      before === undefined
        ? this.stmtLatest.all(symbol, tf, count)
        : this.stmtLatestBefore.all(symbol, tf, before, count);
    return (rows as unknown as Candle[]).reverse();
  }

  /** แท่ง `count` แท่งแรกที่เวลา ≥ `from` เรียงเก่า → ใหม่ (ใช้ใน replay: แท่ง "อนาคต" ที่ซ่อนไว้) */
  after(symbol: string, tf: Timeframe, from: number, count: number): Candle[] {
    return this.stmtAfter.all(symbol, tf, from, count) as unknown as Candle[];
  }

  /** แท่งในช่วง [from, to) เรียงเก่า → ใหม่ */
  range(symbol: string, tf: Timeframe, from: number, to: number): Candle[] {
    return this.stmtRange.all(symbol, tf, from, to) as unknown as Candle[];
  }

  /** เวลาเปิดของแท่งล่าสุด หรือ null ถ้ายังไม่มีข้อมูล */
  lastTime(symbol: string, tf: Timeframe): number | null {
    const row = this.stmtLastTime.get(symbol, tf) as { last: number | null } | undefined;
    return row?.last ?? null;
  }

  /** ลบข้อมูลทั้งหมดของ symbol (ใช้ตอนเปลี่ยนแหล่งข้อมูล) คืนจำนวนแถวที่ลบ */
  deleteSymbol(symbol: string): number {
    const res = this.db.prepare('DELETE FROM candles WHERE symbol = ?').run(symbol);
    return Number(res.changes);
  }

  stats(symbol: string): SeriesStats[] {
    return this.db
      .prepare(
        `SELECT symbol, timeframe, COUNT(*) AS count, MIN(time) AS first, MAX(time) AS last
         FROM candles WHERE symbol = ? GROUP BY timeframe`,
      )
      .all(symbol) as unknown as SeriesStats[];
  }

  close(): void {
    this.db.close();
  }
}
