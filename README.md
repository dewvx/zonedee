# zonedee

แอปดูกราฟ forex / ทอง / หุ้นนอก ไว้ใช้เอง — แนวรับแนวต้านอัตโนมัติ, โครงสร้างราคาแบบ SMC, เครื่องคิด lot และ backtest ท่าจากไฟล์ริวเรน / Braron

## เริ่มใช้

ต้องมี Node.js 22.13 ขึ้นไป (แนะนำ 24 LTS)

```bash
npm install
npm run fetch      # ดึงราคาจริง (ครั้งแรกใช้เวลาสักพัก)
npm run dev
```

แล้วเปิด http://localhost:5173

## ในแอปมีอะไร (เมนูซ้าย)

| หน้า | ทำอะไร |
|---|---|
| 📈 **กราฟ** | แท่งเทียน M1–W1 (เวลาไทย) · แนวรับต้านอัตโนมัติ (R/S/RBS/SBR) + **แนวรับต้านหลัก** แบบง่าย · BOS/CHoCH · กรอบ Bo buy/sell (+ TF ใหญ่ตามชุด Braron) · FVG · OB · Sweep · EMA 9/21 · **📐 คำนวณ lot** (คลิกวาง Entry/SL/TP ลากปรับได้) → **📓 บันทึกลง Journal** พร้อมรูปกราฟ |
| 🧪 **Backtest** | 7 ท่าจากไฟล์ (EMA Cross, sk Fibo, Bo 3 TF, CRT, FVG + Sweep, RBS/SBR, OB + MSS) ปรับค่าได้ · ผลเป็น R, เส้น equity, in/out-of-sample, เทียบการเข้าแบบสุ่ม · คลิกดูทุกเทรดบนกราฟ · **เทียบทุกท่า** |
| 🎯 **Replay** | ซ่อนแท่งอนาคต ทาย BUY/SELL แล้วเฉลย — สุ่มจุดทั่วไป หรือจุดที่ท่าเกิดสัญญาณ (เทียบกับที่ท่าทำ) · เก็บคะแนน |
| 📓 **Journal** | จดทุกไม้: เหตุผล, อารมณ์, ทำตามแผนไหม, บทเรียน, รูป (Ctrl+V วางได้) · R คิดให้ · สถิติแยกตามท่า |
| 🔔 **แจ้งเตือน** | เตือนเมื่อท่าเกิดสัญญาณ, ราคาถึงระดับ, ใกล้/หลุด/ทะลุแนวรับต้าน หรือก่อนวันประกาศงบ → ในแอป + เด้งบนเครื่อง + **LINE** |
| 🔎 **สแกน** | โหมดหุ้นซิ่ง: volume พุ่ง, gap, ทะลุกรอบ, BOS · โหมดหุ้นลงทุน: หุ้นใหญ่ + ETF 100 ตัว หาตัวที่ใกล้แนวรับ / ทะลุแนวต้าน |
| ⭐ **ลงทุน** | watchlist หุ้น/ETF ใน Dime: ผลตอบแทน, MA50/200, RSI, **แนวรับต้านใกล้สุด**, **วันประกาศงบ**, มูลค่า/กำไรพอร์ต, **จัดพอร์ตตามเป้า %** (แบ่งเงิน DCA) |

ในหน้ากราฟกดปุ่ม **อัปเดต** เพื่อดึงข้อมูลล่าสุดของ symbol ที่เปิดอยู่ หรือติ๊ก **อัตโนมัติ** (forex ทุก 1 นาที / หุ้นทุก 5 นาที) เลื่อนกราฟไปทางซ้ายเพื่อโหลดแท่งเก่าเพิ่ม · หน้าแจ้งเตือนทำงานตอนเปิด `npm run dev` ค้างไว้เท่านั้น

### ดึงข้อมูล

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run fetch` | ทุก symbol — ต่อจากข้อมูลเดิม (ครั้งแรกเอาเท่าที่แหล่งข้อมูลให้ / หุ้น 5 ปี) |
| `npm run fetch -- --symbol XAUUSD` | เฉพาะตัวที่เลือก (คั่นด้วย `,` ได้) |
| `npm run fetch -- --market forex` | เฉพาะ forex (หรือ `us-stock`) |
| `npm run fetch -- --days 14` | ครั้งแรกเอาย้อนหลังแค่ 14 วัน (ลองเร็วๆ) |
| `npm run fetch -- --from 2025-01-01` | บังคับดึงตั้งแต่วันที่นี้ |
| `npm run fetch -- --reset` | ลบข้อมูลเดิมของ symbol ที่เลือกก่อนดึง (ใช้ตอนเปลี่ยนแหล่งข้อมูล) |

- forex/ทอง: ค่าเริ่มต้นใช้ Yahoo (ใช้ได้ทันที แต่ทองเป็น futures GC=F และ M1 ย้อนหลังสั้น)
  อยากได้ราคาตรงกับ XM → ทำตาม [`tools/mt5/README.md`](tools/mt5/README.md)
- หุ้น US: Yahoo Finance แท่ง D1 (API ไม่ทางการ อาจพังได้เป็นครั้งคราว)
- เพิ่ม symbol / เปลี่ยนแหล่งข้อมูลได้ที่ `apps/server/src/symbols.ts`

### Backtest จาก command line

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run backtest -- --list` | ดูท่าทั้งหมด + ค่าที่ปรับได้ |
| `npm run backtest -- --symbol XAUUSD --tf M5 --strategy sk-fibo` | รันท่าเดียว |
| `npm run backtest -- --tf M5 --strategy sk-fibo --param entryLevel=0.786` | ปรับค่าของท่า (ใส่ `--param` ซ้ำได้) |
| `npm run backtest -- --tf M15 --all` | เทียบทุกท่า |
| `... --spread 35 --from 2026-09-01 --swing 5 --trades` | spread (points), ช่วงวันที่, swing, พิมพ์ทุกเทรด |

### แจ้งเตือน LINE (ทำครั้งเดียว)

LINE Notify ปิดบริการไปแล้ว — ใช้ LINE Official Account + Messaging API แทน (ฟรี มีโควต้าข้อความต่อเดือน)

1. สร้าง LINE Official Account ที่ [manager.line.biz](https://manager.line.biz)
2. ในหน้า OA → ตั้งค่า → Messaging API → เปิดใช้งาน
3. ที่ [developers.line.biz](https://developers.line.biz) → channel ของ OA → แท็บ **Messaging API** → ออก **Channel access token**
4. แท็บ **Basic settings** → คัดลอก **Your user ID** (ขึ้นต้นด้วย `U`)
5. แอด OA ของตัวเองเป็นเพื่อน (สแกน QR ในแท็บ Messaging API)
6. คัดลอก `.env.example` เป็น `.env` ใส่ค่าทั้งสอง แล้วเปิด `npm run dev` ใหม่ → หน้า 🔔 กด **ส่งทดสอบ**

แอปจำกัดไว้ 30 ข้อความ/วันกันโควต้าหมด · ส่งหาตัวเองเท่านั้น ไม่ได้ส่งคำสั่งซื้อขาย

## เอกสาร

- [`CLAUDE.md`](CLAUDE.md) — ภาพรวมและกฎของโปรเจกต์ (Claude Code อ่านไฟล์นี้ทุกครั้ง)
- [`docs/rules.md`](docs/rules.md) — สเปกกฎการเทรดจากไฟล์ริวเรน / Braron
- [`docs/roadmap.md`](docs/roadmap.md) — phase ต่างๆ และสถานะ

## หมายเหตุ

กราฟใช้ [Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) ของ TradingView (Apache 2.0)
แอปนี้เป็นเครื่องมือช่วยวิเคราะห์ ไม่ใช่คำแนะนำการลงทุน และไม่ส่งคำสั่งซื้อขายอัตโนมัติ
