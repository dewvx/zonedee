# คำสั่งสำหรับ Gemini: อ่าน CLAUDE.md ก่อนเริ่มงานเสมอ

เอกสาร Context และ Source of Truth หลักของโปรเจกต์ **zonedee** อยู่ที่ไฟล์ **`CLAUDE.md`** ที่ root ของโปรเจกต์

> **สำคัญมาก**: เมื่อเริ่ม session หรือรับคำสั่งใหม่ ให้เปิดอ่านและทำความเข้าใจไฟล์ **`CLAUDE.md`** ทั้งหมดก่อนเสมอทุกครั้ง

---

## 1. เอกสารอ้างอิงจริงในโปรเจกต์

เมื่ออ่าน `CLAUDE.md` แล้ว ให้ศึกษาเอกสารและโค้ดที่เกี่ยวข้องกับงานที่กำลังทำ:
- **`docs/rules.md`** — สเปกและกฎการเทรด (SMC, Detectors, Indicators) เป็น **Source of Truth** ของการคำนวณและ detector ทุกตัว
- **`docs/roadmap.md`** — แผนพัฒนา (Phase ต่างๆ) และสถานะฟีเจอร์ ให้ทำทีละ Phase และอัปเดตสถานะเมื่อทำเสร็จ
- **`docs/backlog.md`** — แผนงานและสเปกฟีเจอร์ที่ต้องทำต่อ (TASK-01 เป็นต้นไป) เป็น Source of Truth เมื่อผู้ใช้สั่งงานต่อ
- **`README.md`** — ภาพรวมของระบบและคู่มือการใช้งานเบื้องต้น
- **`.claude/skills/technical-analysis/`** — คู่มือ/ความรู้การวิเคราะห์ทางเทคนิคสำหรับอ้างอิง

---

## 2. กฎเหล็กและข้อห้ามสำคัญ

1. **เครื่องมือวิเคราะห์เท่านั้น**: ห้ามเขียนโค้ดส่งคำสั่งซื้อขายจริง (Live Order) ไปยังโบรกเกอร์เด็ดขาด
2. **ห้ามแอบดูอนาคต (No Look-Ahead)**: ฟังก์ชันใน `packages/core/` ที่แท่ง `i` ใช้ข้อมูลได้แค่แท่ง `0..i` เท่านั้น ห้ามรั่วไหลข้อมูลอนาคต และต้องเขียน test ตรวจสอบเสมอ
3. **เวลาใช้ UTC Milliseconds**: ข้อมูลเวลาทั้งหมดในระบบเก็บเป็น UTC ms (แปลงเป็นเวลาไทยเฉพาะตอนแสดงผลใน UI ผ่าน `toChartTime`)
4. **ทำตาม `docs/rules.md`**: ห้ามคิดกฎหรือตัวเลขเองโดยพลการ ค่าที่ปรับจูนได้ต้องอยู่ใน Config พร้อม default value ตามที่ rules.md กำหนด
5. **Core มี Unit Test เสมอ**: ทุก detector และ strategy ต้องมี fixture และ test ให้ครอบคลุม

---

## 3. มาตรฐาน UI / Frontend

โปรเจกต์นี้ไม่มีไฟล์ `docs/DESIGN_SYSTEM.md` แยกเดี่ยว — UI และดีไซน์ทั้งหมดถูกกำหนดไว้ใน `CLAUDE.md` และโค้ดดังนี้:
- **Tokens & Colors**: ดูที่ `apps/web/src/index.css` ใช้โทเคนสีตามหน้าที่ (เช่น `bg`, `panel`, `field`, `fg`, `accent`, `bull`, `bear`) มีธีมมืด/สว่าง **ห้าม hardcode สีตายตัว** เช่น `text-white` หรือ Tailwind slate palette
- **Canvas Chart Colors**: ดูที่ `apps/web/src/theme.ts` (`CHART_PALETTE`) ต้องสอดคล้องกับ `index.css`
- **Reused Components**: ใช้คลาสมาตรฐานใน `index.css` (`btn`, `card`, `chip`, ฯลฯ) และคอมโพเนนต์ร่วมใน `apps/web/src/components/ui.tsx`

---

## 4. Single Source of Truth

- **ห้ามแก้ไข Tech Stack, Coding Convention หรือ Architecture ในไฟล์นี้**
- หากต้องการปรับปรุงข้อกำหนดหรือ Architecture ให้แก้ไขที่ไฟล์ **`CLAUDE.md`** เท่านั้น เพื่อให้ AI ทุกตัว (Claude, Gemini, ฯลฯ) ปฏิบัติตรงกัน

---

## 5. การสื่อสาร

- ตอบกลับผู้ใช้เป็น **ภาษาไทย** ด้วยน้ำเสียงเป็นกันเอง ชัดเจน ตรงประเด็น
- หากพบเงื่อนไขที่ `docs/rules.md` หรือ `CLAUDE.md` ยังไม่ครอบคลุม ให้สอบถามผู้ใช้ก่อนคาดเดาเอง
