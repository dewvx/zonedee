# ดึงราคาจาก MT5 ของ XM

ราคาจะตรงกับที่เทรดจริงบน XM และได้ M1 ย้อนหลังยาวกว่า Yahoo มาก

## ติดตั้ง (ครั้งเดียว)

1. **MT5 desktop ของ XM** — ดาวน์โหลดจากเว็บ XM แล้ว login (บัญชี demo ก็ได้ ข้อมูลราคาเหมือนกัน)
2. **ให้ MT5 เก็บประวัติยาวๆ** — `Tools > Options > Charts > Max bars in chart` ตั้งเป็น `Unlimited` แล้วปิดเปิด MT5 ใหม่
3. **Python 3** จาก python.org (ตอนติดตั้งติ๊ก *Add python.exe to PATH*) — เช็กด้วย `python --version`
   - แพ็กเกจ MetaTrader5 อาจยังไม่รองรับ Python เวอร์ชันใหม่ล่าสุดทันที ถ้า pip ติดตั้งไม่ได้ ให้ใช้เวอร์ชันก่อนหน้า
4. ติดตั้งแพ็กเกจ:
   ```powershell
   pip install -r tools/mt5/requirements.txt
   ```

## เช็กชื่อ symbol

ชื่อบน XM อาจต่างตามประเภทบัญชี (เช่น `GOLD`, `GOLD#`, `EURUSDm`) — เปิด MT5 ไว้แล้วรัน:

```powershell
python tools/mt5/mt5_export.py --list GOLD
python tools/mt5/mt5_export.py --list EURUSD
```

ถ้าชื่อไม่ตรงกับค่า `names.mt5` ใน `apps/server/src/symbols.ts` ให้แก้ตรงนั้น

## เปลี่ยน zonedee ให้ใช้ MT5

1. แก้ `apps/server/src/symbols.ts`: `export const FOREX_SOURCE = 'mt5'`
2. เปิด MT5 ค้างไว้ แล้วรัน (ลบข้อมูล Yahoo ของ forex ทิ้งก่อน กันราคาปนกัน):
   ```powershell
   npm run fetch -- --market forex --reset --days 30
   ```
3. ผ่านแล้วค่อยรัน `npm run fetch -- --market forex` เพื่อเติมย้อนหลังตามค่า default (180 วัน) — ครั้งต่อไปจะดึงต่อจากของเดิม

## ถ้าเจอปัญหา

| ข้อความ | แก้ |
|---|---|
| `เรียก Python ไม่ได้` | ติดตั้ง Python + PATH หรือตั้ง env `ZONEDEE_PYTHON` เช่น `$env:ZONEDEE_PYTHON="py"` |
| `ยังไม่ได้ติดตั้งแพ็กเกจ MetaTrader5` | `pip install -r tools/mt5/requirements.txt` |
| `เชื่อมต่อ MT5 ไม่ได้` | เปิด MT5 และ login ไว้ ถ้ามี MT5 หลายตัว ปิดตัวอื่น |
| `ไม่เจอ symbol` | ใช้ `--list` ดูชื่อจริง แล้วแก้ `symbols.ts` |
| ได้แท่งน้อยกว่าที่คิด | MT5 ยังโหลดประวัติไม่ครบ — เปิดกราฟ symbol นั้น TF M1 แล้วเลื่อนย้อนหลังสักพัก หรือเช็กข้อ 2 |

## เครื่องคิด lot ใช้ข้อมูลจาก MT5

ปุ่ม 📐 คำนวณ lot ในแอปจะเรียก `python tools/mt5/mt5_export.py --info GOLD` เพื่อเอาสเปกสัญญา (ขนาดสัญญา, มูลค่าต่อ tick, lot ขั้นต่ำ),
leverage, spread และยอดเงินของบัญชีที่ login อยู่ — ถ้า MT5 ปิดอยู่จะใช้ค่ามาตรฐานของบัญชี XM Standard แทน (แอปจะบอกที่ท้ายแผง)

## เรื่องเวลา

MT5 เก็บเวลาแท่งเป็นเวลาเซิร์ฟเวอร์ของโบรก XM ใช้แบบ New York close (GMT+2 หน้าหนาว / GMT+3 ช่วง US daylight saving)
สคริปต์แปลงเป็น UTC ให้แล้ว ถ้าใช้โบรกอื่นที่ออฟเซ็ตคงที่ ใส่ `--offset <ชั่วโมง>` ได้
ข้อควรรู้: แท่ง D1 ใน zonedee ตัดวันที่ 00:00 UTC จึงไม่ตรงกับ D1 ใน MT5 ที่ตัดตอน NY close (ดู D9 ใน `docs/rules.md`)
