import { useEffect } from 'react';
import { Icon } from './Icon';

interface HotkeyHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export function HotkeyHelpModal({ isOpen, onClose }: HotkeyHelpModalProps) {
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-12 backdrop-blur-[2px] sm:pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-line bg-panel shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-field text-accent">
              <Icon name="keyboard" size={18} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-fg">คีย์ลัดของระบบ (Keyboard Shortcuts)</h2>
              <p className="text-xs text-muted">กดปุ่มบนแป้นพิมพ์เพื่อความสะดวกรวดเร็วโดยไม่ต้องละมือไปคลิกเมาส์</p>
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

        {/* Content */}
        <div className="max-h-[75vh] overflow-y-auto p-5 space-y-6">
          {/* Chart View Hotkeys */}
          <div>
            <h3 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
              <span>หน้าดูกราฟ (Chart View)</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHART_HOTKEYS.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-field/30 px-3 py-2"
                >
                  <span className="text-xs text-fg-2">{item.desc}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded border border-line bg-field px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Replay View Hotkeys */}
          <div>
            <h3 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
              <span>โหมดฝึก Replay (Replay Training View)</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {REPLAY_HOTKEYS.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-field/30 px-3 py-2"
                >
                  <span className="text-xs text-fg-2">{item.desc}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {item.keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded border border-line bg-field px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg shadow-sm"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-field/40 px-5 py-3 text-xs text-muted">
          <span>กด <kbd className="rounded border border-line bg-panel px-1 py-0.5 font-mono text-[10px] text-fg">?</kbd> หรือคลิกปุ่มคีย์ลัด เพื่อเปิดหน้านี้ได้ตลอดเวลา</span>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary text-xs px-3 py-1"
          >
            เข้าใจแล้ว
          </button>
        </div>
      </div>
    </div>
  );
}
