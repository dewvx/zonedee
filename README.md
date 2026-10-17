# zonedee

แอปดูกราฟ forex / ทอง / หุ้นนอก ไว้ใช้เอง — แนวรับแนวต้านอัตโนมัติ, โครงสร้างราคาแบบ SMC, เครื่องคิด lot และ (เร็วๆ นี้) backtest

## เริ่มใช้

ต้องมี Node.js 22.13 ขึ้นไป (แนะนำ 24 LTS)

```bash
npm install
npm run fetch      # ดึงราคาจริง (ครั้งแรกใช้เวลาสักพัก)
npm run dev
```

แล้วเปิด http://localhost:5173

**ในแอปมีอะไร:** กราฟแท่งเทียน M1–W1 (เวลาไทย) · แนวรับแนวต้านอัตโนมัติ (R/S/RBS/SBR) · BOS/CHoCH · กรอบ Bo buy/sell (+ TF ใหญ่ตามชุดของ Braron) · FVG · OB · Sweep · EMA 9/21 · **📐 คำนวณ lot** (คลิกวาง Entry/SL/TP บนกราฟ ลากปรับได้)

ในแอปกดปุ่ม **อัปเดต** เพื่อดึงข้อมูลล่าสุดของ symbol ที่เปิดอยู่ หรือติ๊ก **อัตโนมัติ** (forex ทุก 1 นาที / หุ้นทุก 5 นาที) เลื่อนกราฟไปทางซ้ายเพื่อโหลดแท่งเก่าเพิ่ม

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

## เอกสาร

- [`CLAUDE.md`](CLAUDE.md) — ภาพรวมและกฎของโปรเจกต์ (Claude Code อ่านไฟล์นี้ทุกครั้ง)
- [`docs/rules.md`](docs/rules.md) — สเปกกฎการเทรดจากไฟล์ริวเรน / Braron
- [`docs/roadmap.md`](docs/roadmap.md) — phase ต่างๆ และสถานะ

## หมายเหตุ

กราฟใช้ [Lightweight Charts™](https://www.tradingview.com/lightweight-charts/) ของ TradingView (Apache 2.0)
แอปนี้เป็นเครื่องมือช่วยวิเคราะห์ ไม่ใช่คำแนะนำการลงทุน และไม่ส่งคำสั่งซื้อขายอัตโนมัติ
