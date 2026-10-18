import { useCallback, useEffect, useRef, useState } from 'react';
import type { Timeframe } from '@zonedee/core';
import { fetchAlertEvents } from './api';
import AlertsView from './views/AlertsView';
import BacktestView from './views/BacktestView';
import ChartView, { type ChartNav } from './views/ChartView';
import JournalView from './views/JournalView';
import ReplayView from './views/ReplayView';
import ScannerView from './views/ScannerView';
import WatchlistView from './views/WatchlistView';

/** หน้าในแอป — เพิ่มหน้าใหม่ที่นี่ */
const TABS = [
  { id: 'chart', icon: '📈', label: 'กราฟ' },
  { id: 'backtest', icon: '🧪', label: 'Backtest' },
  { id: 'replay', icon: '🎯', label: 'Replay' },
  { id: 'journal', icon: '📓', label: 'Journal' },
  { id: 'alerts', icon: '🔔', label: 'แจ้งเตือน' },
  { id: 'scanner', icon: '🔎', label: 'สแกน' },
  { id: 'watchlist', icon: '⭐', label: 'ลงทุน' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const TAB_KEY = 'zonedee:tab';
const SEEN_KEY = 'zonedee:alertsSeen';
const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
};
function loadTab(): TabId {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as TabId) : 'chart';
  } catch {
    return 'chart';
  }
}

export default function App() {
  const [tab, setTab] = useState<TabId>(loadTab);
  const [nav, setNav] = useState<ChartNav | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ไม่เป็นไร */
    }
  }, [tab]);

  // ── แจ้งเตือน: ป้ายตัวเลขบนเมนู + เด้งแจ้งเตือนของเครื่อง (ตอนเปิดแอปค้างไว้) ──
  const [unread, setUnread] = useState(0);
  const seenRef = useRef(readSeen());
  const notifiedRef = useRef<number | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const markSeen = useCallback((lastId: number) => {
    seenRef.current = Math.max(seenRef.current, lastId);
    setUnread(0);
    try {
      localStorage.setItem(SEEN_KEY, String(seenRef.current));
    } catch {
      /* ไม่เป็นไร */
    }
  }, []);
  useEffect(() => {
    const poll = async () => {
      try {
        const events = await fetchAlertEvents(0);
        const maxId = events[0]?.id ?? 0;
        if (notifiedRef.current === null) notifiedRef.current = maxId; // เปิดแอป: ไม่เด้งของเก่า
        const fresh = events.filter((e) => e.id > notifiedRef.current!).reverse();
        notifiedRef.current = Math.max(notifiedRef.current, maxId);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const e of fresh) {
            const [title, ...body] = e.message.split('\n');
            new Notification(title ?? 'zonedee', { body: body.slice(0, 3).join('\n'), tag: `zonedee-${e.id}` });
          }
        }
        if (tabRef.current === 'alerts') markSeen(maxId);
        else setUnread(events.filter((e) => e.id > seenRef.current).length);
      } catch {
        /* server ปิดอยู่ — ลองใหม่รอบหน้า */
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 20_000);
    return () => clearInterval(id);
  }, [markSeen]);

  /** หน้าอื่นสั่งเปิดกราฟ symbol/TF/เวลาที่ต้องการ */
  const openChart = (symbol: string, tf: Timeframe) => {
    setNav({ symbol, tf, id: Date.now() });
    setTab('chart');
  };

  return (
    <div className="flex h-full">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-2">
        <span className="mb-2 text-[13px] font-bold leading-none tracking-tight text-white" title="zonedee">
          z<span className="text-bull">d</span>
        </span>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex w-14 flex-col items-center rounded-md py-1.5 text-[10px] transition-colors ${
              tab === t.id ? 'bg-blue-600/20 text-white' : 'text-slate-400 hover:bg-line hover:text-white'
            }`}
          >
            <span className="relative text-base leading-none">
              {t.icon}
              {t.id === 'alerts' && unread > 0 && (
                <span className="absolute -right-2.5 -top-1.5 rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-tight text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
            <span className="mt-1">{t.label}</span>
          </button>
        ))}
      </nav>
      {/* หน้ากราฟเปิดค้างไว้ (ซ่อน) เพื่อจำตำแหน่ง/ข้อมูลที่โหลดแล้ว */}
      <div className={`min-w-0 flex-1 ${tab === 'chart' ? '' : 'hidden'}`}>
        <ChartView nav={nav} />
      </div>
      {tab === 'backtest' && (
        <div className="min-w-0 flex-1">
          <BacktestView onOpenChart={openChart} />
        </div>
      )}
      {tab === 'replay' && (
        <div className="min-w-0 flex-1">
          <ReplayView />
        </div>
      )}
      {tab === 'journal' && (
        <div className="min-w-0 flex-1">
          <JournalView />
        </div>
      )}
      {tab === 'alerts' && (
        <div className="min-w-0 flex-1">
          <AlertsView onEventsSeen={markSeen} />
        </div>
      )}
      {tab === 'scanner' && (
        <div className="min-w-0 flex-1">
          <ScannerView onOpenChart={openChart} />
        </div>
      )}
      {tab === 'watchlist' && (
        <div className="min-w-0 flex-1">
          <WatchlistView onOpenChart={openChart} />
        </div>
      )}
    </div>
  );
}
