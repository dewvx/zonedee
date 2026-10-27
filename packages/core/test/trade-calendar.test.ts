import { describe, expect, it } from 'vitest';
import {
  buildMonthCalendar,
  getThaiDateKey,
  THAI_DAY_NAMES,
  THAI_MONTH_NAMES,
  type TradeCalendarItem,
} from '../src/journal/calendar';

describe('Trade Calendar (ปฏิทินบันทึกการเทรด)', () => {
  it('getThaiDateKey แปลงเวลา UTC ms เป็นวันที่ไทย (UTC+7) ถูกต้อง', () => {
    // 2026-10-27 10:00:00 UTC -> 17:00:00 เวลาไทย -> '2026-10-27'
    const ms1 = Date.parse('2026-10-27T10:00:00Z');
    expect(getThaiDateKey(ms1)).toBe('2026-10-27');

    // 2026-10-27 20:00:00 UTC -> 03:00:00 ของวันที่ 28 ต.ค. เวลาไทย -> '2026-10-28'
    const ms2 = Date.parse('2026-10-27T20:00:00Z');
    expect(getThaiDateKey(ms2)).toBe('2026-10-28');
  });

  it('buildMonthCalendar สร้างตารางเดือนที่มีวันจันทร์เป็นวันแรกของสัปดาห์', () => {
    // ตุลาคม 2026: 1 ต.ค. 2026 เป็นวันพฤหัสบดี
    // วันจันทร์-พุธ แรกของตารางต้องเป็น 28, 29, 30 ก.ย. 2026 (isCurrentMonth: false)
    const res = buildMonthCalendar([], 2026, 10);
    expect(res.year).toBe(2026);
    expect(res.month).toBe(10);
    expect(res.weeks.length).toBe(5);

    const firstWeek = res.weeks[0]!;
    expect(firstWeek.days.length).toBe(7);

    // วันจันทร์ (0)
    expect(firstWeek.days[0]!.dayOfWeek).toBe(0);
    expect(firstWeek.days[0]!.dayNum).toBe(28);
    expect(firstWeek.days[0]!.month).toBe(9);
    expect(firstWeek.days[0]!.isCurrentMonth).toBe(false);

    // วันพฤหัสบดี (3) -> 1 ต.ค. 2026
    expect(firstWeek.days[3]!.dayOfWeek).toBe(3);
    expect(firstWeek.days[3]!.dayNum).toBe(1);
    expect(firstWeek.days[3]!.month).toBe(10);
    expect(firstWeek.days[3]!.isCurrentMonth).toBe(true);

    // สัปดาห์สุดท้าย (week 5): 31 ต.ค. เป็นวันเสาร์, 1 พ.ย. เป็นวันอาทิตย์ (isCurrentMonth: false)
    const lastWeek = res.weeks[4]!;
    expect(lastWeek.days[5]!.dayNum).toBe(31);
    expect(lastWeek.days[5]!.isCurrentMonth).toBe(true);
    expect(lastWeek.days[6]!.dayNum).toBe(1);
    expect(lastWeek.days[6]!.month).toBe(11);
    expect(lastWeek.days[6]!.isCurrentMonth).toBe(false);
  });

  it('รวมผล R รายวัน สัปดาห์ และเดือน ได้อย่างแม่นยำ', () => {
    const mockTrades: TradeCalendarItem[] = [
      // วันที่ 1 ต.ค. 2026: ชนะ 1 ไม้ (+2.5R, +$250)
      {
        id: 1,
        entryTime: Date.parse('2026-10-01T04:00:00Z'), // 11:00 ไทย
        createdAt: Date.parse('2026-10-01T04:00:00Z'),
        status: 'closed',
        r: 2.5,
        pnl: 250,
        followedPlan: true,
      },
      // วันที่ 1 ต.ค. 2026: แพ้ 1 ไม้ (-1.0R, -$100)
      {
        id: 2,
        entryTime: Date.parse('2026-10-01T08:00:00Z'), // 15:00 ไทย
        createdAt: Date.parse('2026-10-01T08:00:00Z'),
        status: 'closed',
        r: -1.0,
        pnl: -100,
        followedPlan: true,
      },
      // วันที่ 5 ต.ค. 2026 (สัปดาห์ที่ 2): ชนะ 1 ไม้ (+1.5R, +$150)
      {
        id: 3,
        entryTime: Date.parse('2026-10-05T07:00:00Z'), // 14:00 ไทย
        createdAt: Date.parse('2026-10-05T07:00:00Z'),
        status: 'closed',
        r: 1.5,
        pnl: 150,
        followedPlan: false,
      },
      // ไม้ที่ยังเปิดอยู่ (open)
      {
        id: 4,
        entryTime: Date.parse('2026-10-05T09:00:00Z'),
        createdAt: Date.parse('2026-10-05T09:00:00Z'),
        status: 'open',
        r: null,
        pnl: null,
        followedPlan: null,
      },
      // ไม้ของเดือนก่อน (30 ก.ย. 2026): ไม่ควรถูกคิดในยอดสรุปเดือน 10
      {
        id: 5,
        entryTime: Date.parse('2026-09-30T04:00:00Z'),
        createdAt: Date.parse('2026-09-30T04:00:00Z'),
        status: 'closed',
        r: 3.0,
        pnl: 300,
        followedPlan: true,
      },
    ];

    const res = buildMonthCalendar(mockTrades, 2026, 10);

    // 1. ตรวจสอบวันแรก 1 ต.ค. 2026
    const day1 = res.weeks[0]!.days[3]!;
    expect(day1.dateKey).toBe('2026-10-01');
    expect(day1.tradesCount).toBe(2);
    expect(day1.closedCount).toBe(2);
    expect(day1.wins).toBe(1);
    expect(day1.losses).toBe(1);
    expect(day1.totalR).toBe(1.5); // +2.5 - 1.0 = +1.5R
    expect(day1.totalPnl).toBe(150);

    // 2. ตรวจสอบสัปดาห์แรก (week 0)
    // มี 30 ก.ย. (+3.0R) และ 1 ต.ค. (+1.5R) ในสัปดาห์ปฏิทินนี้
    const week0 = res.weeks[0]!.summary;
    expect(week0.tradesCount).toBe(3);
    expect(week0.totalR).toBe(4.5);
    expect(week0.wins).toBe(2);

    // 3. ตรวจสอบสัปดาห์ที่สอง (week 1)
    const week1 = res.weeks[1]!.summary;
    expect(week1.tradesCount).toBe(2);
    expect(week1.closedCount).toBe(1);
    expect(week1.wins).toBe(1);
    expect(week1.totalR).toBe(1.5);

    // 4. ตรวจสอบยอดสรุปทั้งเดือน 10
    // มี id 1, 2, 3, 4 (ไม่รวม id 5 ที่เป็นเดือน 9)
    const summary = res.summary;
    expect(summary.totalTrades).toBe(4);
    expect(summary.closedTrades).toBe(3);
    expect(summary.openTrades).toBe(1);
    expect(summary.wins).toBe(2);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBeCloseTo(2 / 3);
    expect(summary.totalR).toBe(3.0); // +2.5 - 1.0 + 1.5 = +3.0R
    expect(summary.avgR).toBe(1.0); // +3.0 / 3 = 1.0R
    expect(summary.totalPnl).toBe(300); // 250 - 100 + 150 = 300
    expect(summary.followedPlanCount).toBe(2);
    expect(summary.judgedCount).toBe(3);
    expect(summary.followRate).toBeCloseTo(2 / 3);
  });

  it('ค่าคงที่ชื่อเดือนและวันภาษาไทยครบถ้วน', () => {
    expect(THAI_MONTH_NAMES.length).toBe(12);
    expect(THAI_MONTH_NAMES[9]).toBe('ตุลาคม');
    expect(THAI_DAY_NAMES.length).toBe(7);
    expect(THAI_DAY_NAMES[0]).toBe('จันทร์');
  });
});
