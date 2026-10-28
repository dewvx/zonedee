/**
 * การคำนวณดอกเบี้ยและต้นทุน Swap ข้ามคืน (Overnight Rollover Swap)
 * อ้างอิงตามมาตรฐาน MetaTrader 5 และบัญชี Forex/ทองคำ (เช่น XM)
 * - Rollover เกิดขึ้นเวลา 21:00 UTC (17:00 New York Close / 00:00 MT5 Server Time)
 * - คืนวันพุธ (Wednesday) คิด Swap 3 เท่า (Triple Swap) เพื่อชดเชยวันเสาร์-อาทิตย์ที่ตลาดปิด
 */

export interface SwapCalcInput {
  direction: 'long' | 'short';
  lots: number;
  entryTime?: number; // UTC ms
  exitTime?: number; // UTC ms
  /** จำนวนคืนคำนวณโดยตรง (ถ้าส่งมาจะไม่ต้องคำนวณจาก entryTime/exitTime) */
  effectiveNights?: number;
  nights?: number;
  swapLong: number;
  swapShort: number;
  swapMode?: 'points' | 'money' | 'percent' | 'disabled';
  /** วันที่คิด Swap 3 เท่า (1=จันทร์, 2=อังคาร, 3=พุธ, 4=พฤหัส, 5=ศุกร์ — ปกติคือ 3) */
  swap3Day?: number;
  digits?: number;
  point?: number;
  tickSize?: number;
  tickValue?: number;
  /** เวลาปิดแท่งวัน/Rollover (ชั่วโมง UTC, ค่าเริ่มต้น 21:00 UTC = 17:00 NY) */
  rolloverHourUtc?: number;
  /** ราคาอ้างอิง (กรณี swapMode เป็น percent) */
  price?: number;
}

export interface SwapCalcResult {
  /** จำนวนคืนตามปฏิทินที่ถือข้าม */
  nights: number;
  /** จำนวนคืนที่มีผลคำนวณ (รวมคูณ 3 ในคืนวันพุธ) */
  effectiveNights: number;
  /** อัตรา Swap ต่อ 1 คืนตามฝั่งการเทรด */
  swapRatePerNight: number;
  /** มูลค่า Swap รวมเป็นเงิน (สกุลเงินบัญชี, ลบ = ต้นทุน, บวก = ได้รับ) */
  costInMoney: number;
  /** มูลค่า Swap รวมในหน่วย points ของราคา */
  costInPoints: number;
}

/**
 * คำนวณจำนวนคืนที่ถือข้ามเวลา Rollover (21:00 UTC) พร้อมคำนวณ 3-Day Triple Swap
 */
export function calcOvernightNights(
  entryTimeMs: number,
  exitTimeMs: number,
  rolloverHourUtc = 21,
  tripleSwapDay = 3,
): { nights: number; effectiveNights: number } {
  if (exitTimeMs <= entryTimeMs) {
    return { nights: 0, effectiveNights: 0 };
  }

  // หาเวลา Rollover ครั้งแรกที่เกิดขึ้นหลัง entryTimeMs
  const entryDate = new Date(entryTimeMs);
  let nextRollover = Date.UTC(
    entryDate.getUTCFullYear(),
    entryDate.getUTCMonth(),
    entryDate.getUTCDate(),
    rolloverHourUtc,
    0,
    0,
    0,
  );

  // ถ้าเข้าหลังเวลา Rollover ของวันนั้น ให้ขยับไป Rollover ของวันถัดไป
  if (entryTimeMs >= nextRollover) {
    nextRollover += 24 * 3_600_000;
  }

  let nights = 0;
  let effectiveNights = 0;

  // วนลูปนับรอบ Rollover ทุกๆ 24 ชั่วโมงจนถึงเวลาออก
  while (nextRollover <= exitTimeMs) {
    const rolloverDate = new Date(nextRollover);
    const dayOfWeek = rolloverDate.getUTCDay(); // 0=อาทิตย์, 1=จันทร์, ..., 3=พุธ, ..., 6=เสาร์

    // ตลาดปิดวันเสาร์และอาทิตย์ จะไม่มี Rollover ในช่วงสุดสัปดาห์
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      nights += 1;
      if (dayOfWeek === tripleSwapDay) {
        effectiveNights += 3;
      } else {
        effectiveNights += 1;
      }
    }

    nextRollover += 24 * 3_600_000;
  }

  return { nights, effectiveNights };
}

/**
 * คำนวณมูลค่า Swap ทั้งในรูปตัวเงินและแต้มราคา (Points)
 */
export function calcSwapCost(input: SwapCalcInput): SwapCalcResult {
  const {
    direction,
    lots,
    entryTime,
    exitTime,
    swapLong,
    swapShort,
    swapMode = 'points',
    swap3Day = 3,
    digits = 2,
    point = 10 ** -digits,
    tickSize = point,
    tickValue = 1,
    rolloverHourUtc = 21,
    price = 1,
  } = input;

  if (swapMode === 'disabled' || lots <= 0) {
    return {
      nights: 0,
      effectiveNights: 0,
      swapRatePerNight: 0,
      costInMoney: 0,
      costInPoints: 0,
    };
  }

  let nights = 0;
  let effectiveNights = 0;

  if (input.effectiveNights !== undefined) {
    effectiveNights = Math.max(0, input.effectiveNights);
    nights = input.nights !== undefined ? Math.max(0, input.nights) : effectiveNights;
  } else if (entryTime !== undefined && exitTime !== undefined && exitTime > entryTime) {
    const res = calcOvernightNights(entryTime, exitTime, rolloverHourUtc, swap3Day);
    nights = res.nights;
    effectiveNights = res.effectiveNights;
  } else {
    return {
      nights: 0,
      effectiveNights: 0,
      swapRatePerNight: 0,
      costInMoney: 0,
      costInPoints: 0,
    };
  }

  const swapRate = direction === 'long' ? swapLong : swapShort;

  if (effectiveNights === 0 || swapRate === 0) {
    return {
      nights,
      effectiveNights,
      swapRatePerNight: swapRate,
      costInMoney: 0,
      costInPoints: 0,
    };
  }

  let costInMoney = 0;
  let costInPoints = 0;

  // มูลค่าของ 1 point สำหรับ 1 lot (สกุลเงินบัญชี)
  const pointValuePerLot = tickSize > 0 ? (point / tickSize) * tickValue : tickValue;

  if (swapMode === 'points') {
    costInPoints = swapRate * effectiveNights;
    costInMoney = costInPoints * pointValuePerLot * lots;
  } else if (swapMode === 'money') {
    costInMoney = swapRate * effectiveNights * lots;
    costInPoints = pointValuePerLot > 0 && lots > 0 ? costInMoney / (pointValuePerLot * lots) : 0;
  } else if (swapMode === 'percent') {
    // อัตราดอกเบี้ยต่อปี / 360 วัน
    const dailyRate = (swapRate / 100) / 360;
    costInMoney = price * lots * dailyRate * effectiveNights;
    costInPoints = pointValuePerLot > 0 && lots > 0 ? costInMoney / (pointValuePerLot * lots) : 0;
  }

  return {
    nights,
    effectiveNights,
    swapRatePerNight: swapRate,
    costInMoney,
    costInPoints,
  };
}
