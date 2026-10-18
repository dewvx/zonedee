import { bo3tf } from './bo-3tf';
import { crt } from './crt';
import { emaCross } from './ema-cross';
import { fvgSweep } from './fvg-sweep';
import { obMss } from './ob-mss';
import { rbsSbr } from './rbs-sbr';
import { skFibo } from './sk-fibo';
import type { StrategyDef } from './types';

export * from './types';
export { confirmStates, pickHtf, AUTO_HTF, resolveParams } from './common';
export { fiboPrice, FIBO_LEVELS } from './sk-fibo';
export { findCrtSetups, type CrtSetup } from './crt';
export { BO3_SETS } from './bo-3tf';

/** ท่าทั้งหมดที่ backtest / แจ้งเตือนเลือกได้ */
export const STRATEGIES: readonly StrategyDef[] = [emaCross, skFibo, bo3tf, crt, fvgSweep, rbsSbr, obMss];

export const getStrategy = (id: string): StrategyDef | undefined => STRATEGIES.find((s) => s.id === id);
