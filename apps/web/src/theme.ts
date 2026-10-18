import { useSyncExternalStore } from 'react';

/**
 * ธีมมืด / สว่าง — สีจริงอยู่ใน index.css (CSS variables ใต้ [data-theme])
 * ไฟล์นี้เก็บค่าที่เลือก (localStorage) + สีที่กราฟ canvas ต้องใช้ (canvas อ่าน CSS ไม่ได้)
 */
export type Theme = 'dark' | 'light';

const KEY = 'zonedee:theme';
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ไม่มี storage ก็ไม่เป็นไร */
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let current: Theme = initial();
if (typeof document !== 'undefined') document.documentElement.dataset.theme = current;

export function setTheme(t: Theme) {
  current = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ไม่เป็นไร */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** สีที่ใช้วาดบน canvas ของ Lightweight Charts — ต้องตรงกับ index.css */
export interface ChartPalette {
  bg: string;
  grid: string;
  text: string;
  border: string;
  crosshair: string;
  bull: string;
  bear: string;
  bullOpen: string;
  bearOpen: string;
  /** พื้นหลังป้ายบนกราฟ (โปร่งนิดหน่อย) */
  labelBg: string;
  ema: [string, string];
}

export const FONT = "'IBM Plex Sans Thai', 'Leelawadee UI', system-ui, sans-serif";

export const CHART_PALETTE: Record<Theme, ChartPalette> = {
  dark: {
    bg: '#0E131B',
    grid: '#161D29',
    text: '#8792A6',
    border: '#222B3A',
    crosshair: '#5D6779',
    bull: '#2BC48A',
    bear: '#F0566E',
    bullOpen: 'rgba(43, 196, 138, 0.4)',
    bearOpen: 'rgba(240, 86, 110, 0.4)',
    labelBg: 'rgba(14, 19, 27, 0.82)',
    ema: ['#6EA8FE', '#F59F6B'],
  },
  light: {
    bg: '#FFFFFF',
    grid: '#F0F2F6',
    text: '#667085',
    border: '#E3E7EE',
    crosshair: '#98A2B3',
    bull: '#12A06C',
    bear: '#E0445E',
    bullOpen: 'rgba(18, 160, 108, 0.35)',
    bearOpen: 'rgba(224, 68, 94, 0.35)',
    labelBg: 'rgba(255, 255, 255, 0.85)',
    ema: ['#3A6FE0', '#E07A3A'],
  },
};
