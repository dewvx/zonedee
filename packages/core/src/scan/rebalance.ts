/**
 * คำนวณการปรับพอร์ตให้กลับเข้าสัดส่วนเป้าหมาย — ตัวเลขช่วยคิด ไม่ได้ส่งคำสั่งซื้อขาย
 *
 * โหมด DCA (ค่าเริ่มต้น): ซื้ออย่างเดียวด้วยเงินก้อนนี้ ใส่ตัวที่ต่ำกว่าเป้ามากที่สุดก่อน
 *   เป้าหลังเติม = เป้า% × (มูลค่ารวม + เงินก้อนนี้) · ตัวที่ขาด = เป้าหลังเติม − มูลค่าตอนนี้
 *   ผลรวมส่วนที่ขาด ≥ เงินก้อนนี้เสมอ → เฉลี่ยตามสัดส่วนที่ขาด
 * โหมดปรับเต็ม (allowSell): ซื้อ/ขายให้ตรงเป้าพอดี
 */
export interface RebalanceItem {
  symbol: string;
  /** มูลค่าที่ถืออยู่ตอนนี้ (USD) */
  value: number;
  /** ราคาล่าสุด (ไว้คิดจำนวนหุ้น) */
  price: number;
  /** สัดส่วนเป้าหมาย % — null = ไม่ร่วมคำนวณ */
  targetPct: number | null;
}

export interface RebalanceRow {
  symbol: string;
  value: number;
  currentPct: number;
  /** เป้าหลัง normalize ให้รวมได้ 100 */
  targetPct: number;
  /** มูลค่าเป้าหมายหลังเติมเงิน */
  targetValue: number;
  /** + = ซื้อ · − = ขาย (USD) */
  trade: number;
  /** จำนวนหุ้น (เศษได้ — Dime ซื้อเศษหุ้นได้) */
  shares: number;
  afterPct: number;
}

export interface RebalanceResult {
  rows: RebalanceRow[];
  totalBefore: number;
  totalAfter: number;
  /** ผลรวมเป้าที่ผู้ใช้กรอก (ถ้าไม่ใช่ 100 จะถูก normalize) */
  targetSum: number;
}

export function rebalance(
  items: readonly RebalanceItem[],
  opts: { budget: number; allowSell?: boolean },
): RebalanceResult | null {
  const pool = items.filter((i) => i.targetPct !== null && i.targetPct > 0);
  const targetSum = pool.reduce((a, i) => a + i.targetPct!, 0);
  if (pool.length === 0 || targetSum <= 0) return null;
  const budget = Math.max(0, opts.budget);
  const totalBefore = pool.reduce((a, i) => a + Math.max(0, i.value), 0);
  const totalAfter = totalBefore + budget;

  const base = pool.map((i) => {
    const t = i.targetPct! / targetSum;
    const targetValue = t * totalAfter;
    return { i, t, targetValue, gap: targetValue - Math.max(0, i.value) };
  });

  let trades: number[];
  if (opts.allowSell) {
    trades = base.map((b) => b.gap);
  } else {
    const short = base.reduce((a, b) => a + Math.max(0, b.gap), 0);
    const k = short > 0 ? budget / short : 0;
    trades = base.map((b) => Math.max(0, b.gap) * k);
  }

  const rows: RebalanceRow[] = base.map((b, idx) => {
    const trade = trades[idx]!;
    const value = Math.max(0, b.i.value);
    return {
      symbol: b.i.symbol,
      value,
      currentPct: totalBefore > 0 ? (value / totalBefore) * 100 : 0,
      targetPct: b.t * 100,
      targetValue: b.targetValue,
      trade,
      shares: b.i.price > 0 ? trade / b.i.price : 0,
      afterPct: totalAfter > 0 ? ((value + trade) / totalAfter) * 100 : 0,
    };
  });
  return { rows, totalBefore, totalAfter, targetSum };
}
