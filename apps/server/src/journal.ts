import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { rMultiple, isTimeframe, type Timeframe } from '@zonedee/core';

export type JournalStatus = 'plan' | 'open' | 'closed' | 'cancelled';

/** บันทึกการเทรด 1 รายการ (เวลาเป็น UTC ms) */
export interface JournalEntry {
  id: number;
  createdAt: number;
  updatedAt: number;
  symbol: string;
  tf: Timeframe | null;
  direction: 'long' | 'short';
  /** plan = วางแผนไว้ · open = เข้าแล้ว · closed = ปิดแล้ว · cancelled = ไม่ได้เข้า */
  status: JournalStatus;
  entryTime: number | null;
  entryPrice: number | null;
  sl: number | null;
  tp: number | null;
  lots: number | null;
  exitTime: number | null;
  exitPrice: number | null;
  /** กำไร/ขาดทุนเป็นเงิน (กรอกเองจาก MT5) */
  pnl: number | null;
  /** คำนวณจาก entry/SL/exit */
  r: number | null;
  /** id ของท่า (ผูกกับสัญญาณ) หรือชื่อท่าที่พิมพ์เอง */
  strategy: string;
  /** เวลาแท่งของสัญญาณที่ผูกไว้ (จากหน้าแจ้งเตือน/backtest) */
  signalTime: number | null;
  /** ทำไมถึงเข้า */
  setup: string;
  /** หลังจบ: ได้เรียนอะไร / ผิดตรงไหน */
  lesson: string;
  /** อารมณ์ตอนเข้า (FOMO, มั่นใจ, กลัว …) */
  emotion: string;
  /** ทำตามแผนไหม */
  followedPlan: boolean | null;
  tags: string[];
  /** ชื่อไฟล์รูปใน data/journal/ */
  images: string[];
}

export type JournalInput = Partial<Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt' | 'r' | 'images'>>;

export class JournalError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const STATUSES: JournalStatus[] = ['plan', 'open', 'closed', 'cancelled'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

interface Row {
  id: number;
  created_at: number;
  updated_at: number;
  data: string;
}

/**
 * Journal เก็บใน SQLite ไฟล์เดียวกับราคา (ตาราง journal) — 1 แถว = 1 เทรด เก็บเป็น JSON
 * รูปเก็บเป็นไฟล์ใน imageDir (ค่าเริ่มต้น data/journal/) ไม่ขึ้น git
 */
export class JournalStore {
  private db: DatabaseSync;
  private stmtAll: StatementSync;
  private stmtGet: StatementSync;
  private stmtInsert: StatementSync;
  private stmtUpdate: StatementSync;
  private stmtDelete: StatementSync;
  /** โฟลเดอร์รูป (absolute) */
  readonly imageDir: string;

  constructor(dbPath: string, imageDir?: string) {
    this.imageDir = resolve(imageDir ?? join(dirname(dbPath === ':memory:' ? './data/x' : dbPath), 'journal'));
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS journal (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        data       TEXT    NOT NULL
      );
    `);
    this.stmtAll = this.db.prepare('SELECT * FROM journal ORDER BY id DESC');
    this.stmtGet = this.db.prepare('SELECT * FROM journal WHERE id = ?');
    this.stmtInsert = this.db.prepare('INSERT INTO journal (created_at, updated_at, data) VALUES (?, ?, ?)');
    this.stmtUpdate = this.db.prepare('UPDATE journal SET updated_at = ?, data = ? WHERE id = ?');
    this.stmtDelete = this.db.prepare('DELETE FROM journal WHERE id = ?');
  }

  private fromRow(row: Row): JournalEntry {
    const d = JSON.parse(row.data) as Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>;
    return { ...d, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  list(): JournalEntry[] {
    return (this.stmtAll.all() as unknown as Row[]).map((r) => this.fromRow(r));
  }

  get(id: number): JournalEntry | null {
    const row = this.stmtGet.get(id) as unknown as Row | undefined;
    return row ? this.fromRow(row) : null;
  }

  /** ตรวจ/ทำความสะอาดข้อมูลที่ส่งมา แล้วคิด R ใหม่ */
  private normalize(input: JournalInput, base?: JournalEntry): Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'> {
    const m = { ...base, ...input };
    const symbol = str(m.symbol, 20).toUpperCase();
    if (!symbol) throw new JournalError('ต้องมี symbol');
    const direction = m.direction === 'short' ? 'short' : 'long';
    const status = STATUSES.includes(m.status as JournalStatus) ? (m.status as JournalStatus) : 'plan';
    const entryPrice = num(m.entryPrice);
    const sl = num(m.sl);
    const exitPrice = num(m.exitPrice);
    const tf = typeof m.tf === 'string' && isTimeframe(m.tf) ? m.tf : null;
    return {
      symbol,
      tf,
      direction,
      status,
      entryTime: num(m.entryTime),
      entryPrice,
      sl,
      tp: num(m.tp),
      lots: num(m.lots),
      exitTime: num(m.exitTime),
      exitPrice,
      pnl: num(m.pnl),
      r: status === 'closed' && entryPrice !== null && exitPrice !== null ? rMultiple(direction, entryPrice, sl, exitPrice) : null,
      strategy: str(m.strategy, 100),
      signalTime: num(m.signalTime),
      setup: str(m.setup),
      lesson: str(m.lesson),
      emotion: str(m.emotion, 100),
      followedPlan: typeof m.followedPlan === 'boolean' ? m.followedPlan : null,
      tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 20) : [],
      images: base?.images ?? [],
    };
  }

  create(input: JournalInput): JournalEntry {
    const data = this.normalize(input);
    const now = Date.now();
    const res = this.stmtInsert.run(now, now, JSON.stringify(data));
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, input: JournalInput): JournalEntry {
    const cur = this.get(id);
    if (!cur) throw new JournalError(`ไม่เจอรายการ #${id}`, 404);
    const data = this.normalize(input, cur);
    this.stmtUpdate.run(Date.now(), JSON.stringify(data), id);
    return this.get(id)!;
  }

  delete(id: number): void {
    const cur = this.get(id);
    if (!cur) throw new JournalError(`ไม่เจอรายการ #${id}`, 404);
    for (const img of cur.images) rmSync(join(this.imageDir, img), { force: true });
    this.stmtDelete.run(id);
  }

  /** เพิ่มรูปจาก data URL (png/jpeg/webp) — คืนรายการที่อัปเดตแล้ว */
  addImage(id: number, dataUrl: string): JournalEntry {
    const cur = this.get(id);
    if (!cur) throw new JournalError(`ไม่เจอรายการ #${id}`, 404);
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new JournalError('รูปต้องเป็น data URL แบบ png / jpeg / webp');
    if (cur.images.length >= 12) throw new JournalError('รูปได้สูงสุด 12 รูปต่อรายการ');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1]!;
    const name = `${id}-${Date.now().toString(36)}.${ext}`;
    mkdirSync(this.imageDir, { recursive: true });
    writeFileSync(join(this.imageDir, name), Buffer.from(m[2]!, 'base64'));
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = cur;
    this.stmtUpdate.run(Date.now(), JSON.stringify({ ...rest, images: [...cur.images, name] }), id);
    return this.get(id)!;
  }

  removeImage(id: number, name: string): JournalEntry {
    const cur = this.get(id);
    if (!cur) throw new JournalError(`ไม่เจอรายการ #${id}`, 404);
    if (!cur.images.includes(name)) throw new JournalError('ไม่เจอรูปนี้', 404);
    rmSync(join(this.imageDir, name), { force: true });
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = cur;
    this.stmtUpdate.run(Date.now(), JSON.stringify({ ...rest, images: cur.images.filter((x) => x !== name) }), id);
    return this.get(id)!;
  }

  /** path ของไฟล์รูป (กัน ../) */
  imagePath(name: string): string | null {
    if (!/^\d+-[a-z0-9]+\.(png|jpg|webp)$/.test(name)) return null;
    const p = join(this.imageDir, name);
    return existsSync(p) ? p : null;
  }

  close(): void {
    this.db.close();
  }
}
