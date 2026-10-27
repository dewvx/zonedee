/**
 * ฟังก์ชันช่วยสร้างและคิดผลคำนวณปฏิทินบันทึกการเทรด (Trade Calendar)
 * คิดคำนวณตามเวลาไทย (Asia/Bangkok: UTC+7)
 */

export interface TradeCalendarItem {
  id: number;
  entryTime: number | null;
  createdAt: number;
  status: string;
  r: number | null;
  pnl: number | null;
  followedPlan?: boolean | null;
}

export interface CalendarDay<T extends TradeCalendarItem> {
  dateKey: string; // 'YYYY-MM-DD'
  dayNum: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
  dayOfWeek: number; // 0 = Mon, ..., 6 = Sun
  trades: T[];
  tradesCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  totalR: number;
  totalPnl: number;
}

export interface CalendarWeekSummary<T extends TradeCalendarItem> {
  weekIndex: number;
  trades: T[];
  tradesCount: number;
  closedCount: number;
  wins: number;
  losses: number;
  totalR: number;
  totalPnl: number;
  winRate: number | null;
}

export interface CalendarWeek<T extends TradeCalendarItem> {
  weekIndex: number;
  days: CalendarDay<T>[];
  summary: CalendarWeekSummary<T>;
}

export interface MonthCalendarSummary {
  year: number;
  month: number;
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  winRate: number | null; // 0..1 fraction
  totalR: number;
  avgR: number;
  totalPnl: number;
  followedPlanCount: number;
  judgedCount: number;
  followRate: number | null;
}

export interface MonthCalendarResult<T extends TradeCalendarItem> {
  year: number;
  month: number;
  weeks: CalendarWeek<T>[];
  summary: MonthCalendarSummary;
  tradesByDate: Map<string, T[]>;
}

const THAI_TZ_OFFSET_MS = 7 * 3_600_000;

/** แปลง UTC ms เป็นคีย์วันที่เวลาไทย เช่น '2026-10-27' */
export function getThaiDateKey(ms: number): string {
  const d = new Date(ms + THAI_TZ_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

export const THAI_MONTH_NAMES = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

export const THAI_DAY_NAMES = [
  'จันทร์',
  'อังคาร',
  'พุธ',
  'พฤหัสบดี',
  'ศุกร์',
  'เสาร์',
  'อาทิตย์',
] as const;

export const THAI_DAY_NAMES_SHORT = [
  'จ.',
  'อ.',
  'พ.',
  'พฤ.',
  'ศ.',
  'ส.',
  'อา.',
] as const;

/**
 * สร้างข้อมูลตารางปฏิทินรายเดือน พร้อมผลรวม R และ Win Rate ประจำวัน สัปดาห์ และเดือน
 * @param trades รายการเทรดทั้งหมด
 * @param year ปี ค.ศ. (เช่น 2026)
 * @param month เดือน 1..12 (1 = มกราคม, 12 = ธันวาคม)
 */
export function buildMonthCalendar<T extends TradeCalendarItem>(
  trades: readonly T[],
  year: number,
  month: number,
): MonthCalendarResult<T> {
  // 1. จัดกลุ่มไม้ตามวันเวลาไทย
  const tradesByDate = new Map<string, T[]>();
  for (const t of trades) {
    const key = getThaiDateKey(t.entryTime ?? t.createdAt);
    const arr = tradesByDate.get(key) ?? [];
    arr.push(t);
    tradesByDate.set(key, arr);
  }

  // 2. คำนวณวันแรกของเดือนและจำนวนวัน
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  // getUTCDay(): 0=อาทิตย์, 1=จันทร์, ..., 6=เสาร์
  // แปลงให้จันทร์เป็น 0: (day + 6) % 7
  const leadDays = (firstDay.getUTCDay() + 6) % 7;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysInPrevMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();

  const totalDays = Math.ceil((leadDays + daysInMonth) / 7) * 7;
  const numWeeks = totalDays / 7;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const allDays: CalendarDay<T>[] = [];

  for (let i = 0; i < totalDays; i++) {
    let dayNum: number;
    let cellMonth: number;
    let cellYear: number;
    let isCurrentMonth: boolean;

    if (i < leadDays) {
      dayNum = daysInPrevMonth - leadDays + i + 1;
      cellMonth = prevMonth;
      cellYear = prevYear;
      isCurrentMonth = false;
    } else if (i < leadDays + daysInMonth) {
      dayNum = i - leadDays + 1;
      cellMonth = month;
      cellYear = year;
      isCurrentMonth = true;
    } else {
      dayNum = i - (leadDays + daysInMonth) + 1;
      cellMonth = nextMonth;
      cellYear = nextYear;
      isCurrentMonth = false;
    }

    const dateKey = `${cellYear}-${String(cellMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayOfWeek = i % 7;
    const dayTrades = tradesByDate.get(dateKey) ?? [];

    const closedTrades = dayTrades.filter((t) => t.status === 'closed' && t.r !== null);
    const wins = closedTrades.filter((t) => (t.r ?? 0) > 0).length;
    const losses = closedTrades.filter((t) => (t.r ?? 0) < 0).length;
    const totalR = closedTrades.reduce((acc, t) => acc + (t.r ?? 0), 0);
    const totalPnl = dayTrades.reduce((acc, t) => acc + (t.status === 'closed' ? (t.pnl ?? 0) : 0), 0);

    allDays.push({
      dateKey,
      dayNum,
      month: cellMonth,
      year: cellYear,
      isCurrentMonth,
      dayOfWeek,
      trades: dayTrades,
      tradesCount: dayTrades.length,
      closedCount: closedTrades.length,
      wins,
      losses,
      totalR,
      totalPnl,
    });
  }

  // 3. จัดกลุ่มเป็นสัปดาห์ละ 7 วัน พร้อมสรุปประจำสัปดาห์
  const weeks: CalendarWeek<T>[] = [];
  for (let w = 0; w < numWeeks; w++) {
    const weekDays = allDays.slice(w * 7, (w + 1) * 7);
    const weekTrades = weekDays.flatMap((d) => d.trades);
    const closedWeek = weekTrades.filter((t) => t.status === 'closed' && t.r !== null);
    const wins = closedWeek.filter((t) => (t.r ?? 0) > 0).length;
    const losses = closedWeek.filter((t) => (t.r ?? 0) < 0).length;
    const totalR = closedWeek.reduce((acc, t) => acc + (t.r ?? 0), 0);
    const totalPnl = weekTrades.reduce((acc, t) => acc + (t.status === 'closed' ? (t.pnl ?? 0) : 0), 0);
    const winRate = closedWeek.length > 0 ? wins / closedWeek.length : null;

    weeks.push({
      weekIndex: w,
      days: weekDays,
      summary: {
        weekIndex: w,
        trades: weekTrades,
        tradesCount: weekTrades.length,
        closedCount: closedWeek.length,
        wins,
        losses,
        totalR,
        totalPnl,
        winRate,
      },
    });
  }

  // 4. สรุปภาพรวมประจำเดือน (เฉพาะไม้ที่อยู่ในเดือนที่เลือก)
  const monthKeyPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthTrades: T[] = [];
  for (const [k, list] of tradesByDate.entries()) {
    if (k.startsWith(monthKeyPrefix)) {
      monthTrades.push(...list);
    }
  }

  const closedMonth = monthTrades.filter((t) => t.status === 'closed' && t.r !== null);
  const monthWins = closedMonth.filter((t) => (t.r ?? 0) > 0).length;
  const monthLosses = closedMonth.filter((t) => (t.r ?? 0) < 0).length;
  const monthTotalR = closedMonth.reduce((acc, t) => acc + (t.r ?? 0), 0);
  const monthAvgR = closedMonth.length > 0 ? monthTotalR / closedMonth.length : 0;
  const monthTotalPnl = monthTrades.reduce((acc, t) => acc + (t.status === 'closed' ? (t.pnl ?? 0) : 0), 0);
  const monthWinRate = closedMonth.length > 0 ? monthWins / closedMonth.length : null;

  const judged = monthTrades.filter((t) => t.followedPlan !== null && t.followedPlan !== undefined);
  const followed = judged.filter((t) => t.followedPlan === true).length;
  const followRate = judged.length > 0 ? followed / judged.length : null;

  return {
    year,
    month,
    weeks,
    summary: {
      year,
      month,
      totalTrades: monthTrades.length,
      closedTrades: closedMonth.length,
      openTrades: monthTrades.filter((t) => t.status !== 'closed').length,
      wins: monthWins,
      losses: monthLosses,
      winRate: monthWinRate,
      totalR: monthTotalR,
      avgR: monthAvgR,
      totalPnl: monthTotalPnl,
      followedPlanCount: followed,
      judgedCount: judged.length,
      followRate,
    },
    tradesByDate,
  };
}
