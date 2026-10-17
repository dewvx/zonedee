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
npm run dev          # server (:3001) + web (:5173) พร้อมกัน
npm test             # เทสต์ทุก workspace (vitest)
npm run typecheck    # เช็ก type ทุก workspace
npm run build        # build web
```

## โครงสร้าง

```
packages/core/   ฟังก์ชันล้วน: types, indicators, structure, zones, risk (strategies มาใน Phase 6–7)
                 ไม่แตะ DB / network / DOM — ใช้ร่วมกันทั้งกราฟและ backtest
apps/server/     Express 5 — API + ดึง/เก็บข้อมูล
  src/app.ts         routes: /api/symbols, /api/candles (before = โหลดย้อนหลัง), POST /api/fetch
  src/fetch-runner.ts สั่งดึงจากในแอป (กันดึงซ้ำ symbol เดียวกัน)
  src/contract.ts    สเปกสัญญาสำหรับเครื่องคิด lot (MT5 --info, cache 1 นาที / ค่ามาตรฐาน XM)
  src/symbols.ts     รายชื่อ symbol + แหล่งข้อมูล (FOREX_SOURCE) + native TF ที่ดึงตรง
  src/store.ts       SQLite (node:sqlite) ตาราง candles(symbol, timeframe, time, ohlcv)
  src/ingest.ts      บันทึก native TF แล้ว resample TF ลูกเฉพาะช่วงที่เปลี่ยน
  src/fetchers/      yahoo (forex intraday + หุ้น D1), mt5 (เรียก tools/mt5 ผ่าน Python), dukascopy
tools/mt5/       สคริปต์ Python ดึงราคาจาก MT5 ของ XM (Windows) — ดู README ในโฟลเดอร์
data/            ไฟล์ SQLite + cache (ไม่ขึ้น git)
apps/web/        React 19 + Vite + Tailwind v4 + Lightweight Charts v5
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
```

## กฎเหล็ก

1. **ห้ามแอบดูอนาคต (no look-ahead)** — ฟังก์ชันใน core ที่ให้ผลที่แท่ง `i` ใช้ได้แค่แท่ง `0..i` swing ที่ใช้ `N` แท่งขวา ถือว่าเกิดที่แท่ง `j+N` ไม่ใช่ `j` ข้อมูล TF ใหญ่ใช้ได้หลังแท่งนั้นปิด ทุก detector ต้องมีเทสต์ "คำนวณจากข้อมูลบางส่วน = คำนวณจากข้อมูลทั้งหมด" (ดูตัวอย่างใน `packages/core/test/ema.test.ts`)
2. **ทำตาม `docs/rules.md`** — ก่อนเขียน/แก้ detector หรือท่าเทรด ให้ใช้ skill `technical-analysis` ถ้าต้องตีความเพิ่ม ให้อัปเดต rules.md ในตาราง "การตัดสินใจที่ค้าง" ด้วย อย่าตีความเงียบๆ ในโค้ด
3. **ค่าที่จูนได้ต้องอยู่ใน config** พร้อม default ตาม rules.md ห้าม hardcode ตัวเลขวิเศษ
4. **เวลา = UTC milliseconds** ทั้งโปรเจกต์ แปลงเป็นวินาทีเฉพาะตอนส่งให้ Lightweight Charts (`toChartTime`) แสดงผลเป็นเวลาไทย
5. **ระยะห่าง/ความกว้างโซนวัดเป็น × ATR** เพื่อให้ใช้ได้ทุกตลาด
6. **core ต้องมีเทสต์** — ทุก detector มี fixture ที่ทำมือ (รู้คำตอบแน่นอน) + เทสต์ no-look-ahead
7. **ทำทีละ phase** ตาม `docs/roadmap.md` แต่ละ phase ต้องรันดูผลได้ แล้วติ๊กใน roadmap

## สไตล์โค้ด

- TypeScript strict, ESM, import ภายใน core ไม่ใส่นามสกุลไฟล์
- ฟังก์ชันใน core รับ `readonly Candle[]` คืนค่าใหม่ ไม่ mutate input
- ชื่อตัวแปร/ฟังก์ชันภาษาอังกฤษ คอมเมนต์และข้อความ UI ภาษาไทยได้
- web ใช้ Tailwind utility ธีมมืด สีขึ้น `bull` (#22c55e) สีลง `bear` (#ef4444)

## การสื่อสาร

- ตอบเป็นภาษาไทย แบบเป็นกันเอง
- ถ้าเจอจุดที่ rules.md ไม่ครอบคลุม ให้ถามก่อนเดา
