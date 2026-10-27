import type { FundamentalData, StockSummaryResult } from '@zonedee/core';
import { Icon } from './Icon';

interface StockSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  summary: StockSummaryResult | null;
  fundamentals: FundamentalData | null;
  onOpenChart?: (symbol: string) => void;
}

const fmtPct = (v?: number | null, d = 1) => (v == null ? '-' : `${(v * 100).toFixed(d)}%`);
const fmtRatio = (v?: number | null, suffix = 'x') => (v == null ? '-' : `${v.toFixed(1)}${suffix}`);
const fmtMoney = (v?: number | null) => {
  if (v == null) return '-';
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

export function StockSummaryModal({
  isOpen,
  onClose,
  symbol,
  summary,
  fundamentals,
  onOpenChart,
}: StockSummaryModalProps) {
  if (!isOpen) return null;

  const biasCls =
    summary?.bias === 'bullish'
      ? 'bg-bull/15 text-bull border-bull/30'
      : summary?.bias === 'bearish'
        ? 'bg-bear/15 text-bear border-bear/30'
        : 'bg-accent/15 text-accent border-accent/30';

  const biasLabel =
    summary?.bias === 'bullish'
      ? '● แนวโน้มเป็นบวก (Bullish)'
      : summary?.bias === 'bearish'
        ? '● แนวโน้มระวังชะลอตัว (Bearish)'
        : '● พักฐาน/แกว่งตัว (Neutral)';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-12 backdrop-blur-[2px] sm:pt-16"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-[19px] font-bold tracking-tight text-fg">{symbol}</h2>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${biasCls}`}>
              {biasLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
            title="ปิด (Esc)"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {summary ? (
            <>
              {/* Headline & Paragraph */}
              <div className="rounded-xl border border-line bg-field/50 p-4">
                <div className="text-[15px] font-semibold text-fg">
                  {summary.headline}
                </div>
                <div className="mt-2 text-xs leading-relaxed text-muted">
                  {summary.paragraph}
                </div>
              </div>

              {/* Action Advice (คำแนะนำเชิงกลยุทธ์) */}
              {summary.actionAdvice && (
                <div className="flex items-start gap-3 rounded-lg border border-accent/25 bg-accent/10 px-4 py-3 text-xs leading-relaxed text-fg-2">
                  <span className="mt-0.5 shrink-0 text-accent font-semibold">💡 กลยุทธ์:</span>
                  <span>{summary.actionAdvice}</span>
                </div>
              )}

              {/* Checklist ประเด็นบวก / ประเด็นระวัง */}
              {summary.bullets.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    ประเด็นวิเคราะห์สำคัญ (Checklist)
                  </h3>
                  <div className="space-y-2">
                    {summary.bullets.map((b, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                          b.type === 'pro'
                            ? 'border-bull/20 bg-bull/5 text-fg'
                            : b.type === 'con'
                              ? 'border-bear/20 bg-bear/5 text-fg'
                              : 'border-line bg-field/30 text-fg-2'
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          {b.type === 'pro' ? (
                            <span className="text-bull">✔</span>
                          ) : b.type === 'con' ? (
                            <span className="text-bear">✖</span>
                          ) : (
                            <span className="text-muted">ℹ</span>
                          )}
                        </span>
                        <span>{b.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-6 text-center text-xs text-muted">
              กำลังรวบรวมข้อมูลหรือไม่มีข้อมูลแท่งราคาเพียงพอสำหรับวิเคราะห์
            </div>
          )}

          {/* งบการเงินย่อและอัตราส่วนทางการเงิน */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              งบการเงินย่อ & อัตราส่วนสำคัญ (จาก Yahoo Finance)
            </h3>
            {fundamentals ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">P/E (ย้อนหลัง)</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                    {fmtRatio(fundamentals.pe)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">Forward P/E</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                    {fmtRatio(fundamentals.forwardPe)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">PEG Ratio</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                    {fmtRatio(fundamentals.pegRatio, '')}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">Price to Book (P/B)</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                    {fmtRatio(fundamentals.pb)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">รายได้โต (YoY)</div>
                  <div
                    className={`mt-0.5 text-base font-semibold tabular-nums ${
                      (fundamentals.revenueGrowth ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                    }`}
                  >
                    {fmtPct(fundamentals.revenueGrowth)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">อัตรากำไรสุทธิ</div>
                  <div
                    className={`mt-0.5 text-base font-semibold tabular-nums ${
                      (fundamentals.profitMargin ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                    }`}
                  >
                    {fmtPct(fundamentals.profitMargin)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">รายได้รวม</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                    {fmtMoney(fundamentals.revenue)}
                  </div>
                </div>
                <div className="rounded-lg border border-line bg-field/60 p-3">
                  <div className="text-[11px] text-muted">หนี้สิน (Debt/Equity)</div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums text-fg">
                    {fundamentals.debtToEquity != null ? `${fundamentals.debtToEquity.toFixed(0)}%` : '-'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-field/30 p-4 text-center text-xs text-muted">
                ยังไม่มีข้อมูลงบการเงินของ {symbol} (กดปุ่ม "อัปเดตราคา" เพื่อดึงข้อมูลใหม่)
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-line bg-panel px-6 py-3">
          <div className="text-xs text-muted">
            การวิเคราะห์อิงตามสถิติทางเทคนิคและงบการเงินย่อ ไม่ใช่คำแนะนำการลงทุน
          </div>
          <div className="flex items-center gap-2">
            {onOpenChart && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenChart(symbol);
                }}
                className="btn btn-primary"
              >
                <Icon name="chart" size={14} />
                เปิดดูกราฟ {symbol}
              </button>
            )}
            <button type="button" onClick={onClose} className="btn">
              ปิด
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
