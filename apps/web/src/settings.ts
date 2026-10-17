import { DEFAULTS, isTimeframe, type Timeframe } from '@zonedee/core';
import { DEFAULT_LAYERS, type LayerToggles } from './overlays';

/** ตั้งค่าโซนแนวรับแนวต้าน (ชื่อตรงกับ DEFAULTS ใน core/config) */
export interface ZoneSettings {
  show: boolean;
  showSwings: boolean;
  swingLength: number;
  zoneMergeAtr: number;
  maxZones: number;
  ryuMode: boolean;
}

/** ตั้งค่าเครื่องคิด lot */
export interface RiskSettings {
  /** ยอดเงิน (สกุลเงินบัญชี) ที่กรอกเอง */
  balance: number;
  riskPct: number;
  /** ใช้ยอดเงินจาก MT5 อัตโนมัติถ้ามี */
  useMt5Balance: boolean;
  /** leverage ที่กรอกเอง (0 = ใช้ค่าจาก MT5 / ค่ามาตรฐาน) */
  leverage: number;
  /** spread (points) ที่นับเพิ่มในความเสี่ยง (-1 = ใช้ spread ปัจจุบันจาก MT5) */
  spreadPoints: number;
  /** R:R ขั้นต่ำ (Braron 1:2) */
  minRR: number;
}

export const DEFAULT_RISK: RiskSettings = {
  balance: 1000,
  riskPct: 1,
  useMt5Balance: true,
  leverage: 0,
  spreadPoints: -1,
  minRR: 2,
};

/** ค่าที่จำไว้ในเบราว์เซอร์ (เปิดแอปครั้งหน้าจะกลับมาที่เดิม) */
export interface Settings {
  symbol: string;
  tf: Timeframe;
  showEma: boolean;
  autoUpdate: boolean;
  zones: ZoneSettings;
  layers: LayerToggles;
  risk: RiskSettings;
}

const KEY = 'zonedee:settings';

export const DEFAULT_ZONE_SETTINGS: ZoneSettings = {
  show: true,
  showSwings: false,
  swingLength: DEFAULTS.swingLength,
  zoneMergeAtr: DEFAULTS.zoneMergeAtr,
  maxZones: DEFAULTS.maxZones,
  ryuMode: DEFAULTS.ryuMode,
};

export const DEFAULT_SETTINGS: Settings = {
  symbol: 'XAUUSD',
  tf: 'M15',
  showEma: true,
  autoUpdate: false,
  zones: DEFAULT_ZONE_SETTINGS,
  layers: DEFAULT_LAYERS,
  risk: DEFAULT_RISK,
};

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : d;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings>;
    const z = (s.zones ?? {}) as Partial<ZoneSettings>;
    const l = (s.layers ?? {}) as Partial<LayerToggles>;
    const layers = Object.fromEntries(
      (Object.keys(DEFAULT_LAYERS) as (keyof LayerToggles)[]).map((k) => [k, bool(l[k], DEFAULT_LAYERS[k])]),
    ) as unknown as LayerToggles;
    const dz = DEFAULT_ZONE_SETTINGS;
    const r = (s.risk ?? {}) as Partial<RiskSettings>;
    const dr = DEFAULT_RISK;
    return {
      symbol: typeof s.symbol === 'string' ? s.symbol : DEFAULT_SETTINGS.symbol,
      tf: typeof s.tf === 'string' && isTimeframe(s.tf) ? s.tf : DEFAULT_SETTINGS.tf,
      showEma: bool(s.showEma, DEFAULT_SETTINGS.showEma),
      autoUpdate: bool(s.autoUpdate, DEFAULT_SETTINGS.autoUpdate),
      zones: {
        show: bool(z.show, dz.show),
        showSwings: bool(z.showSwings, dz.showSwings),
        swingLength: num(z.swingLength, dz.swingLength, 1, 20),
        zoneMergeAtr: num(z.zoneMergeAtr, dz.zoneMergeAtr, 0.05, 3),
        maxZones: num(z.maxZones, dz.maxZones, 1, 30),
        ryuMode: bool(z.ryuMode, dz.ryuMode),
      },
      layers,
      risk: {
        balance: num(r.balance, dr.balance, 0, 1e12),
        riskPct: num(r.riskPct, dr.riskPct, 0.01, 100),
        useMt5Balance: bool(r.useMt5Balance, dr.useMt5Balance),
        leverage: num(r.leverage, dr.leverage, 0, 10_000),
        spreadPoints: num(r.spreadPoints, dr.spreadPoints, -1, 100_000),
        minRR: num(r.minRR, dr.minRR, 0.1, 20),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // เบราว์เซอร์ไม่ให้เก็บ (private mode ฯลฯ) — ไม่เป็นไร แค่จำค่าไม่ได้
  }
}
