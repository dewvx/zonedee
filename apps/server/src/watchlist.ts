import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { watchMetrics, type WatchMetrics } from '@zonedee/core';
import type { CandleStore } from './store';

/** หุ้นในพอร์ตลงทุนระยะยาว (Dime) */
export interface WatchItem {
  id: number;
  symbol: string;
  /** จำนวนหุ้นที่ถือ (ไม่ใส่ = แค่ติดตาม) */
  shares: number | null;
  /** ต้นทุนเฉลี่ยต่อหุ้น (USD) */
  avgCost: number | null;
  /** ตั้งใจ DCA เดือนละเท่าไร (USD) */
  dcaMonthly: number | null;
  note: string;
  addedAt: number;
}

export type WatchInput = Partial<Omit<WatchItem, 'id' | 'addedAt'>>;

export interface WatchRow extends WatchItem {
  metrics: WatchMetrics | null;
  /** มูลค่าตอนนี้ / ต้นทุนรวม / กำไร (USD) */
  value: number | null;
  cost: number | null;
  pnl: number | null;
  pnlPct: number | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export class WatchlistStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT, added_at INTEGER NOT NULL, data TEXT NOT NULL
      );
    `);
  }

  list(): WatchItem[] {
    return (this.db.prepare('SELECT * FROM watchlist ORDER BY id').all() as unknown as { id: number; added_at: number; data: string }[]).map(
      (r) => ({ ...(JSON.parse(r.data) as Omit<WatchItem, 'id' | 'addedAt'>), id: r.id, addedAt: r.added_at }),
    );
  }

  get(id: number): WatchItem | null {
    return this.list().find((x) => x.id === id) ?? null;
  }

  private clean(m: WatchInput) {
    const symbol = String(m.symbol ?? '').trim().toUpperCase();
    if (!symbol) throw new Error('ต้องมี symbol');
    return { symbol, shares: num(m.shares), avgCost: num(m.avgCost), dcaMonthly: num(m.dcaMonthly), note: String(m.note ?? '').slice(0, 500) };
  }

  add(input: WatchInput): WatchItem {
    const data = this.clean(input);
    if (this.list().some((x) => x.symbol === data.symbol)) throw new Error(`${data.symbol} อยู่ใน watchlist แล้ว`);
    const res = this.db.prepare('INSERT INTO watchlist (added_at, data) VALUES (?, ?)').run(Date.now(), JSON.stringify(data));
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, input: WatchInput): WatchItem {
    const cur = this.get(id);
    if (!cur) throw new Error(`ไม่เจอรายการ #${id}`);
    this.db.prepare('UPDATE watchlist SET data = ? WHERE id = ?').run(JSON.stringify(this.clean({ ...cur, ...input })), id);
    return this.get(id)!;
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM watchlist WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}

/** watchlist + ตัวเลขจากแท่ง D1 ในฐานข้อมูล + มูลค่าพอร์ต */
export function watchRows(items: readonly WatchItem[], store: CandleStore): WatchRow[] {
  return items.map((it) => {
    const metrics = watchMetrics(store.latest(it.symbol, 'D1', 400));
    const value = metrics && it.shares !== null ? metrics.close * it.shares : null;
    const cost = it.shares !== null && it.avgCost !== null ? it.shares * it.avgCost : null;
    const pnl = value !== null && cost !== null ? value - cost : null;
    return { ...it, metrics, value, cost, pnl, pnlPct: pnl !== null && cost ? (pnl / cost) * 100 : null };
  });
}
