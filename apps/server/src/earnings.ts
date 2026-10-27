import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** ดึงวันประกาศงบของหลาย symbol (null = ไม่รู้) */
export type EarningsFetcher = (symbols: readonly string[]) => Promise<Map<string, number | null>>;

/** อายุ cache วันประกาศงบ — วันประกาศไม่ค่อยเปลี่ยน ดึงวันละ 2 ครั้งพอ */
export const EARNINGS_TTL_MS = 12 * 3_600_000;

/**
 * cache วันประกาศงบ (UTC ms) เก็บใน SQLite — หน้า watchlist อ่านจาก cache อย่างเดียว
 * ดึงใหม่ตอนกดรีเฟรช watchlist หรือเมื่อตัวตรวจแจ้งเตือนต้องใช้แล้ว cache หมดอายุ
 */
export class EarningsCache {
  private db: DatabaseSync;

  constructor(
    dbPath: string,
    private fetcher: EarningsFetcher,
    private now: () => number = Date.now,
  ) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS earnings (symbol TEXT PRIMARY KEY, time INTEGER, fetched_at INTEGER NOT NULL);
    `);
  }

  private row(symbol: string) {
    return this.db.prepare('SELECT time, fetched_at FROM earnings WHERE symbol = ?').get(symbol) as
      | { time: number | null; fetched_at: number }
      | undefined;
  }

  /** วันประกาศงบจาก cache (ไม่ดึงใหม่) */
  get(symbol: string): number | null {
    return this.row(symbol)?.time ?? null;
  }

  /** ดึงใหม่เฉพาะตัวที่ cache หมดอายุ (force = ดึงทุกตัว) */
  async refresh(symbols: readonly string[], force = false): Promise<void> {
    const stale = [...new Set(symbols)].filter((s) => {
      const r = this.row(s);
      return force || !r || this.now() - r.fetched_at >= EARNINGS_TTL_MS;
    });
    if (stale.length === 0) return;
    const got = await this.fetcher(stale);
    const put = this.db.prepare(
      'INSERT INTO earnings (symbol, time, fetched_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET time = excluded.time, fetched_at = excluded.fetched_at',
    );
    for (const s of stale) put.run(s, got.get(s) ?? null, this.now());
  }

  /** วันประกาศงบ ดึงใหม่ถ้า cache หมดอายุ */
  async ensure(symbol: string): Promise<number | null> {
    await this.refresh([symbol]);
    return this.get(symbol);
  }

  close(): void {
    this.db.close();
  }
}
