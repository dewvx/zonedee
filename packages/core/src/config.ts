/**
 * ค่า default ของ detector ทั้งหมด — ชื่อตรงกับ docs/rules.md
 * ทุกค่าปรับได้ (ส่ง Partial<...> เข้าฟังก์ชัน) อย่า hardcode ตัวเลขในโค้ด detector
 */
export const DEFAULTS = {
  atrPeriod: 14,
  /** D1: จำนวนแท่งซ้าย/ขวาของ swing */
  swingLength: 3,
  /** D2: tolerance ของ "เนื้อเท่ากัน" (× ATR) */
  equalTolAtr: 0.05,
  /** D3: ทะลุ = ปิดทะลุ ('close') หรือไส้ทะลุ ('wick') */
  breakBy: 'close' as 'close' | 'wick',
  /** รวม swing ที่ห่างกันไม่เกินนี้เป็นโซนเดียว (× ATR) */
  zoneMergeAtr: 0.3,
  /** ความกว้างขั้นต่ำของโซน (× ATR) */
  zoneWidthAtr: 0.15,
  /** แสดงโซนสูงสุดกี่โซน */
  maxZones: 8,
  /** true = เอาเฉพาะโซนที่มีคู่ "เนื้อเท่ากัน" (สไตล์ริวเรน) */
  ryuMode: false,
  /** FVG ต้องกว้างอย่างน้อยกี่เท่าของ ATR (กันช่องจิ๋ว) */
  fvgMinAtr: 0.1,
  /** OB นับเมื่อราคาวิ่งจาก OB ถึงแท่งเบรกอย่างน้อยกี่เท่าของ ATR */
  obImpulseAtr: 1.5,
  /** swing เก่ากว่ากี่แท่งไม่นับเป็นสภาพคล่องให้ sweep แล้ว */
  sweepLookback: 300,
};

export type DetectorConfig = typeof DEFAULTS;
