/**
 * กำไร/ขาดทุนเป็นเท่าของความเสี่ยง (R) — 1R = ระยะ entry → SL
 * ใช้กับเทรดจริงใน journal (backtest คิด R ใน engine เอง)
 * null = ยังคิดไม่ได้ (ไม่มี SL หรือ SL = entry)
 */
export function rMultiple(direction: 'long' | 'short', entry: number, sl: number | null, exit: number): number | null {
  if (sl === null || !Number.isFinite(sl) || sl === entry) return null;
  const risk = Math.abs(entry - sl);
  return (direction === 'long' ? exit - entry : entry - exit) / risk;
}
