/**
 * เครื่องคิดขนาดไม้ / R:R / margin (docs/rules.md: Money Management ของ Braron)
 * lot = เงินที่ยอมเสีย ÷ (ระยะ SL × มูลค่าต่อ tick ต่อ 1 lot)
 */

export interface ContractSpec {
  symbol: string;
  /** หน่วยต่อ 1 lot เช่น EURUSD 100,000 · ทอง (XM) 100 oz · หุ้น 1 */
  contractSize: number;
  /** ราคาขยับได้ทีละเท่าไร */
  tickSize: number;
  /** มูลค่า (สกุลเงินบัญชี) เมื่อราคาขยับ 1 tick สำหรับ 1 lot */
  tickValue: number;
  volumeMin: number;
  volumeStep: number;
  volumeMax: number;
  /** จำนวนทศนิยมของราคา — 1 point = 10^-digits (หน่วยเดียวกับ "points" ใน MT5) */
  digits: number;
  /** quote = margin คิดจากราคา (XXXUSD, ทอง) · base = สกุลหลักคือสกุลบัญชี (USDJPY) */
  marginMode: 'quote' | 'base';
  unit: 'lot' | 'share';
}

export interface PositionInput {
  spec: ContractSpec;
  /** ยอดเงินในบัญชี (สกุลเงินบัญชี) */
  balance: number;
  /** เสี่ยงกี่ % ของยอดเงินต่อไม้ (Braron: 1–2%) */
  riskPct: number;
  entry: number;
  sl: number;
  tp?: number;
  /** spread เป็น points — นับเข้าความเสี่ยง */
  spreadPoints?: number;
  /** leverage เช่น 1000 (XM) · หุ้น = 1 · ไม่ใส่ = ไม่คำนวณ margin */
  leverage?: number;
  /** R:R ขั้นต่ำ (Braron: 1:2) */
  minRR?: number;
}

export interface PositionResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  direction: 'long' | 'short';
  riskAmount: number;
  slDistance: number;
  slPoints: number;
  /** pips (เฉพาะคู่เงินราคา 3/5 ทศนิยม) */
  slPips: number | null;
  /** ขาดทุนต่อ 1 lot ถ้าโดน SL (รวม spread) */
  lossPerLot: number;
  /** lot ที่ควรเปิด (ปัดลงตาม step) — 0 ถ้าต่ำกว่า lot ขั้นต่ำ */
  lots: number;
  actualRisk: number;
  actualRiskPct: number;
  /** ความเสี่ยงถ้าเปิด lot ขั้นต่ำ (ไว้บอกตอน lots = 0) */
  minLotRisk: number;
  tpDistance: number | null;
  rr: number | null;
  profit: number | null;
  margin: number | null;
}

/** ปัดลงให้เป็นทวีคูณของ step (กันทศนิยมเพี้ยน) */
export function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return Number((Math.floor(value / step + 1e-9) * step).toFixed(decimals));
}

export function calcPosition(input: PositionInput): PositionResult {
  const { spec, balance, riskPct, entry, sl, tp, spreadPoints = 0, leverage, minRR = 2 } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const point = 10 ** -spec.digits;
  const direction: PositionResult['direction'] = sl < entry ? 'long' : 'short';

  if (!(entry > 0) || !(sl > 0)) errors.push('ใส่ราคา Entry และ SL ให้ครบ');
  if (entry === sl) errors.push('SL ต้องไม่เท่ากับ Entry');
  if (!(balance > 0)) errors.push('ใส่ยอดเงินในบัญชี');
  if (!(riskPct > 0)) errors.push('ใส่ % ความเสี่ยง');
  if (tp !== undefined && tp > 0) {
    if (direction === 'long' && tp <= entry) errors.push('Buy: TP ต้องอยู่เหนือ Entry');
    if (direction === 'short' && tp >= entry) errors.push('Sell: TP ต้องอยู่ใต้ Entry');
  }

  const riskAmount = (balance * riskPct) / 100;
  const slDistance = Math.abs(entry - sl);
  const slPoints = Math.round(slDistance / point);
  const slPips = spec.digits === 3 || spec.digits === 5 ? slDistance / (point * 10) : null;
  const ticks = slDistance / spec.tickSize + (spreadPoints * point) / spec.tickSize;
  const lossPerLot = ticks * spec.tickValue;

  const raw = lossPerLot > 0 ? riskAmount / lossPerLot : 0;
  let lots = Math.min(roundToStep(raw, spec.volumeStep), spec.volumeMax);
  const minLotRisk = spec.volumeMin * lossPerLot;
  const unitName = spec.unit === 'lot' ? 'lot' : 'หุ้น';
  if (errors.length === 0 && lots < spec.volumeMin) {
    lots = 0;
    warnings.push(
      `ต่ำกว่า ${unitName} ขั้นต่ำ (${spec.volumeMin}) — ถ้าเปิดขั้นต่ำจะเสี่ยง ${minLotRisk.toFixed(2)} (${((minLotRisk / balance) * 100).toFixed(2)}%) ลองขยับ SL ให้แคบลงหรือข้ามไม้นี้`,
    );
  }
  if (lots === spec.volumeMax && raw > spec.volumeMax) warnings.push(`ชนเพดาน ${unitName} สูงสุดของโบรก (${spec.volumeMax})`);

  const actualRisk = lots * lossPerLot;
  const tpDistance = tp !== undefined && tp > 0 ? Math.abs(tp - entry) : null;
  const rr = tpDistance !== null && slDistance > 0 ? tpDistance / slDistance : null;
  const profit = tpDistance !== null ? lots * (tpDistance / spec.tickSize) * spec.tickValue : null;
  const margin =
    leverage && leverage > 0
      ? spec.marginMode === 'quote'
        ? (lots * spec.contractSize * entry) / leverage
        : (lots * spec.contractSize) / leverage
      : null;

  if (riskPct > 2) warnings.push(`เสี่ยง ${riskPct}% ต่อไม้ — Braron แนะนำ 1–2%`);
  if (rr !== null && errors.length === 0 && rr < minRR) warnings.push(`R:R 1:${rr.toFixed(2)} ต่ำกว่าขั้นต่ำ 1:${minRR}`);
  if (margin !== null && margin > balance) warnings.push('margin ที่ต้องใช้มากกว่ายอดเงินในบัญชี');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    direction,
    riskAmount,
    slDistance,
    slPoints,
    slPips,
    lossPerLot,
    lots,
    actualRisk,
    actualRiskPct: balance > 0 ? (actualRisk / balance) * 100 : 0,
    minLotRisk,
    tpDistance,
    rr,
    profit,
    margin,
  };
}
