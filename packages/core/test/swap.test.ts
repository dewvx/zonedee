import { describe, expect, it } from 'vitest';
import { calcOvernightNights, calcSwapCost } from '../src/risk/swap';

describe('Overnight Swap Calculation (การคำนวณ Swap ข้ามคืน)', () => {
  it('ไม้ที่ปิดภายในวันเดียวกัน (Intraday ไม่ข้าม 21:00 UTC) ต้องไม่มี Swap', () => {
    // วันจันทร์ เวลา 08:00 UTC ถึง 16:00 UTC
    const mondayOpen = Date.UTC(2026, 9, 12, 8, 0, 0); // 12 Oct 2026 is Monday
    const mondayClose = Date.UTC(2026, 9, 12, 16, 0, 0);

    const { nights, effectiveNights } = calcOvernightNights(mondayOpen, mondayClose);
    expect(nights).toBe(0);
    expect(effectiveNights).toBe(0);

    const swap = calcSwapCost({
      direction: 'long',
      lots: 0.1,
      entryTime: mondayOpen,
      exitTime: mondayClose,
      swapLong: -28.5,
      swapShort: 14.2,
    });
    expect(swap.costInMoney).toBe(0);
    expect(swap.costInPoints).toBe(0);
  });

  it('ถือข้ามคืนวันธรรมดา (จันทร์ → อังคาร) คิด Swap 1 คืนปกติ', () => {
    // วันจันทร์ 14:00 UTC ถึงวันอังคาร 10:00 UTC (ข้าม 21:00 UTC วันจันทร์)
    const mon = Date.UTC(2026, 9, 12, 14, 0, 0);
    const tue = Date.UTC(2026, 9, 13, 10, 0, 0);

    const { nights, effectiveNights } = calcOvernightNights(mon, tue);
    expect(nights).toBe(1);
    expect(effectiveNights).toBe(1);

    const swap = calcSwapCost({
      direction: 'long',
      lots: 1.0,
      entryTime: mon,
      exitTime: tue,
      swapLong: -25.0,
      swapShort: 10.0,
      digits: 2,
      tickSize: 0.01,
      tickValue: 1.0,
    });
    expect(swap.effectiveNights).toBe(1);
    expect(swap.costInPoints).toBe(-25.0);
    expect(swap.costInMoney).toBe(-25.0);
  });

  it('ถือข้ามคืนวันพุธ (Wednesday Rollover) ต้องคิด 3-Day Triple Swap', () => {
    // วันพุธ 15:00 UTC ถึงวันพฤหัสบดี 09:00 UTC (14 Oct 2026 is Wednesday)
    const wed = Date.UTC(2026, 9, 14, 15, 0, 0);
    const thu = Date.UTC(2026, 9, 15, 9, 0, 0);

    const { nights, effectiveNights } = calcOvernightNights(wed, thu);
    expect(nights).toBe(1);
    expect(effectiveNights).toBe(3); // 3 เท่าสำหรับวันเสาร์-อาทิตย์

    // ทดสอบคำนวณเงิน: Long ทอง 0.02 lot, swap -20 points
    const swap = calcSwapCost({
      direction: 'long',
      lots: 0.02,
      entryTime: wed,
      exitTime: thu,
      swapLong: -20.0,
      swapShort: 8.0,
      digits: 2,
      tickSize: 0.01,
      tickValue: 1.0,
    });
    // 3 nights * (-20 points) = -60 points
    expect(swap.costInPoints).toBe(-60.0);
    // 1 point = $1.00 per 1 lot -> -60 * 1 * 0.02 = -$1.20
    expect(swap.costInMoney).toBeCloseTo(-1.20);
  });

  it('ถือข้ามสัปดาห์ (อังคาร → ศุกร์) รวมได้ 5 effective nights (Tue 1 + Wed 3 + Thu 1)', () => {
    const tue = Date.UTC(2026, 9, 13, 10, 0, 0);
    const fri = Date.UTC(2026, 9, 16, 10, 0, 0);

    const { nights, effectiveNights } = calcOvernightNights(tue, fri);
    expect(nights).toBe(3);
    expect(effectiveNights).toBe(5); // Tue (1) + Wed (3) + Thu (1) = 5
  });

  it('Swap เป็นบวก (Positive Swap) เพิ่มกำไรให้ยอดเงินและแต้ม', () => {
    // Short ทอง วันพุธ → พฤหัสบดี ได้รับดอกเบี้ยบวก (+15 points)
    const wed = Date.UTC(2026, 9, 14, 15, 0, 0);
    const thu = Date.UTC(2026, 9, 15, 9, 0, 0);

    const swap = calcSwapCost({
      direction: 'short',
      lots: 0.1,
      entryTime: wed,
      exitTime: thu,
      swapLong: -25.0,
      swapShort: 15.0,
      digits: 2,
      tickSize: 0.01,
      tickValue: 1.0,
    });
    expect(swap.effectiveNights).toBe(3);
    expect(swap.costInPoints).toBe(45.0); // 15 * 3
    expect(swap.costInMoney).toBeCloseTo(4.50); // 45 * 1 * 0.1
  });
});
