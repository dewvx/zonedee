import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FundamentalData } from '@zonedee/core';

/** ดึงข้อมูลงบการเงินของหลาย symbol */
export type FundamentalsFetcher = (symbols: readonly string[]) => Promise<Map<string, FundamentalData>>;

/** อายุ cache ข้อมูลงบการเงิน — ตัวเลขงบและอัตราส่วนทางการเงินเปลี่ยนไม่บ่อย ดึงวันละ 1 ครั้ง (24 ชม.) */
export const FUNDAMENTALS_TTL_MS = 24 * 3_600_000;

/**
 * cache ข้อมูลงบการเงิน (P/E, Growth, Margins, Debt, ROE) เก็บใน SQLite
 * หน้า watchlist อ่านจาก cache เป็นหลัก ดึงใหม่เมื่อกดรีเฟรชหรือ cache หมดอายุ
 */
export class FundamentalsCache {
  private db: DatabaseSync;

  constructor(
    dbPath: string,
    private fetcher: FundamentalsFetcher,
    private now: () => number = Date.now,
  ) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS fundamentals (
        symbol TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
  }

  private row(symbol: string) {
    return this.db.prepare('SELECT data, fetched_at FROM fundamentals WHERE symbol = ?').get(symbol.toUpperCase()) as
      | { data: string; fetched_at: number }
      | undefined;
  }

  /** ดึงข้อมูลงบการเงินจาก cache (ไม่ดึงใหม่) */
  get(symbol: string): FundamentalData | null {
    const r = this.row(symbol);
    if (!r) return null;
    try {
      return JSON.parse(r.data) as FundamentalData;
    } catch {
      return null;
    }
  }

  /** ดึงใหม่เฉพาะตัวที่ cache หมดอายุ (force = บังคับดึงทุกตัว) */
  async refresh(symbols: readonly string[], force = false): Promise<void> {
    const stale = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => {
      const r = this.row(s);
      return force || !r || this.now() - r.fetched_at >= FUNDAMENTALS_TTL_MS;
    });
    if (stale.length === 0) return;

    const got = await this.fetcher(stale);
    const put = this.db.prepare(
      'INSERT INTO fundamentals (symbol, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at',
    );
    for (const s of stale) {
      const data = got.get(s) ?? {};
      put.run(s, JSON.stringify(data), this.now());
    }
  }

  /** ดึงข้อมูลงบการเงิน ถ้า cache หมดอายุจะดึงใหม่ */
  async ensure(symbol: string): Promise<FundamentalData | null> {
    await this.refresh([symbol]);
    return this.get(symbol);
  }

  close(): void {
    this.db.close();
  }
}
