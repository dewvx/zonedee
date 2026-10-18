import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SYMBOLS, findSymbol, usStock, type SymbolConfig } from './symbols';

export interface UserSymbol {
  symbol: string;
  description: string;
  addedAt: number;
}

/** ticker แบบ Yahoo: ตัวอักษร/ตัวเลข . - (เช่น BRK-B, SOFI) */
export const TICKER_RE = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * หุ้น US ที่ผู้ใช้เพิ่มเอง (จากหน้าสแกน / watchlist) เก็บในตาราง user_symbols
 * ดึงข้อมูลจาก Yahoo D1 เหมือนหุ้นในรายการหลัก
 */
export class UserSymbolStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS user_symbols (
        symbol TEXT PRIMARY KEY, description TEXT NOT NULL, added_at INTEGER NOT NULL
      );
    `);
  }

  list(): UserSymbol[] {
    return (this.db.prepare('SELECT * FROM user_symbols ORDER BY symbol').all() as unknown as { symbol: string; description: string; added_at: number }[]).map(
      (r) => ({ symbol: r.symbol, description: r.description, addedAt: r.added_at }),
    );
  }

  add(symbol: string, description = ''): UserSymbol {
    const s = symbol.trim().toUpperCase();
    if (!TICKER_RE.test(s)) throw new Error(`ticker ไม่ถูกต้อง: ${symbol}`);
    this.db
      .prepare('INSERT INTO user_symbols (symbol, description, added_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET description = excluded.description')
      .run(s, description.slice(0, 80), Date.now());
    return this.list().find((x) => x.symbol === s)!;
  }

  remove(symbol: string): boolean {
    return Number(this.db.prepare('DELETE FROM user_symbols WHERE symbol = ?').run(symbol.toUpperCase()).changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}

export interface SymbolRegistry {
  list(): SymbolConfig[];
  find(symbol: string): SymbolConfig | undefined;
  /** symbol นี้ผู้ใช้เพิ่มเอง (ลบได้) */
  isUser(symbol: string): boolean;
}

/** รายการหลัก (symbols.ts) + ที่ผู้ใช้เพิ่มเอง */
export function createSymbolRegistry(user?: UserSymbolStore): SymbolRegistry {
  const userConfigs = () => (user?.list() ?? []).filter((u) => !findSymbol(u.symbol)).map((u) => usStock(u.symbol, u.description || u.symbol, 20));
  return {
    list: () => [...SYMBOLS, ...userConfigs()],
    find: (symbol) => findSymbol(symbol) ?? userConfigs().find((c) => c.symbol === symbol.toUpperCase()),
    isUser: (symbol) => !findSymbol(symbol) && (user?.list().some((u) => u.symbol === symbol.toUpperCase()) ?? false),
  };
}
