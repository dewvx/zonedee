# zonedee

แอปวิเคราะห์กราฟส่วนตัว รันในเครื่อง (Windows) ไม่ deploy — ใช้คนเดียว
- **โหมดเทรด**: forex / ทอง (XAUUSD) TF นาที ตามท่า SMC ใน `docs/rules.md` เทรดจริงผ่าน XM
- **โหมดหุ้นซิ่ง**: US small cap / penny (Daily, 1h) เทรดผ่าน Dime
- **โหมดลงทุน**: หุ้นนอก Daily / Weekly สำหรับ DCA

**แอปนี้เป็นเครื่องมือวิเคราะห์เท่านั้น ห้ามเขียนโค้ดส่งคำสั่งซื้อขายจริงไปที่โบรกเกอร์**

## คำสั่ง

```bash
npm install          # ติดตั้งครั้งแรก (Node >= 22.13 เพราะใช้ node:sqlite)
npm run fetch        # ดึงราคาลง data/zonedee.sqlite (ต่อจากของเดิม) — ดูตัวเลือกใน apps/server/src/fetch-cli.ts
npm run backtest -- --tf M5 --strategy sk-fibo   # backtest จากข้อมูลใน DB (--all เทียบทุกท่า, --list ดูท่า)
npm run dev          # server (:3001) + web (:5173) พร้อมกัน
npm test             # เทสต์ทุก workspace (vitest)
npm run typecheck    # เช็ก type ทุก workspace
npm run build        # build web
```

## โครงสร้าง

```
packages/core/   ฟังก์ชันล้วน: types, indicators, structure, zones, risk, backtest, strategies
                 ไม่แตะ DB / network / DOM — ใช้ร่วมกันทั้งกราฟและ backtest
  src/backtest/      engine (simulate), stats, baseline (เทียบเข้าสุ่ม), run (รวมทุกอย่าง), grid-search (จูนพารามิเตอร์อัตโนมัติ)
  src/strategies/    ท่าเทรด — 1 ไฟล์ต่อท่า + common.ts (params ร่วม, ltfConfirm) + index.ts (STRATEGIES)
  src/mtf.ts         htfView: แท่ง TF ใหญ่ + ใช้ได้ตั้งแต่แท่ง TF เล็กไหน (กันแอบดูอนาคต)
  src/scan/          scanStock (หุ้นซิ่ง D1), watchMetrics (watchlist ลงทุน), keyLevels (แนวรับต้านแบบง่าย),
                     stock-news (วิเคราะห์ Sentiment ข่าว), rebalance (จัดพอร์ตตามเป้า %)
apps/server/     Express 5 — API + ดึง/เก็บข้อมูล
  src/app.ts         routes ทั้งหมด: symbols, candles, fetch, contract, strategies, backtest, news,
                     journal, alerts, user-symbols, watchlist, scan
  src/backtest.ts    โหลดข้อมูลจาก SQLite + M1 แยก SL/TP + spread → รันท่า / เทียบทุกท่า / จูนพารามิเตอร์
  src/backtest-cli.ts npm run backtest (--tune, --grid)
  src/news.ts        ดึงข่าว Yahoo Finance + cache 15 นาที + สรุปด้วย Claude / Gemini AI
  src/journal.ts     Journal (ตาราง journal + รูปใน data/journal/)
  src/alerts/        แจ้งเตือน: store (กฎ/เหตุการณ์), engine (ตรวจทุก 30 วิ เมื่อแท่งปิด), line (Messaging API)
                     กฎ 4 แบบ: strategy, price, level (แนวรับต้าน), earnings (วันประกาศงบ)
  src/scanner.ts     สแกนหุ้น (Yahoo screener / หุ้นยอดนิยม 100 ตัว + D1 cache 10 นาที)
  src/watchlist.ts   watchlist ลงทุน + ตัวเลขพอร์ต + แนวรับต้าน + เป้า %
  src/earnings.ts    cache วันประกาศงบ (Yahoo quote, 12 ชม.)
  src/user-symbols.ts หุ้น US ที่ผู้ใช้เพิ่มเอง + registry (รายการหลัก + ที่เพิ่ม)
  src/fetch-runner.ts สั่งดึงจากในแอป (กันดึงซ้ำ symbol เดียวกัน)
  src/contract.ts    สเปกสัญญาสำหรับเครื่องคิด lot (MT5 --info, cache 1 นาที / ค่ามาตรฐาน XM)
  src/symbols.ts     รายชื่อ symbol + แหล่งข้อมูล (FOREX_SOURCE) + native TF ที่ดึงตรง
  src/store.ts       SQLite (node:sqlite) ตาราง candles(symbol, timeframe, time, ohlcv)
  src/ingest.ts      บันทึก native TF แล้ว resample TF ลูกเฉพาะช่วงที่เปลี่ยน
  src/fetchers/      yahoo (forex intraday + หุ้น D1), mt5 (เรียก tools/mt5 ผ่าน Python), dukascopy
tools/mt5/       สคริปต์ Python ดึงราคาจาก MT5 ของ XM (Windows) — ดู README ในโฟลเดอร์
data/            ไฟล์ SQLite (ราคา, journal, แจ้งเตือน, watchlist) + รูป journal (ไม่ขึ้น git)
.env             LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID (ไม่ขึ้น git — ดู .env.example)
apps/web/        React 19 + Vite + Tailwind v4 + Lightweight Charts v5
  src/App.tsx        แถบเมนูซ้าย + สลับหน้า (หน้ากราฟเปิดค้างไว้) + ปุ่มสลับธีม
  src/theme.ts       ธีมมืด/สว่าง (จำใน localStorage) + สีของกราฟ canvas
  src/views/         ChartView (กราฟ + เครื่องคิด lot), BacktestView, ReplayView, JournalView, AlertsView,
                     ScannerView, WatchlistView
  src/components/CandleChart.tsx  กราฟ — เวลาแสดงผลเลื่อนเป็นเวลาไทยใน toChartTime (ข้อมูลจริงยังเป็น UTC)
  src/chartTime.ts   toChartTime (เลื่อนเป็นเวลาไทยเพื่อแสดงผล) + snapTime
  src/overlays.ts    แปลงผลจาก core (โซน, BOS, Bo, FVG, OB, sweep) → กล่อง/เส้น/marker ที่จะวาด
  src/components/OverlayPrimitive.ts  วาดกล่อง/เส้น/ป้ายด้วย series primitive ของ Lightweight Charts
  src/components/ZonePanel.tsx     แผงตั้งค่าแนวรับต้าน
  src/components/LayerBar.tsx      ปุ่มเปิดปิดชั้นโครงสร้างราคา
  src/components/RiskPanel.tsx     แผงเครื่องคิด lot (Entry/SL/TP วางด้วยคลิก/ลากบนกราฟ)
  src/settings.ts    ค่าที่จำใน localStorage (try/catch เสมอ)
docs/rules.md    สเปกกฎการเทรด (source of truth ของ detector ทุกตัว)
docs/roadmap.md  phase และสถานะ
docs/backlog.md  สเปกงานและฟีเจอร์ที่วางแผนทำต่อ (TASK-01 เป็นต้นไป)
```

## กฎเหล็ก

1. **ห้ามแอบดูอนาคต (no look-ahead)** — ฟังก์ชันใน core ที่ให้ผลที่แท่ง `i` ใช้ได้แค่แท่ง `0..i` swing ที่ใช้ `N` แท่งขวา ถือว่าเกิดที่แท่ง `j+N` ไม่ใช่ `j` ข้อมูล TF ใหญ่ใช้ได้หลังแท่งนั้นปิด ทุก detector ต้องมีเทสต์ "คำนวณจากข้อมูลบางส่วน = คำนวณจากข้อมูลทั้งหมด" (ดูตัวอย่างใน `packages/core/test/ema.test.ts`)
2. **ทำตาม `docs/rules.md`** — ก่อนเขียน/แก้ detector หรือท่าเทรด ให้ใช้ skill `technical-analysis` ถ้าต้องตีความเพิ่ม ให้อัปเดต rules.md ในตาราง "การตัดสินใจที่ค้าง" ด้วย อย่าตีความเงียบๆ ในโค้ด
3. **ค่าที่จูนได้ต้องอยู่ใน config** พร้อม default ตาม rules.md ห้าม hardcode ตัวเลขวิเศษ
4. **เวลา = UTC milliseconds** ทั้งโปรเจกต์ แปลงเป็นวินาทีเฉพาะตอนส่งให้ Lightweight Charts (`toChartTime`) แสดงผลเป็นเวลาไทย
5. **ระยะห่าง/ความกว้างโซนวัดเป็น × ATR** เพื่อให้ใช้ได้ทุกตลาด
6. **core ต้องมีเทสต์** — ทุก detector มี fixture ที่ทำมือ (รู้คำตอบแน่นอน) + เทสต์ no-look-ahead
7. **ทำทีละ phase** ตาม `docs/roadmap.md` แต่ละ phase ต้องรันดูผลได้ แล้วติ๊กใน roadmap
8. **Git & Branching**: ห้าม push ขึ้น branch `main` โดยตรงเด็ดขาด เมื่อเริ่มงานใหม่ให้แตก branch แยกออกมาเสมอ (เช่น `feature/<task-name>`) และ push ขึ้น branch นั้นเพื่อให้ผู้ใช้ตรวจสอบและ merge เองทีหลัง

## สไตล์โค้ด

- TypeScript strict, ESM, import ภายใน core ไม่ใส่นามสกุลไฟล์
- ฟังก์ชันใน core รับ `readonly Candle[]` คืนค่าใหม่ ไม่ mutate input
- ชื่อตัวแปร/ฟังก์ชันภาษาอังกฤษ คอมเมนต์และข้อความ UI ภาษาไทยได้
- web ใช้ Tailwind + โทเคนสีตามหน้าที่ใน `apps/web/src/index.css` (bg, panel, field, hover, line, fg, fg-2, muted, faint, accent, bull, bear, ok, warn, bad) — มีธีมมืด/สว่าง ห้ามใช้สีตายตัวอย่าง `text-white` / `slate-*` ในหน้า
- ชิ้นส่วนที่ใช้ซ้ำ: class `btn` / `btn-primary` / `field` / `label` / `card` / `chip` / `seg` / `note-*` / `badge` / `switch` / `table` (index.css) และ `components/ui.tsx` (PageHeader, SidePanel, Section, Field, Empty, Stat, Note), ไอคอนเส้นใน `components/Icon.tsx`
- สีที่วาดบน canvas (กราฟ) อยู่ใน `theme.ts` (CHART_PALETTE) — แก้คู่กับ index.css
- ฟอนต์ IBM Plex Sans Thai (Google Fonts) · ตัวเลขใช้ `tabular-nums`

## การสื่อสาร

- ตอบเป็นภาษาไทย แบบเป็นกันเอง
- ถ้าเจอจุดที่ rules.md ไม่ครอบคลุม ให้ถามก่อนเดา
