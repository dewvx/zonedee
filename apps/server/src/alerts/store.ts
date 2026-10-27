import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { getStrategy, isTimeframe, type ParamValue, type Timeframe } from '@zonedee/core';

export type PriceCondition = 'cross-above' | 'cross-below' | 'touch';
/** แนวรับต้านแบบง่าย (keyLevels): ดังตอนสถานะเปลี่ยนเข้าเงื่อนไข ไม่ดังซ้ำทุกแท่ง */
export type LevelCondition = 'near-support' | 'near-resistance' | 'broke-support' | 'broke-resistance';
export const LEVEL_CONDITIONS: LevelCondition[] = ['near-support', 'near-resistance', 'broke-support', 'broke-resistance'];

/** กฎแจ้งเตือน 1 ข้อ */
export interface AlertRule {
  id: number;
  createdAt: number;
  updatedAt: number;
  name: string;
  enabled: boolean;
  symbol: string;
  tf: Timeframe;
  /**
   * strategy = เมื่อท่าเกิดสัญญาณ · price = เมื่อราคาถึงระดับ
   * level = เข้าใกล้/หลุด/ทะลุ แนวรับต้านแบบง่าย · earnings = ก่อนวันประกาศงบ
   */
  kind: 'strategy' | 'price' | 'level' | 'earnings';
  strategy: string;
  params: Record<string, ParamValue>;
  swingLength: number | null;
  breakBy: 'close' | 'wick' | null;
  condition: PriceCondition;
  price: number | null;
  /** price: ดังครั้งเดียวแล้วปิดตัวเอง */
  once: boolean;
  /** level: เงื่อนไข */
  levelCondition: LevelCondition;
  /** earnings: เตือนล่วงหน้ากี่วัน */
  daysBefore: number;
  /** ส่งเข้า LINE ด้วย (ไม่งั้นแจ้งแค่ในแอป) */
  notifyLine: boolean;
  /** เวลาเปิดของแท่งปิดล่าสุดที่ตรวจแล้ว (กันแจ้งซ้ำ/แจ้งย้อนหลัง) · earnings: วันประกาศงบที่แจ้งไปแล้ว */
  lastCheckedBar: number | null;
  lastFiredAt: number | null;
  /** ตรวจรอบล่าสุดมีปัญหา (เช่นดึงข้อมูลไม่ได้) */
  lastError: string | null;
}

export type AlertRuleInput = Partial<Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>>;

export interface AlertEvent {
  id: number;
  ruleId: number;
  ruleName: string;
  symbol: string;
  tf: Timeframe;
  /** เวลาเปิดของแท่งที่ทำให้แจ้งเตือน */
  barTime: number;
  firedAt: number;
  message: string;
  signal: { direction: 'long' | 'short'; entryType: 'market' | 'limit'; entry: number; sl: number; tp: number; reason: string } | null;
  strategy: string;
  line: 'sent' | 'failed' | 'off' | 'capped';
  lineError: string | null;
}

export class AlertError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const CONDITION_TH: Record<PriceCondition, string> = { 'cross-above': 'ปิดเหนือ', 'cross-below': 'ปิดใต้', touch: 'แตะ' };
export const LEVEL_CONDITION_TH: Record<LevelCondition, string> = {
  'near-support': 'ใกล้แนวรับ',
  'near-resistance': 'ใกล้แนวต้าน',
  'broke-support': 'หลุดแนวรับ',
  'broke-resistance': 'ทะลุแนวต้าน',
};
const KINDS: AlertRule['kind'][] = ['strategy', 'price', 'level', 'earnings'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MAX_EVENTS = 500;

interface Row {
  id: number;
  created_at: number;
  updated_at: number;
  data: string;
}

export class AlertStore {
  private db: DatabaseSync;
  private s: Record<string, StatementSync>;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fired_at INTEGER NOT NULL, data TEXT NOT NULL
      );
    `);
    this.s = {
      rules: this.db.prepare('SELECT * FROM alert_rules ORDER BY id'),
      rule: this.db.prepare('SELECT * FROM alert_rules WHERE id = ?'),
      insertRule: this.db.prepare('INSERT INTO alert_rules (created_at, updated_at, data) VALUES (?, ?, ?)'),
      updateRule: this.db.prepare('UPDATE alert_rules SET updated_at = ?, data = ? WHERE id = ?'),
      deleteRule: this.db.prepare('DELETE FROM alert_rules WHERE id = ?'),
      events: this.db.prepare('SELECT * FROM alert_events WHERE id > ? ORDER BY id DESC LIMIT ?'),
      insertEvent: this.db.prepare('INSERT INTO alert_events (fired_at, data) VALUES (?, ?)'),
      trimEvents: this.db.prepare('DELETE FROM alert_events WHERE id <= (SELECT MAX(id) FROM alert_events) - ?'),
      countToday: this.db.prepare('SELECT data FROM alert_events WHERE fired_at >= ?'),
      clearEvents: this.db.prepare('DELETE FROM alert_events'),
    };
  }

  private ruleFrom(row: Row): AlertRule {
    // levelCondition / daysBefore มาทีหลัง — กฎเก่าไม่มี
    const d = JSON.parse(row.data) as AlertRule;
    return {
      ...d,
      levelCondition: d.levelCondition ?? 'near-support',
      daysBefore: d.daysBefore ?? 3,
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  rules(): AlertRule[] {
    return (this.s.rules!.all() as unknown as Row[]).map((r) => this.ruleFrom(r));
  }

  rule(id: number): AlertRule | null {
    const row = this.s.rule!.get(id) as unknown as Row | undefined;
    return row ? this.ruleFrom(row) : null;
  }

  private normalize(input: AlertRuleInput, base?: AlertRule): Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'> {
    const m = { ...base, ...input };
    const symbol = String(m.symbol ?? '').toUpperCase();
    if (!symbol) throw new AlertError('ต้องเลือก symbol');
    const kind: AlertRule['kind'] = KINDS.includes(m.kind as AlertRule['kind']) ? (m.kind as AlertRule['kind']) : 'strategy';
    // วันประกาศงบไม่ขึ้นกับ TF — ใช้ D1 เสมอ
    if (kind === 'earnings') m.tf = 'D1';
    if (typeof m.tf !== 'string' || !isTimeframe(m.tf)) throw new AlertError('TF ไม่ถูกต้อง');
    const strategy = String(m.strategy ?? '');
    if (kind === 'strategy') {
      const st = getStrategy(strategy);
      if (!st) throw new AlertError(`ไม่รู้จักท่า: ${strategy}`);
      if (!st.timeframes.includes(m.tf)) throw new AlertError(`${st.name} ใช้กับ ${m.tf} ไม่ได้`);
    }
    const price = num(m.price);
    if (kind === 'price' && price === null) throw new AlertError('ต้องใส่ราคา');
    const condition: PriceCondition = m.condition === 'cross-below' || m.condition === 'touch' ? m.condition : 'cross-above';
    const levelCondition: LevelCondition = LEVEL_CONDITIONS.includes(m.levelCondition as LevelCondition)
      ? (m.levelCondition as LevelCondition)
      : 'near-support';
    const daysBefore = Math.min(Math.max(Math.round(num(m.daysBefore) ?? 3), 0), 30);
    // เปลี่ยนเงื่อนไขสำคัญ → เริ่มนับใหม่ (ไม่แจ้งย้อนหลัง)
    const reset =
      !!base &&
      (base.symbol !== symbol ||
        base.tf !== m.tf ||
        base.kind !== kind ||
        base.strategy !== strategy ||
        base.price !== price ||
        base.levelCondition !== levelCondition);
    return {
      name:
        String(m.name ?? '').slice(0, 80) ||
        (kind === 'price'
          ? `${symbol} ${m.tf} ${CONDITION_TH[condition]} ${price}`
          : kind === 'level'
            ? `${symbol} ${m.tf} ${LEVEL_CONDITION_TH[levelCondition]}`
            : kind === 'earnings'
              ? `${symbol} ประกาศงบ (ล่วงหน้า ${daysBefore} วัน)`
              : `${symbol} ${m.tf} ${getStrategy(strategy)?.name ?? strategy}`),
      enabled: m.enabled !== false,
      symbol,
      tf: m.tf,
      kind,
      strategy: kind === 'strategy' ? strategy : '',
      params: m.params && typeof m.params === 'object' ? m.params : {},
      swingLength: num(m.swingLength),
      breakBy: m.breakBy === 'wick' || m.breakBy === 'close' ? m.breakBy : null,
      condition,
      price: kind === 'price' ? price : null,
      once: kind === 'price' ? m.once !== false : false,
      levelCondition,
      daysBefore,
      notifyLine: m.notifyLine !== false,
      lastCheckedBar: reset || (base && !base.enabled && m.enabled) ? null : num(m.lastCheckedBar),
      lastFiredAt: num(m.lastFiredAt),
      lastError: typeof m.lastError === 'string' ? m.lastError : null,
    };
  }

  createRule(input: AlertRuleInput): AlertRule {
    const now = Date.now();
    const res = this.s.insertRule!.run(now, now, JSON.stringify(this.normalize({ ...input, lastCheckedBar: null })));
    return this.rule(Number(res.lastInsertRowid))!;
  }

  updateRule(id: number, input: AlertRuleInput): AlertRule {
    const cur = this.rule(id);
    if (!cur) throw new AlertError(`ไม่เจอกฎ #${id}`, 404);
    this.s.updateRule!.run(Date.now(), JSON.stringify(this.normalize(input, cur)), id);
    return this.rule(id)!;
  }

  /** อัปเดตสถานะภายในของ engine (ไม่ผ่าน normalize ส่วนที่ reset) */
  patchState(id: number, patch: Pick<Partial<AlertRule>, 'lastCheckedBar' | 'lastFiredAt' | 'lastError' | 'enabled'>): void {
    const cur = this.rule(id);
    if (!cur) return;
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = cur;
    this.s.updateRule!.run(cur.updatedAt, JSON.stringify({ ...rest, ...patch }), id);
  }

  deleteRule(id: number): void {
    if (!this.rule(id)) throw new AlertError(`ไม่เจอกฎ #${id}`, 404);
    this.s.deleteRule!.run(id);
  }

  addEvent(e: Omit<AlertEvent, 'id'>): AlertEvent {
    const res = this.s.insertEvent!.run(e.firedAt, JSON.stringify(e));
    this.s.trimEvents!.run(MAX_EVENTS);
    return { ...e, id: Number(res.lastInsertRowid) };
  }

  /** เหตุการณ์ใหม่กว่า id (ล่าสุดก่อน) */
  events(sinceId = 0, limit = 100): AlertEvent[] {
    return (this.s.events!.all(sinceId, limit) as unknown as { id: number; data: string }[]).map((r) => ({
      ...(JSON.parse(r.data) as AlertEvent),
      id: r.id,
    }));
  }

  /** จำนวนข้อความ LINE ที่ส่งไปแล้วตั้งแต่เวลานี้ */
  lineSentSince(since: number): number {
    return (this.s.countToday!.all(since) as unknown as { data: string }[]).filter(
      (r) => (JSON.parse(r.data) as AlertEvent).line === 'sent',
    ).length;
  }

  clearEvents(): void {
    this.s.clearEvents!.run();
  }

  close(): void {
    this.db.close();
  }
}
