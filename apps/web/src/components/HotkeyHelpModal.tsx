import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface HotkeyHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'all' | 'chart' | 'replay';
}

interface HotkeyItem {
  keys: string[];
  desc: string;
}

const CHART_HOTKEYS: HotkeyItem[] = [
  { keys: ['1'], desc: 'สลับไป Timeframe M1' },
  { keys: ['5'], desc: 'สลับไป Timeframe M5' },
  { keys: ['15', '2'], desc: 'สลับไป Timeframe M15 (กด 15 หรือ 2)' },
  { keys: ['30', '3'], desc: 'สลับไป Timeframe M30 (กด 30 หรือ 3)' },
  { keys: ['6', 'H'], desc: 'สลับไป Timeframe H1' },
  { keys: ['4'], desc: 'สลับไป Timeframe H4' },
  { keys: ['D'], desc: 'สลับไป Timeframe D1 (Daily)' },
  { keys: ['W'], desc: 'สลับไป Timeframe W1 (Weekly)' },
  { keys: ['E'], desc: 'สลับเปิด / ปิด เส้น EMA 9 และ EMA 21' },
  { keys: ['L'], desc: 'สลับเปิด / ปิด แถบโครงสร้างราคา (LayerBar)' },
  { keys: ['/', 'Ctrl+K'], desc: 'เปิดกล่องค้นหาหุ้นและ Symbol' },
  { keys: ['?'], desc: 'เปิด / ปิด หน้ารายการคีย์ลัดนี้' },
];

const REPLAY_HOTKEYS: HotkeyItem[] = [
  { keys: ['Space', '→'], desc: 'เดินแท่งถัดไปทีละ 1 แท่ง (Next Candle)' },
  { keys: ['B'], desc: 'ส่งคำสั่งจำลอง BUY (วางแผนเข้าซื้อ)' },
  { keys: ['S'], desc: 'ส่งคำสั่งจำลอง SELL (วางแผนเข้าขาย)' },
  { keys: ['N', 'X'], desc: 'ข้ามข้อนี้ / ไม่เทรด — ดูเฉลยทันที' },
  { keys: ['Enter'], desc: 'ยืนยันออเดอร์แล้วเริ่มเฉลย (ตอนวาง Entry/SL/TP)' },
  { keys: ['Esc'], desc: 'ยกเลิกการวางออเดอร์กลับไปดูแท่งเดิม' },
  { keys: ['R'], desc: 'สุ่มจุดเริ่มใหม่ (New Random Point)' },
];

export function HotkeyHelpModal({ isOpen, onClose, defaultTab = 'all' }: HotkeyHelpModalProps) {
  const [tab, setTab] = useState<'all' | 'chart' | 'replay'>(defaultTab);

  useEffect(() => {
    if (isOpen) {
      setTab(defaultTab);
    }
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-field text-accent">
              <Icon name="keyboard" size={17} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-fg">คีย์ลัดของระบบ (Keyboard Shortcuts)</h2>
              <p className="text-[11px] text-muted">กดปุ่มบนแป้นพิมพ์เพื่อความสะดวกรวดเร็วโดยไม่ต้องละมือไปคลิกเมาส์</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg"
            title="ปิด (Esc)"
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Tab Filter */}
        <div className="shrink-0 flex items-center gap-2 border-b border-line bg-field/20 px-5 py-2">
          <span className="text-xs text-muted">หมวดหมู่:</span>
          <div className="seg text-xs" role="group" aria-label="Hotkey categories">
            <button
              type="button"
              onClick={() => setTab('all')}
              aria-pressed={tab === 'all'}
            >
              ทั้งหมด ({CHART_HOTKEYS.length + REPLAY_HOTKEYS.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('chart')}
              aria-pressed={tab === 'chart'}
            >
              หน้าดูกราฟ ({CHART_HOTKEYS.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('replay')}
              aria-pressed={tab === 'replay'}
            >
              โหมด Replay ({REPLAY_HOTKEYS.length})
            </button>
          </div>
        </div>

        {/* Content (Scrollable) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Chart View Hotkeys */}
          {(tab === 'all' || tab === 'chart') && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
                <span>หน้าดูกราฟ (Chart View)</span>
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CHART_HOTKEYS.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2.5 rounded-lg border border-line bg-field/30 px-3 py-1.5"
                  >
                    <span className="text-xs text-fg-2 leading-tight">{item.desc}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-line bg-field px-1.5 py-0.5 font-mono text-[10px] font-semibold text-fg shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Replay View Hotkeys */}
          {(tab === 'all' || tab === 'replay') && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
                <span>โหมดฝึก Replay (Replay Training View)</span>
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {REPLAY_HOTKEYS.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2.5 rounded-lg border border-line bg-field/30 px-3 py-1.5"
                  >
                    <span className="text-xs text-fg-2 leading-tight">{item.desc}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-line bg-field px-1.5 py-0.5 font-mono text-[10px] font-semibold text-fg shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-field/40 px-5 py-2.5 text-xs text-muted">
          <span>กด <kbd className="rounded border border-line bg-panel px-1 py-0.5 font-mono text-[10px] text-fg">?</kbd> บนคีย์บอร์ดเพื่อเปิด/ปิดหน้านี้ได้ทันที</span>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary text-xs px-3.5 py-1"
          >
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}
