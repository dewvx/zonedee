import { describe, expect, it } from 'vitest';
import { mergeCandles } from '../src/merge';
import type { Candle } from '../src/types';

const c = (time: number, close = time): Candle => ({ time, open: 1, high: 2, low: 0, close, volume: 1 });

describe('mergeCandles', () => {
  it('โหลดย้อนหลัง: ต่อข้างหน้าได้ เรียงถูก', () => {
    expect(mergeCandles([c(3), c(4)], [c(1), c(2)]).map((x) => x.time)).toEqual([1, 2, 3, 4]);
  });

  it('อัปเดตแท่งล่าสุด: เวลาซ้ำใช้ชุดใหม่ และต่อแท่งใหม่ท้ายสุด', () => {
    const out = mergeCandles([c(1), c(2, 10)], [c(2, 20), c(3)]);
    expect(out.map((x) => [x.time, x.close])).toEqual([
      [1, 1],
      [2, 20],
      [3, 3],
    ]);
  });

  it('ช่วงซ้อนกันบางส่วน ไม่มีแท่งซ้ำ', () => {
    expect(mergeCandles([c(1), c(2), c(3)], [c(2), c(3), c(4)]).map((x) => x.time)).toEqual([1, 2, 3, 4]);
  });

  it('ชุดว่าง', () => {
    expect(mergeCandles([], [c(2), c(1), c(2)]).map((x) => x.time)).toEqual([1, 2]);
    expect(mergeCandles([c(1)], [])).toEqual([c(1)]);
  });

  it('ไม่แก้ไข input', () => {
    const a = [c(1)];
    const b = [c(2)];
    mergeCandles(a, b);
    expect(a).toEqual([c(1)]);
    expect(b).toEqual([c(2)]);
  });
});
