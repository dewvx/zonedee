# แผนงานและข้อกำหนดฟีเจอร์ที่ต้องทำต่อ (Feature Backlog)

> เอกสารนี้เป็น **Source of Truth** สำหรับฟีเจอร์ที่วางแผนจะพัฒนาต่อในโปรเจกต์ **zonedee**  
> เมื่อต้องการเริ่มงาน ให้สั่ง AI โดยอ้างอิงรหัส Task เช่น:  
> *"ทำ TASK-01 จาก docs/backlog.md"* หรือ *"เริ่มทำระบบ Hotkeys ตาม TASK-02"*

---

## สารบัญงาน (Tasks Overview)

| รหัส | ชื่อฟีเจอร์ | หมวดหมู่ | ความสำคัญ | สถานะ |
|---|---|---|---|---|
| **TASK-01** | ปรับเวลาตัดแท่ง Daily ตาม NY Close (17:00 NY) | Forex / Trading Data | สูง | ✅ เสร็จสิ้น |
| **TASK-02** | Hotkeys / คีย์ลัดบนหน้ากราฟและโหมด Replay | UI / UX Usability | สูง | 🟡 รอดำเนินการ |
| **TASK-03** | ปฏิทินบันทึกการเทรดใน Journal (Trade Calendar) | Trading Journal | กลาง | 🟡 รอดำเนินการ |
| **TASK-04** | ท่าเทรดใหม่: ท่า 4 AMD (Accumulation, Manipulation, Distribution) | SMC Strategy | กลาง-สูง | 🟡 รอดำเนินการ |
| **TASK-05** | เครื่องมือจูนพารามิเตอร์อัตโนมัติ (Grid Search Optimization) | Backtest Engine | กลาง | 🟡 รอดำเนินการ |
| **TASK-06** | คำนวณต้นทุน Swap ข้ามคืน (Overnight Swap) | Risk & Backtest | ปานกลาง | 🟡 รอดำเนินการ |
| **TASK-07** | Walk-Forward Analysis & Multi-Pair Backtesting | Advanced Backtest | ปานกลาง | 🟡 รอดำเนินการ |

---

## รายละเอียดแต่ละ Task

### TASK-01: ปรับเวลาตัดแท่ง Daily ตาม NY Close (17:00 NY)
- **อ้างอิงกฎ**: [docs/rules.md ข้อ D9](file:///d:/zonedee/docs/rules.md#L226)
- **ปัญหา**: ปัจจุบันแท่ง Daily (D1) ของระบบตัดที่ `00:00 UTC` ซึ่งในตลาด Forex/ทองคำระดับสากล โบรกเกอร์ส่วนใหญ่ (รวมถึง XM ใน MT5) จะตัดแท่งวันตอนตลาด New York ปิด คือเวลา `17:00 NY Time` ทำให้รูปทรงแท่ง Day บนกราฟและใน Backtest ไม่ตรงกับ MT5 ของจริง 100%
- **ข้อกำหนด (Specs)**:
  1. เพิ่มตัวเลือก Timezone Cutoff สำหรับแท่ง D1 ของตลาด Forex: เลือกระหว่าง `UTC (00:00)` (ค่าเดิม) หรือ `NY Close (17:00 NY / ตี 4-ตี 5 ไทย)`
  2. ใน [`packages/core/src/resample.ts`](file:///d:/zonedee/packages/core/src/resample.ts): ปรับฟังก์ชัน `bucketStart` และ `resample` ให้รองรับ offset เวลาของ NY Close (คำนึงถึง Daylight Saving Time: EDT UTC-4 ในฤดูร้อน, EST UTC-5 ในฤดูหนาว)
  3. เมื่อเลือกโหมด NY Close ให้แท่ง D1 ที่แสดงบนกราฟและในเครื่องคิดเลขเทียบเคียงได้กับ MT5
- **ไฟล์ที่ต้องแก้ไข**:
  - `packages/core/src/resample.ts` & `packages/core/test/resample.test.ts`
  - `apps/server/src/symbols.ts`
  - `apps/web/src/views/ChartView.tsx`
- **เกณฑ์การตรวจรับ (Acceptance Criteria)**:
  - Unit test ตรวจสอบการตัดแท่ง D1 ทั้งแบบ UTC และแบบ NY Close ได้ถูกต้อง 100%
  - กราฟแท่ง D1 ของ XAUUSD เมื่อเปิดโหมด NY Close มีราคาเปิด-ปิด และ High-Low ตรงกับ MT5 ของ XM

---

### TASK-02: Hotkeys / คีย์ลัดบนหน้ากราฟและโหมด Replay
- **เป้าหมาย**: เพิ่มความเร็วและความสะดวกในการดูกราฟและฝึกฝนเทรดโดยไม่ต้องละมือไปคลิกเมาส์
- **ข้อกำหนด (Specs)**:
  1. **คีย์ลัดบนหน้ากราฟ (`ChartView.tsx`)**:
     - กดตัวเลข `1` -> สลับไป `M1`
     - กดตัวเลข `5` -> สลับไป `M5`
     - กดตัวเลข `15` -> สลับไป `M15`
     - กดตัวเลข `30` -> สลับไป `M30`
     - กดตัวเลข `6` หรือ `H` -> สลับไป `H1`
     - กดตัวเลข `4` -> สลับไป `H4`
     - กดตัวเลข `D` -> สลับไป `D1`
     - กดตัวเลข `W` -> สลับไป `W1`
     - กด `E` -> สลับเปิด/ปิด EMA 9/21
     - กด `L` -> สลับเปิด/ปิด แถบโครงสร้างราคา (LayerBar)
  2. **คีย์ลัดในโหมด Replay (`ReplayView.tsx`)**:
     - กด `Spacebar` หรือ `ArrowRight` -> เดินแท่งถัดไปทีละ 1 แท่ง (Next Candle)
     - กด `B` -> ส่งคำสั่งจำลอง BUY
     - กด `S` -> ส่งคำสั่งจำลอง SELL
     - กด `N` หรือ `X` -> สั่งข้าม (Skip / ไม่เทรด)
     - กด `R` -> สุ่มจุดเริ่มใหม่ (New Random Point)
  3. ป้องกันการลั่นของคีย์ลัด: ต้องไม่ทำงานหากโฟกัสอยู่ในช่องกรอกข้อความ (`<input>`, `<textarea>`)
- **ไฟล์ที่ต้องแก้ไข**:
  - `apps/web/src/views/ChartView.tsx`
  - `apps/web/src/views/ReplayView.tsx`
  - เพิ่มแถบคำแนะนำคีย์ลัด (Tooltip / Hotkey badge) เล็กๆ เพื่อให้ผู้ใช้ทราบ
- **เกณฑ์การตรวจรับ**:
  - กดปุ่มแป้นพิมพ์แล้ว Timeframe เปลี่ยนทันทีกราฟไม่อืด
  - โหมด Replay สามารถฝึกเคาะแท่งเทียนด้วย Spacebar และกดปุ่ม B/S ได้อย่างราบรื่น

---

### TASK-03: ปฏิทินบันทึกการเทรดใน Journal (Trade Calendar View)
- **เป้าหมาย**: เพิ่มมุมมองปฏิทินรายเดือนในหน้าบันทึกการเทรด (Journal) เพื่อเห็นภาพรวมวินัยการเทรด วันที่ได้กำไร/ขาดทุน และผลตอบแทนสะสม
- **ข้อกำหนด (Specs)**:
  1. ในหน้า [`apps/web/src/views/JournalView.tsx`](file:///d:/zonedee/apps/web/src/views/JournalView.tsx) เพิ่มแท็บสลับมุมมอง: `รายการ (List)` vs `ปฏิทิน (Calendar)`
  2. **ตารางปฏิทิน (Month Grid)**:
     - แสดงเดือนปัจจุบัน สามารถเลื่อนเดินหน้า/ถอยหลังดูเดือนก่อนหน้าได้
     - แต่ละช่องวัน:
       - แสดงจำนวนไม้ที่เทรดในวันนั้น
       - ผลรวม R ของวันนั้น เช่น `+3.2R` (พื้นหลังสีเขียวจาง) หรือ `-1.0R` (พื้นหลังสีแดงจาง)
       - ถ้าไม่มีการเทรด ให้แสดงเป็นช่องว่างปกติ
     - แถวสรุปประจำสัปดาห์ (Weekly Total R) ด้านขวาของแต่ละสัปดาห์
     - แถบสรุปประจำเดือน (Monthly Win rate, Total R, Average R per trade)
  3. เมื่อคลิกที่วันใดวันหนึ่งในปฏิทิน: กรองรายการเทรดด้านล่างให้แสดงเฉพาะออเดอร์ของวันนั้น
- **ไฟล์ที่ต้องแก้ไข**:
  - สร้างคอมโพเนนต์ `apps/web/src/components/JournalCalendar.tsx`
  - `apps/web/src/views/JournalView.tsx`
- **เกณฑ์การตรวจรับ**:
  - คิดคำนวณผลรวม R แยกตามวันและสัปดาห์ถูกต้องตาม Timezone ไทย
  - Responsive รองรับหน้าจอคอมพิวเตอร์และมือถือ ใช้งานง่าย

---

### TASK-04: ท่าเทรดใหม่: ท่า 4 AMD (Accumulation, Manipulation, Distribution)
- **อ้างอิงกฎ**: [docs/rules.md ข้อ D6](file:///d:/zonedee/docs/rules.md#L81)
- **สเปกและขั้นตอนการทำงาน**:
  1. **Phase 1 (Accumulation)**:
     - กำหนดช่วงสะสมราคาโดยใช้ Session: **Asian Session (00:00 - 07:00 UTC)** หรือช่วงที่ราคาเคลื่อนไหวในกรอบแคบ (ความกว้างกรอบ ≤ N × ATR)
     - บันทึก `Asian High` และ `Asian Low`
  2. **Phase 2 (Manipulation / Sweep)**:
     - ช่วงเปิดตลาด London (07:00 - 11:00 UTC):
     - ฝั่ง Buy: ราคาทำไส้แลบทะลุใต้ `Asian Low` แล้วปิดกลับเข้ามา (Liquidity Sweep)
     - ฝั่ง Sell: ราคาทำไส้แลบทะลุเหนือ `Asian High` แล้วปิดกลับเข้ามา
  3. **Phase 3 (Distribution / Entry)**:
     - ใน TF เล็ก (M1–M5) เกิด Market Structure Shift (MSS) หรือ CHoCH ในทิศทางกลับตัว
     - จุดเข้า: Market หรือ Limit ที่โซน FVG / RBS ของขาที่เบรกกลับตัว
     - SL: ปลายไส้สุดที่ทำ Manipulation (Sweep)
     - TP: ฝั่งตรงข้ามของ Asian Range หรือ R:R ขั้นต่ำ 2:1
- **ไฟล์ที่ต้องแก้ไข**:
  - สร้างกลยุทธ์ใน `packages/core/src/strategies/amd.ts`
  - เพิ่มใน `packages/core/src/strategies/index.ts`
  - สร้าง Unit Test ใน `packages/core/test/strategies.test.ts`
- **เกณฑ์การตรวจรับ**:
  - เป็น causal 100% มีเทสต์ no-look-ahead ผ่าน
  - แสดงผลในหน้า Backtest และสามารถรันเปรียบเทียบกับท่าอื่นๆ ได้

---

### TASK-05: เครื่องมือจูนพารามิเตอร์อัตโนมัติ (Grid Search Optimization)
- **อ้างอิงกฎ**: [docs/rules.md ข้อ D1–D16](file:///d:/zonedee/docs/rules.md#L214)
- **เป้าหมาย**: รัน Backtest หลายตัวแปรพร้อมกันเพื่อหาค่าที่ดีที่สุดของแต่ละท่าบนข้อมูลจริงระยะยาว
- **ข้อกำหนด (Specs)**:
  1. ในหน้า Backtest (`BacktestView.tsx`) หรือผ่าน CLI (`npm run backtest -- --tune`):
  2. รองรับการระบุช่วงของตัวแปร เช่น:
     - `swingLength: [2, 3, 5]`
     - `breakBy: ['close', 'wick']`
     - `rr: [1.5, 2.0, 2.5, 3.0]`
  3. รันทุก Combination แบบ Multi-run แล้วแสดงตารางเปรียบเทียบ:
     - Expectancy (R)
     - Win Rate %
     - จำนวนเทรดทั้งหมด
     - Max Drawdown (R)
     - Out-of-sample Performance %
  4. ไฮไลต์ Combination ที่ดีที่สุดและมีนัยสำคัญทางสถิติ (Random Baseline Percentile ≥ 95%) เพื่อนำไปอัปเดตค่า default ใน `rules.md`
- **ไฟล์ที่ต้องแก้ไข**:
  - `packages/core/src/backtest/`
  - `apps/server/src/backtest.ts`
  - `apps/web/src/views/BacktestView.tsx`

---

### TASK-06: คำนวณต้นทุน Swap ข้ามคืน (Overnight Swap)
- **เป้าหมาย**: เพิ่มความแม่นยำในการคำนวณกำไร/ขาดทุนสุทธิกรณีถือออเดอร์ข้ามวัน
- **ข้อกำหนด (Specs)**:
  1. ดึงค่า `swapLong`, `swapShort`, และ `swapType` จาก MT5 Info ผ่าน [`apps/server/src/contract.ts`](file:///d:/zonedee/apps/server/src/contract.ts)
  2. คำนวณดอกเบี้ย Swap ตามจำนวนคืนที่ถือ (รวมการคิด 3-Day Swap ในคืนวันพุธสำหรับ Forex/ทอง)
  3. สะท้อนในหน้าคำนวณ Lot (`RiskPanel.tsx`) และใน Backtest Engine
- **เกณฑ์การตรวจรับ**:
  - ไม้ที่ถือข้ามวันมีค่า Swap หักลบจากผลลัพธ์ R หรือยอดเงินตามความเป็นจริง

---

### TASK-07: Walk-Forward Analysis & Multi-Pair Backtesting
- **เป้าหมาย**: ทดสอบความทนทานของกลยุทธ์กับหลายตลาดและหลายช่วงเวลา
- **ข้อกำหนด (Specs)**:
  1. **Walk-Forward**: แบ่งข้อมูลเป็นหน้าต่างเลื่อน (Sliding Windows) เช่น Train 6 เดือน / Test 2 เดือน เลื่อนไปเรื่อยๆ เพื่อตรวจสอบว่าท่าเทรดยังกำไรสม่ำเสมอหรือไม่
  2. **Multi-Pair**: รันท่าเดียวพร้อมกันกับหลายคู่เงิน (เช่น XAUUSD, EURUSD, GBPUSD, USDJPY) แล้วรวมเป็นพอร์ตโฟลิโอเดียว

---

## วิธีส่งคำสั่งให้ AI เริ่มทำงานในครั้งถัดไป

เมื่อต้องการหยิบงานใดมาทำ ให้สั่ง AI ด้วยข้อความสั้นๆ เช่น:
```text
ทำ TASK-01 จาก docs/backlog.md
```
หรือ
```text
ช่วยทำ TASK-02 (Hotkeys) ตามสเปกใน docs/backlog.md ให้หน่อยครับ
```
