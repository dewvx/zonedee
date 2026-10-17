---
name: technical-analysis
description: ใช้ทุกครั้งที่เขียน แก้ หรือรีวิว detector / indicator / ท่าเทรดใน packages/core — swing, แนวรับต้าน, BOS, CHoCH/MSS, FVG, OB, sweep, RBS/SBR, CRT, Fibo, Bo buy/Bo sell, EMA, ATR, risk/lot — หรือเมื่อผู้ใช้ถามว่าท่าในไฟล์ริวเรน/Braron ทำงานยังไง
---

# Technical Analysis (zonedee)

skill นี้ทำให้ detector ทุกตัวตรงกับสเปกเดียวกัน และไม่แอบดูอนาคต

## ก่อนเริ่ม

1. อ่าน `docs/rules.md` ส่วนที่เกี่ยวข้อง — นี่คือ source of truth ไม่ใช่ความรู้ SMC ทั่วไป (แต่ละสำนักนิยามไม่ตรงกัน เราใช้เวอร์ชันของ rules.md)
2. เช็กตาราง "การตัดสินใจที่ค้าง" (D1–D10) ว่างานนี้ไปแตะข้อไหน ถ้าแตะข้อที่เขียนว่า **ถามเจ้าของ** → หยุดถามก่อน
3. ดูว่ามี primitive ที่ต้องใช้อยู่แล้วหรือยัง (`packages/core/src/`) ใช้ซ้ำ ห้ามเขียนใหม่ซ้อน

## ที่อยู่ของโค้ด

```
packages/core/src/
  types.ts            Candle, Timeframe, TIMEFRAME_MS
  indicators/         ema, atr, ...            (คืน (number|null)[] ยาวเท่า input)
  structure/          swings, bos, fvg, ob, sweep, equal-bodies
  zones/              แนวรับต้าน + สถานะโซน
  strategies/         ท่าเทรด (ท่า 1–8, bo-box, sk-fibo) — คืน Signal[]
  risk/               lot size, R:R
  config.ts           ค่า default ทั้งหมด (ชื่อตรงกับ rules.md)
```

## สัญญา (contract) ของ detector

- input: `readonly Candle[]` (+ config) — ห้าม mutate
- output: event ที่มี `index` = **แท่งที่รู้ผลได้จริง** (confirmIndex) ไม่ใช่แท่งที่เกิดรูปแบบ
  - เช่น swing high ที่แท่ง `j` ด้วย `swingLength = N` → `{ pivotIndex: j, confirmIndex: j + N }`
- ค่าตัวเลขทุกตัวมาจาก config ที่มี default ตาม rules.md
- ระยะห่างวัดเป็น `× ATR(14)` ณ แท่งที่ยืนยัน
- multi-TF: map แท่ง HTF เข้า LTF ด้วยเวลาปิดของแท่ง HTF (`time + TIMEFRAME_MS[tf]`) เท่านั้น

## ขั้นตอนเขียน detector ใหม่ (TDD)

1. **ทำ fixture มือ** — แท่งเทียนสั้นๆ 10–30 แท่งที่รู้คำตอบแน่นอน วาดเป็น comment ASCII ให้คนอ่านเข้าใจ
2. **เขียนเทสต์ก่อน** ใน `packages/core/test/<name>.test.ts`:
   - กรณีเจอ / กรณีไม่เจอ / กรณีขอบ (tolerance พอดี, ข้อมูลไม่พอ)
   - **no-look-ahead test** (บังคับทุกตัว):
     ```ts
     const full = detect(candles, cfg);
     for (const cut of [/* หลายจุด */]) {
       const partial = detect(candles.slice(0, cut + 1), cfg);
       // event ที่ confirmIndex <= cut ต้องเหมือนกันเป๊ะ
       expect(partial.filter(e => e.confirmIndex <= cut))
         .toEqual(full.filter(e => e.confirmIndex <= cut));
     }
     ```
3. รัน `npm test` ให้แดงก่อน → เขียนโค้ด → เขียว
4. export จาก `packages/core/src/index.ts`
5. ถ้าต้องตีความอะไรที่ rules.md ไม่ได้บอก → เพิ่มลงตาราง "การตัดสินใจที่ค้าง" ใน rules.md
6. `npm run typecheck`

## สรุปเร็ว (รายละเอียดเต็มอยู่ใน rules.md)

| คำ | ความหมายสั้น |
|---|---|
| เนื้อเท่ากัน | ขอบ body 2 แท่งติดกันเท่ากัน (± `equalTolAtr × ATR`) — กฎหลักของริวเรน |
| OC | ระดับรอยต่อของคู่เนื้อเท่ากัน (เขียว→แดง = sell, แดง→เขียว = buy) |
| BOS / CHoCH | ทะลุ swing ตามเทรนด์ / สวนเทรนด์ (ครั้งแรก) — ปิดทะลุ (D3) |
| RBS / SBR | แนวต้านโดนทะลุ→กลายเป็นแนวรับ (buy) / กลับกัน (sell) |
| Sweep | ไส้ทะลุ แต่ปิดกลับเข้ามา |
| FVG | `high[i-2] < low[i]` (bullish) |
| `ltfConfirm` | ที่ TF เล็ก ต้องเห็น CHoCH/MSS แล้วตามด้วย BOS ก่อนเข้า (โครงสร้างหน้า 8) |
| sk Fibo | หลัง BOS: buy1 = 0.5–0.618, buy2 = 0.786–0.886, TP = ext 1.618–2.0 |
| Bo buy/sell | กรอบ = โซน "เบรกแล้วรอทดสอบ": จาก swing ที่ถูกเบรก ถึงฐานที่ส่งราคาไปเบรก (ไส้) · 3 TF: buy = เขียว 2 แดง 1 (D5 ✅) |
| โซน R/S | `computeZones` — รวม swing ใกล้กัน, fresh→tested→flipped (RBS/SBR)→ทิ้ง, แบ่งโควต้าเหนือ/ใต้ราคา |
| โครงสร้าง (มีแล้ว) | `detectStructure` (BOS/CHoCH + ฐานของขา), `detectBoBoxes`, `detectFVGs`, `detectOrderBlocks`, `detectSweeps` — ทุกตัวรับ `(candles, cfg, asOf)` |
| Risk (มีแล้ว) | `calcPosition({ spec, balance, riskPct, entry, sl, tp, spreadPoints, leverage })` — ใช้ซ้ำในท่าเทรด/backtest อย่าเขียนสูตร lot ใหม่ |

## ห้าม

- ห้ามใช้ `candles[i + k]` (k > 0) ตอนตัดสินผลที่แท่ง `i`
- ห้าม normalize / คำนวณสถิติด้วยข้อมูลทั้งชุดก่อนวนลูป (เช่น max ของทั้งกราฟ)
- ห้ามโค้ดส่งคำสั่งซื้อขายจริง
