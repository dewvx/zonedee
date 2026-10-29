# Roadmap

แต่ละ phase ต้องรันดูผลได้จริงก่อนไป phase ถัดไป ติ๊ก `[x]` เมื่อเสร็จ

## MVP

- [x] **Phase 0 — โครงโปรเจกต์**: monorepo (core / server / web), CLAUDE.md, rules.md, skill `technical-analysis`, กราฟแท่งเทียนจากข้อมูลจำลอง + EMA 9/21
- [x] **Phase 1 — ข้อมูลจริง**: SQLite (`node:sqlite`), resample (`core/resample`), `npm run fetch`, API อ่านจาก DB (ไม่มีข้อมูล → ข้อมูลจำลอง)
  - forex/ทอง: เลือกแหล่งได้ที่ `FOREX_SOURCE` — Yahoo (ค่าเริ่มต้น: M1 ~30 วัน, M5 ~60 วัน, H1 ~2 ปี, ทอง = GC=F futures) / **MT5 ของ XM** (`tools/mt5`) / Dukascopy (ต.ค. 2026 ล่ม ตอบ 202)
  - หุ้น US: Yahoo D1
- [x] **Phase 2 — กราฟจริง**: เลื่อนซ้ายโหลดแท่งเก่าเพิ่มทีละ 1,000, ปุ่มอัปเดต + อัปเดตอัตโนมัติ (`POST /api/fetch` กันกดซ้ำ), จำ symbol/TF/ตัวเลือกไว้ในเบราว์เซอร์, แท่งที่ยังไม่ปิดวาดจาง + นับถอยหลัง, แกนเวลาเป็นเวลาไทย
- [x] **Phase 3 — Swing + โซนแนวรับต้าน**: ATR (Wilder), swing (causal), เนื้อเท่ากัน, โซน R/S/RBS/SBR + สถานะ, แบ่งโควต้าเหนือ/ใต้ราคา, แผงตั้งค่าบนกราฟ, โหมดริวเรน, จุด swing · D5 (กรอบ Bo) ตัดสินแล้ว
- [x] **Phase 4 — โครงสร้างราคา**: BOS / CHoCH, กรอบ Bo buy/sell (+ กรอบ TF ใหญ่ตามชุดของ Braron), FVG, OB, Sweep — แถบเปิดปิดทีละชั้นบนกราฟ
- [x] **Phase 5 — Risk calculator**: คลิกวาง Entry / SL / TP บนกราฟ (ลากปรับได้), คำนวณ lot ตาม % ความเสี่ยง, R:R, margin, นับ spread, สเปกสัญญา + ยอดเงิน + leverage จาก MT5 (ไม่มี → ค่ามาตรฐาน XM) → **MVP เสร็จ 🎉**

## หลัง MVP

- [x] **Phase 6 — Backtest engine**: market/limit, spread, gap, SL/TP แท่งเดียวแยกด้วย M1, ทีละไม้ (limit จองช่อง), รายงานเป็น R + equity curve, in/out-of-sample, เทียบเข้าสุ่ม — ตรวจกับ random walk แล้วไม่มี bias · `npm run backtest` + หน้า Backtest
- [x] **Phase 7 — ท่าจากไฟล์**: EMA Cross (ท่า 3), sk Fibo, Bo 3 TF, CRT (ท่า 6), FVG + Sweep (ท่า 2), RBS/SBR หลาย TF (ท่า 1), OB + MSS (ท่า 5) — ปุ่ม "เทียบทุกท่า"
- [x] **Phase 8 — Journal**: บันทึกแผน/ผล (R คิดให้), รูปกราฟ (ปุ่มในเครื่องคิด lot ถ่ายให้ / Ctrl+V วางรูป), ผูกกับท่า + เวลาสัญญาณ, อารมณ์ + ทำตามแผนไหม, สถิติแยกตามท่า
- [x] **Phase 9 — แจ้งเตือน LINE**: ตัวตรวจเบื้องหลังใน server (ทุก 30 วิ ตรวจเมื่อแท่งปิด) — เมื่อท่าเกิดสัญญาณ / ราคาปิดเหนือ-ใต้-แตะระดับ → ในแอป + เด้งบนเครื่อง + LINE Messaging API (token ใน .env, จำกัด 30 ข้อความ/วัน, เช็กโควต้าได้)
- [x] **Phase 10 — ตัวสแกนหุ้นซิ่ง US**: รายชื่อจาก screener ของ Yahoo (small cap gainers ฯลฯ) / watchlist / พิมพ์เอง → volume พุ่ง vs เฉลี่ย 20 วัน, gap, ทะลุ high 20 วัน, BOS ขึ้น + กรองราคา/สภาพคล่อง · กด "กราฟ" = เพิ่มหุ้นเข้าแอปอัตโนมัติ
- [x] **Phase 11 — Watchlist ลงทุน**: หุ้น/ETF ใน Dime — ผลตอบแทน 1D–1Y/YTD, ห่างจาก high 52 สัปดาห์, MA50/200, RSI, มูลค่า/กำไรพอร์ต, DCA ต่อเดือน
- [x] **Phase 12 — โหมด replay**: ซ่อนแท่งอนาคต ทาย BUY/SELL/ไม่เทรด ลาก SL/TP แล้วเฉลยทีละแท่ง · สุ่มจุดทั่วไปหรือ "จุดที่ท่าเกิดสัญญาณ" (เทียบกับที่ท่าทำ) · เก็บคะแนน

- [x] **Phase 13 — เครื่องมือหุ้นลงทุน** (แรงบันดาลใจจาก Rocket Tool): แนวรับต้านแบบง่าย (`keyLevels`) ในหน้าลงทุน / ตัวสแกน / ชั้นบนกราฟ · ตัวสแกนโหมด "หุ้นลงทุน" (หุ้นใหญ่ + ETF 100 ตัว, ใกล้แนวรับ / ทะลุแนวต้าน / หลุดแนวรับ) · แจ้งเตือนแนวรับต้าน + วันประกาศงบ · เป้า % + จัดพอร์ตเดือนนี้ (rebalance แบบ DCA / ปรับเต็ม)

## ต่อจากนี้ (ไอเดีย — ยังไม่ทำ)

> ดูรายละเอียดและข้อกำหนดเชิงเทคนิคของแต่ละงานได้ที่ **[docs/backlog.md](backlog.md)** (TASK-01 ถึง TASK-07)

- [x] **สรุปหุ้นอัตโนมัติเป็นภาษาไทย** (Rule-based checklist จากตัวเลขที่มี ไม่เสียค่า API): วิเคราะห์เทรนด์ (SMA 50/200), โมเมนตัม (RSI 14, 52w high/low), แนวรับต้านหลัก (`keyLevels`), งบการเงินย่อ และวันประกาศงบ พร้อมคำแนะนำเชิงกลยุทธ์สำหรับ DCA/Swing
- [x] **งบการเงินย่อจาก Yahoo Finance**: ดึง P/E, Forward P/E, PEG, P/B, ROE, รายได้รวม, รายได้โต YoY %, อัตรากำไรสุทธิ %, หนี้สิน (Debt/Equity), และเงินปันผล พร้อม Cache 24 ชม. ใน SQLite (`FundamentalsCache`)

- [x] **แท่ง D1 แบบตัดวันตอน NY close (D9)** ให้ตรงกับ MT5 (`TASK-01`): สลับโหมด UTC (00:00) และ NY Close (17:00 NY / ตี 4-5 ไทย) บนกราฟ, คำนวณ DST/EST แม่นยำ, ตัดแท่งปลอมวันอาทิตย์ออกรวมเข้ากับวันจันทร์ตรงกับ MT5
- [x] **Hotkeys / คีย์ลัดบนหน้ากราฟและโหมด Replay** (`TASK-02`): สลับ TF ด้วยตัวเลข 1, 5, 15, 30, 4, 6 หรือ H/D/W, เปิด/ปิด EMA (E), โครงสร้างราคา (L), Replay เดินแท่ง (Space/→), BUY (B), SELL (S), ข้าม (N/X), สุ่มใหม่ (R), หน้าต่างคู่มือคีย์ลัด HotkeyHelpModal (?)
- [x] **ปฏิทินบันทึกการเทรดใน Journal (Trade Calendar View)** (`TASK-03`): ตารางปฏิทินรายเดือนแสดงผลรวม R ประจำวัน (เขียว/แดง), แถวสรุปประจำสัปดาห์ (Weekly Total R), แถบสรุปภาพรวมประจำเดือน (Win Rate, Total R, PnL, Plan Adherence), คลิกเลือกวันเพื่อกรองรายการเทรดด้านล่าง และสลับมุมมอง List/Calendar ได้อย่างราบรื่น
- [x] **ท่า 4 AMD (Accumulation, Manipulation, Distribution)** (`TASK-04`): จับช่วงสะสม Asian Session (00-07 UTC), London Manipulation Sweep (07-13 UTC), ยืนยันกลับตัว MSS / Reversal, เข้า Market/Limit, SL ปลายไส้ sweep, TP ฝั่งตรงข้ามของ Asian Range (หรือ R:R), พร้อมโหมด Rolling Consolidation สำหรับทุก TF/ตลาด
- [x] **เครื่องมือจูนพารามิเตอร์อัตโนมัติ (Grid Search Optimization)** (`TASK-05`): รัน Backtest หลายตัวแปรพร้อมกัน (Cartesian Product), ประเมิน Expectancy, Win Rate, Max DD, Out-of-sample และ Random Baseline (Top 8), ไฮไลต์ชุดที่ดีที่สุดและมีนัยสำคัญทางสถิติ, รองรับทั้ง CLI (`--tune`, `--grid`) และหน้าเว็บ BacktestView พร้อมปุ่มนำค่าไปใส่ฟอร์มหรือรันทันที
- ท่า 7 Trendline, ท่า 8 Power x Braron (รอนิยามเพิ่ม)
- [x] **คำนวณต้นทุน Swap ข้ามคืน (Overnight Swap)** (TASK-06): ดึงค่า Swap Long/Short และ Rollover 3-Day จาก MT5 Info และตารางสเปกมาตรฐาน XM, คำนวณ Rollover ข้ามคืน 21:00 UTC (17:00 NY) และ Triple Swap วันพุธ, แสดงพรีวิวต้นทุน Swap ต่อคืนในหน้าคำนวณ Lot (RiskPanel), และหักลบต้นทุน Swap ออกจากผลลัพธ์สุทธิ R และยอดเงินใน Backtest Engine พร้อมตัวเลือกปรับค่าในหน้าเว็บและ CLI
- [x] **Walk-Forward Analysis & Multi-Pair Backtesting** (TASK-07): วิเคราะห์ความทนทานของกลยุทธ์ด้วย Sliding Windows (Train In-Sample / Test Out-of-Sample), คำนวณ Walk-Forward Efficiency (WFE %), สร้าง OOS Equity Curve รวม, และจำลองพอร์ตโฟลิโอหลายคู่เงินพร้อมกัน (Multi-Pair Portfolio) พร้อมคำนวณ Diversification Benefit Ratio รองรับทั้ง REST API, CLI (--wf, --multipair) และหน้าเว็บ BacktestView
