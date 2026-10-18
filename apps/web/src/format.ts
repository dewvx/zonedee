/** แสดงเวลาเป็นเวลาไทย (ข้อมูลเป็น UTC ms) */
export const formatThaiTime = (ms: number, withYear = true) =>
  new Date(ms).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });

export const formatThaiDate = (ms: number) =>
  new Date(ms).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' });

/** R แบบมีเครื่องหมาย เช่น +1.25R */
export const fmtR = (r: number, digits = 2) => `${r > 0 ? '+' : ''}${r.toFixed(digits)}R`;

export const fmtPct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

/** วันที่ (เวลาไทย) สำหรับ <input type="date"> */
export const toDateInput = (ms: number) => new Date(ms + 7 * 3_600_000).toISOString().slice(0, 10);
/** <input type="date"> → UTC ms ของเที่ยงคืนเวลาไทย */
export const fromDateInput = (s: string) => Date.parse(`${s}T00:00:00+07:00`);
