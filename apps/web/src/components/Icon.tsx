/** ไอคอนเส้นของแอป (วาดเอง 24×24, ใช้สี currentColor) */
const PATHS = {
  chart: (
    <>
      <path d="M7 4v3M7 15v5M17 3v4M17 13v4" />
      <rect x="4.5" y="7" width="5" height="8" rx="1" />
      <rect x="14.5" y="7" width="5" height="6" rx="1" />
    </>
  ),
  backtest: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3 4.5V9h4.5" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  replay: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="m10.5 9.2 4.2 2.8-4.2 2.8z" />
    </>
  ),
  journal: (
    <>
      <path d="M5.5 4.5h10a3 3 0 0 1 3 3v12h-10a3 3 0 0 1-3-3z" />
      <path d="M5.5 16.5a3 3 0 0 1 3-3h10M9.5 8.5h5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z" />
      <path d="M10 20.5h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4.5 4.5" />
    </>
  ),
  scan: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5M8 12.5l2-2.5 2 1.5 2.5-3" />
    </>
  ),
  invest: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" />
      <path d="M15 3.9a8.5 8.5 0 0 1 5.1 5.1H15z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  refresh: (
    <>
      <path d="M19.5 11a7.5 7.5 0 0 0-13.4-4.1L4.5 8.5" />
      <path d="M4.5 4v4.5H9M4.5 13a7.5 7.5 0 0 0 13.4 4.1l1.6-1.6" />
      <path d="M19.5 20v-4.5H15" />
    </>
  ),
  ruler: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="1.5" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v2" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  left: <path d="m14.5 6-6 6 6 6" />,
  right: <path d="m9.5 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M8 5.5v13l10-6.5z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  keyboard: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01M8 15h8" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** โลโก้ zonedee: แนวต้าน (บน) แนวรับ (ล่าง) และราคาที่วิ่งระหว่างโซน */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="zonedee">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--c-hover)" stroke="var(--c-line)" />
      <rect x="6" y="7.5" width="20" height="4.5" rx="1.5" fill="var(--c-bear)" opacity="0.32" />
      <rect x="6" y="20" width="20" height="4.5" rx="1.5" fill="var(--c-bull)" opacity="0.32" />
      <path
        d="M6.5 19.5 11 13l4 5 4.5-7.5 3 4 3-3.5"
        fill="none"
        stroke="var(--c-fg)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
