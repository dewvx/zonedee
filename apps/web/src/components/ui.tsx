import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** หัวหน้า: ชื่อหน้า + คำอธิบายสั้น + ปุ่มด้านขวา */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-5 py-2.5">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold leading-tight text-fg">{title}</h1>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** แผงซ้ายสำหรับฟอร์มตั้งค่า — เนื้อหาเลื่อนได้ ปุ่มหลักติดอยู่ด้านล่างเสมอ */
export function SidePanel({ children, footer, width = 'w-80' }: { children: ReactNode; footer?: ReactNode; width?: string }) {
  return (
    <aside className={`flex ${width} shrink-0 flex-col border-r border-line bg-panel`}>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">{children}</div>
      {footer && <div className="space-y-2 border-t border-line px-5 py-4">{footer}</div>}
    </aside>
  );
}

/** กลุ่มในฟอร์ม (หัวข้อเล็ก) */
export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 text-[13px] font-semibold text-fg">{title}</h2>
      {hint && <div className="-mt-1.5 mb-2.5 text-xs leading-relaxed text-muted">{hint}</div>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** ช่องกรอกพร้อมป้าย */
export function Field({ label, title, children, className = '' }: { label: string; title?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`} title={title}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** หน้าว่าง: บอกว่าทำอะไรต่อ */
export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto mt-20 flex max-w-md flex-col items-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-panel text-muted">
        <Icon name={icon} size={22} />
      </div>
      <p className="text-[15px] font-semibold text-fg">{title}</p>
      {children && <div className="mt-2 text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

/** ตัวเลขสรุป */
export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'up' | 'down';
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 truncate text-lg font-semibold tabular-nums leading-tight ${tone === 'up' ? 'text-bull' : tone === 'down' ? 'text-bear' : 'text-fg'}`}>
        {value}
      </div>
      {sub && <div className="truncate text-xs text-faint">{sub}</div>}
    </div>
  );
}

/** แถบแจ้งผล (สำเร็จ / เตือน / ผิดพลาด) */
export function Note({ kind, children, onClose }: { kind: 'ok' | 'warn' | 'bad'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`note note-${kind}`}>
      <span className="min-w-0 flex-1">{children}</span>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="ปิด">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
