import { useEffect, useMemo, useRef, useState } from 'react';
import { addUserSymbol, searchSymbols, type SymbolSearchResult, type SymbolSummary } from '../api';
import { Icon } from './Icon';

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string) => void;
  onSymbolAdded?: (symbol: string) => Promise<void>;
  currentSymbol: string;
  symbols: SymbolSummary[];
}

const POPULAR_QUICK_PICKS = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'PLTR', 'MSFT', 'AMD', 'COIN', 'SOFI'];

export function SymbolSearchModal({
  isOpen,
  onClose,
  onSelectSymbol,
  onSymbolAdded,
  currentSymbol,
  symbols,
}: SymbolSearchModalProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'forex' | 'us-stock'>('all');
  const [remoteResults, setRemoteResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // โฟกัสช่องค้นหาเมื่อเปิด modal
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setRemoteResults([]);
      setError(null);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // ค้นหาเมื่อ query เปลี่ยน (debounce 200ms)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRemoteResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      searchSymbols(q)
        .then((res) => {
          setRemoteResults(res);
          setError(null);
        })
        .catch((err: Error) => {
          // ถ้าเครือข่ายมีปัญหา ไม่ต้องขึ้น error กวนใจ ยังใช้ผลค้นหา local ได้
          console.warn('searchSymbols error:', err.message);
        })
        .finally(() => setLoading(false));
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // รวบรวมผลลัพธ์ (Local ที่มีอยู่แล้ว + ผลลัพธ์จาก Remote)
  const combinedResults = useMemo(() => {
    const q = query.trim().toUpperCase();
    const seen = new Set<string>();
    const list: SymbolSearchResult[] = [];

    // 1. นำผลลัพธ์จาก remote หรือ local มาใส่
    for (const r of remoteResults) {
      if (tab !== 'all' && r.market !== tab) continue;
      seen.add(r.symbol);
      list.push(r);
    }

    // 2. ถ้ายังไม่ได้ผลลัพธ์ remote หรือ query ว่าง ให้ใช้รายการใน symbols
    for (const s of symbols) {
      if (seen.has(s.symbol)) continue;
      if (tab !== 'all' && s.market !== tab) continue;
      if (!q || s.symbol.includes(q) || s.description.toUpperCase().includes(q)) {
        seen.add(s.symbol);
        list.push({
          symbol: s.symbol,
          description: s.description,
          market: s.market,
          isKnown: true,
        });
      }
    }

    return list;
  }, [query, remoteResults, symbols, tab]);

  // ตรวจสอบว่า query ที่พิมพ์เป็น ticker ใหม่ที่ยังไม่อยู่ในรายการหรือไม่
  const isCustomTicker = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q || q.length < 1 || q.length > 12) return false;
    return !combinedResults.some((r) => r.symbol === q);
  }, [query, combinedResults]);

  // เลื่อน scroll ตาม selectedIndex
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, tab]);

  const handleSelect = async (item: { symbol: string; description: string; isKnown: boolean }) => {
    if (addingSymbol) return;

    if (item.isKnown) {
      onSelectSymbol(item.symbol);
      onClose();
      return;
    }

    // ถ้ายังไม่ได้เพิ่มในระบบ → เพิ่มผ่าน addUserSymbol
    setAddingSymbol(item.symbol);
    setError(null);
    try {
      await addUserSymbol(item.symbol, item.description || item.symbol);
      if (onSymbolAdded) await onSymbolAdded(item.symbol);
      onSelectSymbol(item.symbol);
      onClose();
    } catch (err) {
      setError(`เพิ่ม ${item.symbol} ไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setAddingSymbol(null);
    }
  };

  const handleCustomAdd = () => {
    const q = query.trim().toUpperCase();
    if (!q) return;
    void handleSelect({ symbol: q, description: q, isKnown: false });
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    const totalItems = combinedResults.length + (isCustomTicker ? 1 : 0);
    if (totalItems === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isCustomTicker && selectedIndex === 0) {
        handleCustomAdd();
      } else {
        const itemIdx = isCustomTicker ? selectedIndex - 1 : selectedIndex;
        const item = combinedResults[itemIdx];
        if (item) void handleSelect(item);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 backdrop-blur-[2px] sm:pt-24"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* หัวกล่องค้นหา */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="พิมพ์ symbol หรือชื่อหุ้น (เช่น AAPL, NVDA, EURUSD, XAUUSD)..."
            className="flex-1 bg-transparent text-[15px] font-medium text-fg placeholder:text-muted focus:outline-none"
          />
          {loading && <Icon name="refresh" size={16} className="animate-spin text-muted" />}
          {query && (
            <button
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="text-muted hover:text-fg"
              title="ล้างข้อความ"
            >
              <Icon name="close" size={16} />
            </button>
          )}
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="ปิด (Esc)">
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* แถบตัวกรอง + แนะนำ Ticker ยอดนิยม */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-field/60 px-4 py-2">
          <div className="seg text-xs" role="group">
            <button onClick={() => setTab('all')} aria-pressed={tab === 'all'}>
              ทั้งหมด
            </button>
            <button onClick={() => setTab('forex')} aria-pressed={tab === 'forex'}>
              Forex / ทอง
            </button>
            <button onClick={() => setTab('us-stock')} aria-pressed={tab === 'us-stock'}>
              หุ้น US
            </button>
          </div>

          {!query && (
            <div className="flex items-center gap-1.5 overflow-x-auto text-[11px] text-muted">
              <span>ยอดนิยม:</span>
              {POPULAR_QUICK_PICKS.slice(0, 6).map((sym) => (
                <button
                  key={sym}
                  onClick={() => setQuery(sym)}
                  className="rounded bg-panel px-1.5 py-0.5 font-medium text-fg-2 hover:bg-hover hover:text-accent"
                >
                  {sym}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* แสดงข้อความแจ้งเตือน / Error */}
        {error && (
          <div className="border-b border-bad/30 bg-bad/10 px-4 py-2 text-xs text-bad">
            {error}
          </div>
        )}

        {/* รายการผลลัพธ์ */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
          {/* ตัวเลือกเพิ่ม ticker เองโดยตรง (ถ้าผู้ใช้พิมพ์ ticker ที่ยังไม่มี) */}
          {isCustomTicker && (
            <button
              type="button"
              onClick={handleCustomAdd}
              disabled={!!addingSymbol}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                selectedIndex === 0 ? 'bg-accent/15 text-accent' : 'hover:bg-hover'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/20 text-accent">
                  <Icon name="plus" size={16} />
                </span>
                <div>
                  <div className="font-semibold text-fg">
                    + เพิ่มและเปิดกราฟ <span className="text-accent underline">{query.trim().toUpperCase()}</span>
                  </div>
                  <div className="text-xs text-muted">ดึงแท่งราคาจริงจาก Yahoo Finance ทันที</div>
                </div>
              </div>
              {addingSymbol === query.trim().toUpperCase() ? (
                <span className="flex items-center gap-1.5 text-xs text-accent">
                  <Icon name="refresh" size={14} className="animate-spin" />
                  กำลังเพิ่ม…
                </span>
              ) : (
                <span className="badge">กด Enter เพื่อเพิ่ม</span>
              )}
            </button>
          )}

          {combinedResults.map((item, idx) => {
            const actualIdx = isCustomTicker ? idx + 1 : idx;
            const isSelected = selectedIndex === actualIdx;
            const isCurrent = item.symbol === currentSymbol;
            const isAddingThis = addingSymbol === item.symbol;

            return (
              <button
                key={`${item.market}-${item.symbol}`}
                type="button"
                onClick={() => void handleSelect(item)}
                disabled={!!addingSymbol}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                  isSelected ? 'bg-hover' : ''
                } ${isCurrent ? 'bg-panel border border-accent/40' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tracking-tight text-fg">{item.symbol}</span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-medium ${
                        item.market === 'forex' ? 'bg-accent/15 text-accent' : 'bg-bull/15 text-bull'
                      }`}
                    >
                      {item.market === 'forex' ? 'Forex/ทอง' : item.type ?? 'หุ้น US'}
                    </span>
                    {isCurrent && <span className="text-[11px] font-medium text-accent">● กำลังเปิด</span>}
                  </div>
                  <div className="truncate text-xs text-muted">{item.description}</div>
                </div>

                <div className="ml-3 shrink-0">
                  {isAddingThis ? (
                    <span className="flex items-center gap-1 text-xs text-accent">
                      <Icon name="refresh" size={14} className="animate-spin" />
                      กำลังดึงข้อมูล…
                    </span>
                  ) : item.isKnown ? (
                    <span className="text-xs text-muted">พร้อมดู</span>
                  ) : (
                    <span className="rounded border border-line bg-panel px-2 py-0.5 text-xs font-medium text-fg-2 hover:border-accent hover:text-accent">
                      + เพิ่มเข้าแอป
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {!isCustomTicker && combinedResults.length === 0 && !loading && (
            <div className="py-12 text-center text-xs text-muted">
              ไม่พบ symbol ที่ตรงกับคำค้นหา
            </div>
          )}
        </div>

        {/* แถบคำแนะนำด้านล่าง */}
        <div className="flex items-center justify-between border-t border-line bg-field/40 px-4 py-2 text-[11px] text-muted">
          <span>
            สลับด้วย <kbd className="rounded bg-panel px-1 py-0.5 font-mono text-[10px]">↑</kbd>{' '}
            <kbd className="rounded bg-panel px-1 py-0.5 font-mono text-[10px]">↓</kbd> · เลือกด้วย{' '}
            <kbd className="rounded bg-panel px-1 py-0.5 font-mono text-[10px]">Enter</kbd>
          </span>
          <span>
            ปิดด้วย <kbd className="rounded bg-panel px-1 py-0.5 font-mono text-[10px]">Esc</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
