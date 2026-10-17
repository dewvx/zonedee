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

- [ ] **Phase 6 — Backtest engine**: วนทีละแท่ง, SL/TP ด้วย M1, spread, รายงานเป็น R + equity curve, ท่าแรก EMA 9/21
- [ ] **Phase 7 — ท่าจากไฟล์**: sk Fibo, CRT, FVG + Sweep, RBS/SBR หลาย TF, เทียบกับการเข้าแบบสุ่ม, out-of-sample
- [ ] **Phase 8 — Journal**: บันทึกการเทรด + รูปกราฟ + ผูกกับสัญญาณ
- [ ] **Phase 9 — แจ้งเตือน LINE**: Messaging API push (LINE Notify ปิดไปแล้ว) — ระวังโควต้าฟรีของ OA
- [ ] **Phase 10 — ตัวสแกนหุ้นซิ่ง US**: volume พุ่ง vs ค่าเฉลี่ย 20 วัน, ทะลุแนวต้าน/กรอบ, gap
- [ ] **Phase 11 — Watchlist ลงทุน**: Daily / Weekly สำหรับพอร์ต DCA
- [ ] **Phase 12 — โหมด replay**: ซ่อนแท่งอนาคต ให้ทาย buy / sell แล้วเฉลย
