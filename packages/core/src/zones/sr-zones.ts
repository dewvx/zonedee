import { DEFAULTS, type DetectorConfig } from '../config';
import { atr } from '../indicators/atr';
import { hasEqualBodiesAtPivot } from '../structure/equal-bodies';
import { detectSwings, type SwingPoint } from '../structure/swings';
import type { Candle } from '../types';

export type ZoneRole = 'resistance' | 'support';
/**
 * fresh   = เพิ่งเกิด ราคายังไม่กลับมาแตะ
 * tested  = ราคากลับมาแตะแล้ว (ไส้เข้าโซน) แต่ยังไม่ทะลุ
 * flipped = ถูกปิดทะลุ 1 ครั้ง กลับขั้วแล้ว (แนวต้าน → แนวรับ = RBS, แนวรับ → แนวต้าน = SBR)
 * (ทะลุครั้งที่ 2 หลังกลับขั้ว → ทิ้งโซน)
 */
export type ZoneState = 'fresh' | 'tested' | 'flipped';

export interface Zone {
  id: string;
  top: number;
  bottom: number;
  /** ค่าเฉลี่ยของระดับ swing ที่รวมเข้ามา */
  center: number;
  role: ZoneRole;
  /** โซนเกิดจาก swing high, swing low หรือทั้งสองแบบ */
  origin: 'high' | 'low' | 'both';
  state: ZoneState;
  /** ป้ายบนกราฟ: R / S / RBS / SBR */
  label: 'R' | 'S' | 'RBS' | 'SBR';
  /** จำนวน swing ที่มารวมในโซนนี้ */
  touches: number;
  /** มี swing ที่ผ่านกฎ "เนื้อเท่ากัน" อย่างน้อย 1 ตัว */
  equalBodies: boolean;
  /** เวลาของ swing แรก (ใช้เป็นขอบซ้ายตอนวาด) */
  startTime: number;
  /** แท่งที่โซนเกิด (confirmIndex ของ swing แรก) */
  createdIndex: number;
  /** pivotIndex ของ swing ล่าสุดที่รวมเข้ามา */
  lastTouchIndex: number;
  score: number;
}

interface ZoneDraft extends Omit<Zone, 'label' | 'score'> {
  levels: number[];
  flips: number;
  dead: boolean;
}

/** ความใหม่ลดลงครึ่งหนึ่งทุกๆ กี่แท่ง (ใช้ในคะแนน) */
const RECENCY_HALF_LIFE_BARS = 300;

/**
 * หาโซนแนวรับแนวต้าน ณ แท่ง `asOf` (default = แท่งสุดท้าย) ตาม docs/rules.md
 * 1. หา swing (ยืนยันแล้วไม่เกิน asOf) → แต่ละ swing เป็นระดับราคา
 * 2. ระดับที่ห่างจากโซนเดิม ≤ zoneMergeAtr × ATR → รวมเข้าโซนนั้น ไม่งั้นเปิดโซนใหม่ (กว้าง zoneWidthAtr × ATR)
 * 3. เดินทีละแท่งอัปเดตสถานะ: แตะ → tested · ปิดทะลุ → กลับขั้ว (flipped) · ทะลุซ้ำ → ทิ้ง
 * 4. คืนโซนที่ยังใช้ได้ คะแนนสูงสุด `maxZones` โซน เรียงราคาสูง → ต่ำ
 * causal: ใช้แค่แท่ง 0..asOf
 */
export function computeZones(
  candles: readonly Candle[],
  config: Partial<DetectorConfig> = {},
  asOf: number = candles.length - 1,
): Zone[] {
  const cfg = { ...DEFAULTS, ...config };
  if (asOf < 0 || candles.length === 0) return [];
  const data = asOf < candles.length - 1 ? candles.slice(0, asOf + 1) : candles;

  const atrs = atr(data, cfg.atrPeriod);
  const swingsByConfirm = new Map<number, SwingPoint[]>();
  for (const s of detectSwings(data, { swingLength: cfg.swingLength })) {
    const list = swingsByConfirm.get(s.confirmIndex) ?? [];
    list.push(s);
    swingsByConfirm.set(s.confirmIndex, list);
  }

  const zones: ZoneDraft[] = [];

  for (let i = 0; i < data.length; i++) {
    const bar = data[i]!;

    // 1) อัปเดตสถานะโซนที่มีอยู่ด้วยแท่ง i (โซนที่เกิดที่แท่ง i จะเริ่มเช็กแท่งถัดไป)
    for (const z of zones) {
      if (z.dead || z.createdIndex >= i) continue;
      const upBreak = (cfg.breakBy === 'close' ? bar.close : bar.high) > z.top;
      const downBreak = (cfg.breakBy === 'close' ? bar.close : bar.low) < z.bottom;
      if (z.role === 'resistance' && upBreak) {
        flip(z, 'support');
      } else if (z.role === 'support' && downBreak) {
        flip(z, 'resistance');
      } else if (z.state === 'fresh' && bar.high >= z.bottom && bar.low <= z.top) {
        z.state = 'tested';
      }
    }

    // 2) swing ที่ยืนยันที่แท่ง i → รวมเข้าโซนเดิมหรือเปิดโซนใหม่
    const a = atrs[i];
    const swings = swingsByConfirm.get(i);
    if (!swings || a == null) continue;
    for (const s of swings) {
      const eq = hasEqualBodiesAtPivot(data, s.pivotIndex, s.kind, cfg.equalTolAtr * a);
      const half = (cfg.zoneWidthAtr * a) / 2;
      const near = nearestZone(zones, s.price, cfg.zoneMergeAtr * a);
      if (near) {
        near.levels.push(s.price);
        near.center = near.levels.reduce((x, y) => x + y, 0) / near.levels.length;
        near.top = Math.max(near.top, s.price + half);
        near.bottom = Math.min(near.bottom, s.price - half);
        near.touches += 1;
        near.lastTouchIndex = s.pivotIndex;
        // swing ใหม่มาแตะโซนเดิม = ราคากลับมาทดสอบแล้ว
        if (near.state === 'fresh') near.state = 'tested';
        near.equalBodies ||= eq;
        if (near.origin !== s.kind) near.origin = 'both';
      } else {
        zones.push({
          id: `${s.kind[0]}${s.pivotIndex}`,
          top: s.price + half,
          bottom: s.price - half,
          center: s.price,
          role: s.kind === 'high' ? 'resistance' : 'support',
          origin: s.kind,
          state: 'fresh',
          touches: 1,
          equalBodies: eq,
          startTime: s.time,
          createdIndex: i,
          lastTouchIndex: s.pivotIndex,
          levels: [s.price],
          flips: 0,
          dead: false,
        });
      }
    }
  }

  const last = data.length - 1;
  const lastAtr = atrs[last] ?? 0;
  const alive = mergeOverlapping(
    zones.filter((z) => !z.dead && (!cfg.ryuMode || z.equalBodies)),
    cfg.zoneMergeAtr * lastAtr,
  );
  const scored = alive.map((z) => finalize(z, last));
  return pickBalanced(scored, data[last]!.close, cfg.maxZones).sort((x, y) => y.center - x.center);
}

/**
 * โซนบทบาทเดียวกันที่แถบซ้อนกันหรือห่างกันไม่เกิน `gap` (มักเกิดหลังกลับขั้ว) รวมเป็นโซนเดียวตอนแสดงผล
 * สถานะเลือกตัวที่ "แรง" กว่า: flipped > tested > fresh
 */
function mergeOverlapping(zones: ZoneDraft[], gap: number): ZoneDraft[] {
  const rank: Record<ZoneState, number> = { fresh: 0, tested: 1, flipped: 2 };
  const out: ZoneDraft[] = [];
  for (const z of [...zones].sort((a, b) => a.bottom - b.bottom)) {
    const prev = out.at(-1);
    if (prev && prev.role === z.role && z.bottom <= prev.top + gap) {
      prev.top = Math.max(prev.top, z.top);
      prev.levels.push(...z.levels);
      prev.center = prev.levels.reduce((x, y) => x + y, 0) / prev.levels.length;
      prev.touches += z.touches;
      prev.equalBodies ||= z.equalBodies;
      prev.lastTouchIndex = Math.max(prev.lastTouchIndex, z.lastTouchIndex);
      if (z.startTime < prev.startTime) prev.startTime = z.startTime;
      prev.createdIndex = Math.min(prev.createdIndex, z.createdIndex);
      if (rank[z.state] > rank[prev.state]) prev.state = z.state;
      // หลาย swing มารวมที่ระดับเดียวกัน = ราคาเคยกลับมาทดสอบแล้ว
      if (prev.state === 'fresh') prev.state = 'tested';
      if (prev.origin !== z.origin) prev.origin = 'both';
    } else {
      out.push({ ...z, levels: [...z.levels] });
    }
  }
  return out;
}

/**
 * เลือกโซนคะแนนสูงสุด แบ่งโควต้าให้ทั้งเหนือและใต้ราคาปัจจุบัน (ครึ่งละเท่าๆ กัน)
 * ฝั่งไหนมีไม่พอ ยกโควต้าให้อีกฝั่ง — กันไม่ให้โซนกระจุกอยู่ฝั่งเดียว
 */
function pickBalanced(zones: Zone[], price: number, max: number): Zone[] {
  const byScore = (a: Zone, b: Zone) => b.score - a.score;
  const above = zones.filter((z) => z.center >= price).sort(byScore);
  const below = zones.filter((z) => z.center < price).sort(byScore);
  let nAbove = Math.min(above.length, Math.ceil(max / 2));
  let nBelow = Math.min(below.length, max - nAbove);
  nAbove = Math.min(above.length, max - nBelow);
  nBelow = Math.min(below.length, max - nAbove);
  return [...above.slice(0, nAbove), ...below.slice(0, nBelow)];
}

function flip(z: ZoneDraft, to: ZoneRole) {
  z.flips += 1;
  if (z.flips >= 2) {
    z.dead = true;
    return;
  }
  z.role = to;
  z.state = 'flipped';
}

function nearestZone(zones: ZoneDraft[], price: number, maxDist: number): ZoneDraft | null {
  let best: ZoneDraft | null = null;
  let bestDist = Infinity;
  for (const z of zones) {
    if (z.dead) continue;
    const d = Math.abs(z.center - price);
    if (d <= maxDist && d < bestDist) {
      best = z;
      bestDist = d;
    }
  }
  return best;
}

function finalize(z: ZoneDraft, last: number): Zone {
  const recency = Math.pow(0.5, (last - z.lastTouchIndex) / RECENCY_HALF_LIFE_BARS);
  const score = z.touches + (z.state === 'flipped' ? 1 : 0) + (z.equalBodies ? 1 : 0) + 2 * recency;
  const label: Zone['label'] =
    z.state === 'flipped' ? (z.role === 'support' ? 'RBS' : 'SBR') : z.role === 'resistance' ? 'R' : 'S';
  return {
    id: z.id,
    top: z.top,
    bottom: z.bottom,
    center: z.center,
    role: z.role,
    origin: z.origin,
    state: z.state,
    label,
    touches: z.touches,
    equalBodies: z.equalBodies,
    startTime: z.startTime,
    createdIndex: z.createdIndex,
    lastTouchIndex: z.lastTouchIndex,
    score,
  };
}
