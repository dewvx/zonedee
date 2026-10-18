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

## ต่อจากนี้ (ไอเดีย — ยังไม่ทำ)

- จูนค่า D1 (swing) / D2 / D3 / D11 / D12 ด้วย backtest บนข้อมูล MT5 จริงหลายเดือน แล้วตัดสินในตาราง rules.md
- ท่า 4 AMD, ท่า 7 Trendline, ท่า 8 Power x Braron (รอนิยามเพิ่ม)
- แท่ง D1 แบบตัดวันตอน NY close (D9) ให้ตรงกับ MT5
- walk-forward / ทดสอบหลายคู่เงินพร้อมกัน, ต้นทุน swap ข้ามคืน
