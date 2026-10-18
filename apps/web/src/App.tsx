import { useCallback, useEffect, useRef, useState } from 'react';
import type { Timeframe } from '@zonedee/core';
import { fetchAlertEvents } from './api';
import { Icon, Logo, type IconName } from './components/Icon';
import { setTheme, useTheme } from './theme';
import AlertsView from './views/AlertsView';
import BacktestView from './views/BacktestView';
import ChartView, { type ChartNav } from './views/ChartView';
import JournalView from './views/JournalView';
import ReplayView from './views/ReplayView';
import ScannerView from './views/ScannerView';
import WatchlistView from './views/WatchlistView';

/** หน้าในแอป — เพิ่มหน้าใหม่ที่นี่ */
const TABS = [
  // เทรด forex / ทอง
  { id: 'chart', icon: 'chart', label: 'กราฟ', group: 'trade' },
  { id: 'backtest', icon: 'backtest', label: 'Backtest', group: 'trade' },
  { id: 'replay', icon: 'replay', label: 'Replay', group: 'trade' },
  { id: 'journal', icon: 'journal', label: 'Journal', group: 'trade' },
  { id: 'alerts', icon: 'bell', label: 'แจ้งเตือน', group: 'trade' },
  // หุ้น US
  { id: 'scanner', icon: 'scan', label: 'สแกนหุ้น', group: 'stock' },
  { id: 'watchlist', icon: 'invest', label: 'ลงทุน', group: 'stock' },
] as const satisfies readonly { id: string; icon: IconName; label: string; group: 'trade' | 'stock' }[];
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
  const theme = useTheme();
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
    <div className="flex h-full bg-bg text-fg">
      <nav className="flex w-[4.5rem] shrink-0 flex-col items-center border-r border-line bg-panel pb-3 pt-3">
        <div className="mb-4" title="zonedee">
          <Logo size={30} />
        </div>
        {TABS.map((t, k) => (
          <div key={t.id} className="w-full px-1.5">
            {k > 0 && TABS[k - 1]!.group !== t.group && <div className="mx-3 my-2 border-t border-line" />}
            <button
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`relative mb-0.5 flex w-full flex-col items-center gap-1 rounded-lg py-2 text-[11px] leading-none transition-colors ${
                tab === t.id ? 'bg-accent/12 text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              }`}
            >
              {tab === t.id && <span className="absolute -left-1.5 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
              <span className={`relative ${tab === t.id ? 'text-accent' : ''}`}>
                <Icon name={t.icon} size={20} />
                {t.id === 'alerts' && unread > 0 && (
                  <span className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-bear px-1 text-center text-[10px] font-semibold leading-4 text-white">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </span>
              <span>{t.label}</span>
            </button>
          </div>
        ))}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}
          className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
        </button>
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
