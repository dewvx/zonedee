import { useMemo, useState } from 'react';
import {
  buildMonthCalendar,
  getThaiDateKey,
  THAI_DAY_NAMES,
  THAI_DAY_NAMES_SHORT,
  THAI_MONTH_NAMES,
} from '@zonedee/core';
import type { JournalEntry, JournalStatus, StrategyInfo } from '../api';
import { Icon } from './Icon';
import { Empty, Stat } from './ui';
import { fmtPct, fmtR, formatThaiTime } from '../format';

interface JournalCalendarProps {
  entries: JournalEntry[];
  strategies: StrategyInfo[];
  onSelectTrade: (id: number) => void;
  onPreviewTrade?: (entry: JournalEntry) => void;
  onNewTrade?: () => void;
  onViewImage?: (name: string) => void;
}

const STATUS_LABEL: Record<JournalStatus, string> = {
  plan: 'แผน',
  open: 'ถืออยู่',
  closed: 'ปิดแล้ว',
  cancelled: 'ไม่ได้เข้า',
};

const STATUS_CLS: Record<JournalStatus, string> = {
  plan: 'bg-hover text-fg-2',
  open: 'bg-accent/15 text-accent',
  closed: 'bg-ok/12 text-ok',
  cancelled: 'bg-hover text-faint',
};

export function JournalCalendar({
  entries,
  strategies,
  onSelectTrade,
  onPreviewTrade,
  onNewTrade,
  onViewImage,
}: JournalCalendarProps) {
  // วันนี้ในเวลาไทย
  const todayKey = useMemo(() => getThaiDateKey(Date.now()), []);
  const [todayYear, todayMonth] = useMemo(() => {
    const parts = todayKey.split('-').map(Number);
    return [parts[0] ?? new Date().getFullYear(), parts[1] ?? (new Date().getMonth() + 1)];
  }, [todayKey]);

  const [year, setYear] = useState<number>(todayYear);
  const [month, setMonth] = useState<number>(todayMonth);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<JournalStatus | 'all'>('all');

  // เลื่อนเดือน
  const prevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const goToday = () => {
    setYear(todayYear);
    setMonth(todayMonth);
    setSelectedDateKey(todayKey);
  };

  // กรอง symbol / status ก่อนส่งให้ calendar คำนวณ
  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (symbolFilter !== 'all' && e.symbol !== symbolFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      return true;
    });
  }, [entries, symbolFilter, statusFilter]);

  // สร้างโครงสร้างปฏิทิน
  const calendar = useMemo(() => {
    return buildMonthCalendar(filteredEntries, year, month);
  }, [filteredEntries, year, month]);

  const symbolsInJournal = useMemo(() => [...new Set(entries.map((e) => e.symbol))], [entries]);
  const strategyName = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;

  // รายการเทรดที่จะแสดงด้านล่าง
  const displayedTrades = useMemo(() => {
    if (selectedDateKey) {
      return calendar.tradesByDate.get(selectedDateKey) ?? [];
    }
    // ถ้าไม่ได้เลือกวัน ให้แสดงไม้ทั้งหมดของเดือนที่กำลังดูอยู่
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return filteredEntries.filter((e) => getThaiDateKey(e.entryTime ?? e.createdAt).startsWith(prefix));
  }, [selectedDateKey, calendar.tradesByDate, filteredEntries, year, month]);

  // รายละเอียดวันที่กำลังเลือก
  const selectedDayInfo = useMemo(() => {
    if (!selectedDateKey) return null;
    const parts = selectedDateKey.split('-').map(Number);
    const pYear = parts[0] ?? year;
    const pMonth = parts[1] ?? month;
    const pDay = parts[2] ?? 1;
    const dateObj = new Date(Date.UTC(pYear, pMonth - 1, pDay));
    const dayOfWeek = (dateObj.getUTCDay() + 6) % 7;
    const trades = calendar.tradesByDate.get(selectedDateKey) ?? [];
    const closed = trades.filter((t) => t.status === 'closed' && t.r !== null);
    const dayR = closed.reduce((acc, t) => acc + (t.r ?? 0), 0);
    const dayPnl = trades.reduce((acc, t) => acc + (t.status === 'closed' ? (t.pnl ?? 0) : 0), 0);
    return {
      dateKey: selectedDateKey,
      dayNum: pDay,
      monthName: THAI_MONTH_NAMES[pMonth - 1] ?? '',
      year: pYear,
      dayName: THAI_DAY_NAMES[dayOfWeek] ?? '',
      tradesCount: trades.length,
      closedCount: closed.length,
      dayR,
      dayPnl,
    };
  }, [selectedDateKey, calendar.tradesByDate, year, month]);

  return (
    <div className="space-y-6">
      {/* ── แถบควบคุม: เลื่อนเดือน + ตัวกรอง + ปุ่มสร้าง ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        {/* เลื่อนเดือน */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="btn btn-sm px-2.5"
            title="เดือนก่อนหน้า"
            aria-label="เดือนก่อนหน้า"
          >
            <Icon name="left" size={15} />
          </button>
          <div className="flex items-center gap-2 px-1">
            <span className="text-base font-bold text-fg tabular-nums">
              {THAI_MONTH_NAMES[month - 1]} {year}
            </span>
            {(year !== todayYear || month !== todayMonth) && (
              <button
                type="button"
                onClick={goToday}
                className="chip text-[11px] hover:border-accent"
              >
                เดือนปัจจุบัน
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={nextMonth}
            className="btn btn-sm px-2.5"
            title="เดือนถัดไป"
            aria-label="เดือนถัดไป"
          >
            <Icon name="right" size={15} />
          </button>
        </div>

        {/* ตัวกรองและปุ่มบันทึก */}
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="field text-xs py-1"
            aria-label="กรอง symbol"
          >
            <option value="all">ทุก Symbol ({symbolsInJournal.length})</option>
            {symbolsInJournal.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as JournalStatus | 'all')}
            className="field text-xs py-1"
            aria-label="กรองสถานะ"
          >
            <option value="all">ทุกสถานะ</option>
            {(Object.keys(STATUS_LABEL) as JournalStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {onNewTrade && (
            <button
              type="button"
              onClick={onNewTrade}
              className="btn btn-primary btn-sm ml-1"
            >
              <Icon name="plus" size={14} />
              บันทึกใหม่
            </button>
          )}
        </div>
      </div>

      {/* ── แถบสรุปภาพรวมประจำเดือน (Monthly Summary) ────────────────── */}
      <div className="grid grid-cols-2 gap-3 card p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="ไม้ที่ปิดในเดือนนี้"
          value={
            calendar.summary.closedTrades > 0
              ? `${calendar.summary.closedTrades} ไม้`
              : '0 ไม้'
          }
          sub={
            calendar.summary.openTrades > 0
              ? `(ถืออยู่ ${calendar.summary.openTrades} ไม้)`
              : undefined
          }
        />
        <Stat
          label="Win Rate"
          value={
            calendar.summary.winRate !== null
              ? fmtPct(calendar.summary.winRate)
              : '-'
          }
          sub={
            calendar.summary.closedTrades > 0
              ? `ชนะ ${calendar.summary.wins} / แพ้ ${calendar.summary.losses}`
              : undefined
          }
          tone={
            calendar.summary.winRate !== null
              ? calendar.summary.winRate >= 0.5
                ? 'up'
                : 'down'
              : undefined
          }
        />
        <Stat
          label="ผลรวม R"
          value={fmtR(calendar.summary.totalR, 1)}
          sub={
            calendar.summary.closedTrades > 0
              ? `เฉลี่ย ${fmtR(calendar.summary.avgR, 2)}/ไม้`
              : undefined
          }
          tone={
            calendar.summary.totalR > 0
              ? 'up'
              : calendar.summary.totalR < 0
                ? 'down'
                : undefined
          }
        />
        <Stat
          label="กำไรสุทธิ (เงิน)"
          value={
            calendar.summary.totalPnl !== 0
              ? `${calendar.summary.totalPnl > 0 ? '+' : ''}${calendar.summary.totalPnl.toFixed(2)}`
              : '0.00'
          }
          tone={
            calendar.summary.totalPnl > 0
              ? 'up'
              : calendar.summary.totalPnl < 0
                ? 'down'
                : undefined
          }
        />
        <Stat
          label="ทำตามแผน"
          value={
            calendar.summary.followRate !== null
              ? fmtPct(calendar.summary.followRate)
              : '-'
          }
          sub={
            calendar.summary.judgedCount > 0
              ? `${calendar.summary.followedPlanCount}/${calendar.summary.judgedCount} ไม้`
              : undefined
          }
        />
        <div className="flex flex-col justify-center text-xs text-muted">
          <span>
            {calendar.summary.totalTrades} รายการทั้งหมด
          </span>
          <span className="text-[11px] text-faint mt-0.5">
            คลิกช่องวันในตารางเพื่อกรอง
          </span>
        </div>
      </div>

      {/* ── ตารางปฏิทิน (Month Grid) ───────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-line bg-panel p-3 shadow-sm">
        <div className="min-w-[720px]">
          {/* Header แถววันในสัปดาห์ */}
          <div className="grid grid-cols-8 gap-1.5 pb-2 border-b border-line text-center text-xs font-semibold text-muted">
            {THAI_DAY_NAMES.map((name, idx) => (
              <div
                key={name}
                className={idx >= 5 ? 'text-faint' : 'text-fg-2'}
              >
                <span className="hidden sm:inline">{name}</span>
                <span className="sm:hidden">{THAI_DAY_NAMES_SHORT[idx]}</span>
              </div>
            ))}
            <div className="text-accent font-bold">รวมสัปดาห์</div>
          </div>

          {/* สัปดาห์ต่างๆ */}
          <div className="mt-2 space-y-1.5">
            {calendar.weeks.map((week) => (
              <div key={week.weekIndex} className="grid grid-cols-8 gap-1.5">
                {/* 7 ช่องวัน (จันทร์ - อาทิตย์) */}
                {week.days.map((day) => {
                  const isToday = day.dateKey === todayKey;
                  const isSelected = day.dateKey === selectedDateKey;
                  const hasTrades = day.tradesCount > 0;
                  const hasClosed = day.closedCount > 0;

                  // โทนสีพื้นหลังตามผลลัพธ์ R
                  let cellToneCls = 'bg-field/30 border-line hover:border-line-strong hover:bg-hover/60';
                  if (!day.isCurrentMonth) {
                    cellToneCls = 'opacity-25 bg-field/10 border-transparent';
                  } else if (hasClosed) {
                    if (day.totalR > 0) {
                      cellToneCls = 'bg-bull/10 border-bull/35 hover:border-bull text-bull';
                    } else if (day.totalR < 0) {
                      cellToneCls = 'bg-bear/10 border-bear/35 hover:border-bear text-bear';
                    } else {
                      cellToneCls = 'bg-field/80 border-line text-muted';
                    }
                  } else if (hasTrades) {
                    cellToneCls = 'bg-accent/10 border-accent/30 text-accent';
                  }

                  const selectCls = isSelected
                    ? 'ring-2 ring-accent border-accent shadow-md z-10'
                    : '';

                  return (
                    <div
                      key={day.dateKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedDateKey((prev) => (prev === day.dateKey ? null : day.dateKey));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedDateKey((prev) => (prev === day.dateKey ? null : day.dateKey));
                        }
                      }}
                      className={`group relative flex min-h-[82px] sm:min-h-[92px] flex-col justify-between rounded-lg border p-1.5 sm:p-2 transition-all cursor-pointer ${cellToneCls} ${selectCls}`}
                    >
                      {/* แถวบน: วันที่ + ป้ายจำนวนไม้ */}
                      <div className="flex items-center justify-between gap-1">
                        {isToday ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-on-accent">
                            {day.dayNum}
                          </span>
                        ) : (
                          <span
                            className={`text-xs font-semibold tabular-nums ${
                              day.isCurrentMonth
                                ? day.dayOfWeek >= 5
                                  ? 'text-faint'
                                  : 'text-fg-2'
                                : 'text-muted'
                            }`}
                          >
                            {day.dayNum}
                          </span>
                        )}

                        {hasTrades && (
                          <span className="rounded bg-panel/80 px-1 py-0.2 font-mono text-[10px] text-fg-2 shadow-xs">
                            {day.tradesCount}
                          </span>
                        )}
                      </div>

                      {/* ตรงกลาง/ล่าง: ผลลัพธ์ R */}
                      <div className="mt-1 text-center">
                        {hasClosed ? (
                          <>
                            <div className="text-xs sm:text-[13px] font-bold tabular-nums leading-tight">
                              {fmtR(day.totalR, 1)}
                            </div>
                            <div className="mt-0.5 text-[10px] tabular-nums opacity-75">
                              {day.wins}W {day.losses}L
                            </div>
                          </>
                        ) : hasTrades ? (
                          <div className="text-[11px] font-medium opacity-85">
                            {day.trades[0]?.status === 'open' ? 'ถืออยู่' : 'แผน'}
                          </div>
                        ) : null}
                      </div>

                      {/* เส้นบอกสถานะเลือก */}
                      {isSelected && (
                        <div className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-accent" />
                      )}
                    </div>
                  );
                })}

                {/* ช่องสรุปประจำสัปดาห์ (Week Summary) */}
                <div
                  className={`flex min-h-[82px] sm:min-h-[92px] flex-col justify-between rounded-lg border border-line bg-field/50 p-1.5 sm:p-2 text-center ${
                    week.summary.closedCount > 0
                      ? week.summary.totalR > 0
                        ? 'border-bull/20 bg-bull/5'
                        : week.summary.totalR < 0
                          ? 'border-bear/20 bg-bear/5'
                          : ''
                      : ''
                  }`}
                >
                  <div className="text-[10px] font-medium text-muted">
                    สัปดาห์ {week.weekIndex + 1}
                  </div>

                  {week.summary.closedCount > 0 ? (
                    <div>
                      <div
                        className={`text-xs sm:text-[13px] font-bold tabular-nums ${
                          week.summary.totalR > 0
                            ? 'text-bull'
                            : week.summary.totalR < 0
                              ? 'text-bear'
                              : 'text-fg'
                        }`}
                      >
                        {fmtR(week.summary.totalR, 1)}
                      </div>
                      <div className="mt-0.5 text-[10px] tabular-nums text-muted">
                        {week.summary.wins}W {week.summary.losses}L
                        {week.summary.winRate !== null && ` (${fmtPct(week.summary.winRate)})`}
                      </div>
                    </div>
                  ) : week.summary.tradesCount > 0 ? (
                    <div className="text-[11px] text-muted">
                      {week.summary.tradesCount} ไม้
                    </div>
                  ) : (
                    <div className="text-xs text-faint">-</div>
                  )}

                  <div className="text-[9px] text-faint">
                    {week.summary.tradesCount > 0 ? `${week.summary.tradesCount} ไม้` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── รายการเทรดด้านล่าง (ตามวันที่เลือก หรือทั้งเดือน) ──────────── */}
      <div className="space-y-3">
        {/* หัวข้อรายการ */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div className="flex items-center gap-2">
            <span className="text-accent">
              <Icon name="journal" size={17} />
            </span>
            {selectedDayInfo ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-semibold text-fg">
                  รายการเทรด: วัน{selectedDayInfo.dayName}ที่ {selectedDayInfo.dayNum}{' '}
                  {selectedDayInfo.monthName} {selectedDayInfo.year}
                </h3>
                <span className="text-xs text-muted">
                  ({selectedDayInfo.tradesCount} ไม้
                  {selectedDayInfo.closedCount > 0 && (
                    <>
                      {' · '}
                      <span
                        className={`font-semibold tabular-nums ${
                          selectedDayInfo.dayR >= 0 ? 'text-bull' : 'text-bear'
                        }`}
                      >
                        รวม {fmtR(selectedDayInfo.dayR, 2)}
                      </span>
                    </>
                  )}
                  )
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-semibold text-fg">
                  รายการเทรดในเดือน {THAI_MONTH_NAMES[month - 1]} {year}
                </h3>
                <span className="text-xs text-muted">
                  ({displayedTrades.length} ไม้)
                </span>
              </div>
            )}
          </div>

          {selectedDateKey && (
            <button
              type="button"
              onClick={() => setSelectedDateKey(null)}
              className="chip text-xs hover:border-accent"
            >
              แสดงทั้งเดือน
            </button>
          )}
        </div>

        {/* รายการไม้ */}
        {displayedTrades.length === 0 ? (
          <div className="card p-8 text-center text-muted">
            <Empty
              icon="journal"
              title={
                selectedDateKey
                  ? 'ไม่มีการเทรดในวันที่เลือก'
                  : 'ยังไม่มีบันทึกการเทรดในเดือนนี้'
              }
            >
              {selectedDateKey
                ? 'คลิกเลือกวันอื่นบนปฏิทิน หรือคลิก "แสดงทั้งเดือน"'
                : 'สามารถเริ่มจดแผนการเทรดใหม่ได้โดยกดปุ่ม "บันทึกใหม่"'}
            </Empty>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {displayedTrades.map((e) => {
              const canPreview =
                !!e.tf &&
                e.entryTime != null &&
                e.entryPrice != null &&
                e.sl != null &&
                e.tp != null;

              return (
                <div
                  key={e.id}
                  className="card flex flex-col justify-between p-4 transition-colors hover:border-line-strong"
                >
                  <div className="space-y-3">
                    {/* แถวบน: ทิศทาง + Symbol + ผล R */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`badge font-bold px-2 py-0.5 ${
                            e.direction === 'long'
                              ? 'bg-bull/15 text-bull'
                              : 'bg-bear/15 text-bear'
                          }`}
                        >
                          {e.direction === 'long' ? 'BUY' : 'SELL'}
                        </span>
                        <span className="font-semibold text-fg">
                          {e.symbol} {e.tf ?? ''}
                        </span>
                      </div>

                      <div>
                        {e.r !== null ? (
                          <span
                            className={`text-base font-bold tabular-nums ${
                              e.r >= 0 ? 'text-bull' : 'text-bear'
                            }`}
                          >
                            {fmtR(e.r, 2)}
                          </span>
                        ) : (
                          <span className={`badge ${STATUS_CLS[e.status]}`}>
                            {STATUS_LABEL[e.status]}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ท่าเทรด & เวลา */}
                    <div className="text-xs text-muted space-y-0.5">
                      {e.strategy && (
                        <div className="text-fg-2 font-medium">
                          ท่า: {strategyName(e.strategy)}
                        </div>
                      )}
                      <div>
                        เข้า: {formatThaiTime(e.entryTime ?? e.createdAt)}
                      </div>
                      {e.exitTime && <div>ออก: {formatThaiTime(e.exitTime)}</div>}
                    </div>

                    {/* ราคา Entry / SL / TP */}
                    {(e.entryPrice != null || e.exitPrice != null) && (
                      <div className="grid grid-cols-2 gap-1 rounded bg-field/50 p-2 text-[11px] tabular-nums">
                        {e.entryPrice != null && (
                          <div>
                            <span className="text-muted">Entry: </span>
                            <span className="font-medium text-fg">{e.entryPrice}</span>
                          </div>
                        )}
                        {e.exitPrice != null && (
                          <div>
                            <span className="text-muted">Exit: </span>
                            <span className="font-medium text-fg">{e.exitPrice}</span>
                          </div>
                        )}
                        {e.sl != null && (
                          <div>
                            <span className="text-muted">SL: </span>
                            <span className="text-bear">{e.sl}</span>
                          </div>
                        )}
                        {e.tp != null && (
                          <div>
                            <span className="text-muted">TP: </span>
                            <span className="text-bull">{e.tp}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* เหตุผลเข้า (Setup) & วินัย */}
                    {e.setup && (
                      <div className="text-xs text-fg-2 line-clamp-2" title={e.setup}>
                        <span className="text-muted">เหตุผล: </span>
                        {e.setup}
                      </div>
                    )}

                    {/* ป้ายทำตามแผน / อารมณ์ */}
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {e.followedPlan !== null && (
                        <span
                          className={`badge ${
                            e.followedPlan
                              ? 'bg-bull/10 text-bull'
                              : 'bg-bear/10 text-bear'
                          }`}
                        >
                          {e.followedPlan ? 'ตามแผน' : 'ไม่ตามแผน'}
                        </span>
                      )}
                      {e.emotion && (
                        <span className="chip text-[11px] py-0.5">
                          {e.emotion}
                        </span>
                      )}
                      {e.pnl !== null && (
                        <span
                          className={`badge tabular-nums ${
                            e.pnl >= 0 ? 'text-bull' : 'text-bear'
                          }`}
                        >
                          {e.pnl >= 0 ? '+' : ''}${e.pnl.toFixed(2)}
                        </span>
                      )}
                    </div>

                    {/* รูปภาพขนาดย่อ */}
                    {e.images.length > 0 && onViewImage && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-muted">รูป ({e.images.length}):</span>
                        <div className="flex gap-1 overflow-x-auto">
                          {e.images.slice(0, 3).map((imgName) => (
                            <button
                              key={imgName}
                              type="button"
                              onClick={() => onViewImage(imgName)}
                              className="chip text-[10px] py-0.5 hover:border-accent"
                            >
                              รูป {imgName.slice(-8)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* แถบปุ่ม Action ด้านล่าง */}
                  <div className="mt-4 flex items-center justify-between border-t border-line pt-2.5">
                    {canPreview && onPreviewTrade ? (
                      <button
                        type="button"
                        onClick={() => onPreviewTrade(e)}
                        className="btn btn-sm text-xs"
                      >
                        <Icon name="chart" size={13} />
                        ดูกราฟ
                      </button>
                    ) : (
                      <div />
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectTrade(e.id)}
                      className="btn btn-sm btn-primary text-xs"
                    >
                      ดู / แก้ไข
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
