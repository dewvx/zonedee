import { useEffect, useState } from 'react';
import type { FundamentalData, StockNewsSummary, StockSummaryResult } from '@zonedee/core';
import { fetchNews, summarizeNewsWithAi } from '../api';
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

function formatRelativeTimeThai(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return 'เมื่อสักครู่';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ชม. ที่แล้ว`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return 'เมื่อวาน';
  if (diffDay < 7) return `${diffDay} วันที่แล้ว`;
  return new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export function StockSummaryModal({
  isOpen,
  onClose,
  symbol,
  summary,
  fundamentals,
  onOpenChart,
}: StockSummaryModalProps) {
  const [news, setNews] = useState<StockNewsSummary | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'gemini' | 'claude'>('claude');

  // ดึงข่าวล่าสุดเมื่อเปิด modal
  useEffect(() => {
    if (isOpen && symbol) {
      setNewsLoading(true);
      setNewsError(null);
      setAiError(null);
      fetchNews(symbol)
        .then((res) => {
          setNews(res);
          if (res.availableProviders?.length) {
            const p = res.availableProviders.includes('claude') ? 'claude' : res.availableProviders[0];
            if (p) setSelectedProvider(p);
          }
        })
        .catch((err) => setNewsError((err as Error).message))
        .finally(() => setNewsLoading(false));
    }
  }, [isOpen, symbol]);

  const handleReloadNews = (force = true) => {
    setNewsLoading(true);
    setNewsError(null);
    fetchNews(symbol, force)
      .then((res) => setNews(res))
      .catch((err) => setNewsError((err as Error).message))
      .finally(() => setNewsLoading(false));
  };

  const handleSummarizeAi = async (prov?: 'gemini' | 'claude') => {
    const targetProv = prov ?? selectedProvider;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await summarizeNewsWithAi(symbol, targetProv);
      setNews((prev) =>
        prev
          ? {
              ...prev,
              aiSummary: res.aiSummary,
              aiProvider: res.provider,
            }
          : null,
      );
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

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
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl"
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

          {/* ข่าวสารล่าสุด & การวิเคราะห์ Sentiment */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Icon name="newspaper" size={15} className="text-accent" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  ข่าวล่าสุด & ปัจจัยกระทบ (Market News)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {news && (
                  <span
                    className={`badge border text-[11px] font-medium ${
                      news.overallSentiment === 'positive'
                        ? 'border-bull/30 bg-bull/15 text-bull'
                        : news.overallSentiment === 'negative'
                          ? 'border-bear/30 bg-bear/15 text-bear'
                          : 'border-line bg-field text-muted'
                    }`}
                  >
                    {news.overallSentiment === 'positive'
                      ? `● ภาพรวมข่าว: เชิงบวก (+${news.positiveCount})`
                      : news.overallSentiment === 'negative'
                        ? `● ภาพรวมข่าว: ระวัง (-${news.negativeCount})`
                        : '● ภาพรวมข่าว: ทรงตัว/ปกติ'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleReloadNews(true)}
                  disabled={newsLoading}
                  className="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-40"
                  title="รีเฟรชข่าวล่าสุด"
                >
                  <Icon name="refresh" size={13} className={newsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* สรุปพาดหัวข่าวภาษาไทย */}
            {news?.headlineSummary && (
              <div className="rounded-lg border border-line bg-field/40 px-3.5 py-2.5 text-xs text-fg-2">
                <span className="font-semibold text-fg">สรุปกระแสข่าว: </span>
                <span>{news.headlineSummary}</span>
              </div>
            )}

            {/* AI Summary Box */}
            {news?.aiSummary ? (
              <div className="rounded-xl border border-accent/35 bg-accent/5 p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/20 pb-2">
                  <div className="flex items-center gap-2">
                    <Icon name="sparkles" size={14} className="text-accent" />
                    <span className="text-xs font-semibold text-accent">บทวิเคราะห์ข่าวเชิงลึกโดย AI</span>
                    <span className="badge bg-panel text-[10px] text-muted border border-line">
                      {news.aiProvider === 'claude' ? 'Claude 3.5' : 'Gemini 1.5'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {news.availableProviders && news.availableProviders.length > 1 && (
                      <div className="seg text-[11px]" role="group">
                        <button
                          type="button"
                          aria-pressed={selectedProvider === 'claude'}
                          onClick={() => {
                            setSelectedProvider('claude');
                            void handleSummarizeAi('claude');
                          }}
                          disabled={aiLoading}
                        >
                          Claude
                        </button>
                        <button
                          type="button"
                          aria-pressed={selectedProvider === 'gemini'}
                          onClick={() => {
                            setSelectedProvider('gemini');
                            void handleSummarizeAi('gemini');
                          }}
                          disabled={aiLoading}
                        >
                          Gemini
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSummarizeAi()}
                      disabled={aiLoading}
                      className="text-[11px] text-muted hover:text-accent hover:underline disabled:opacity-40"
                    >
                      {aiLoading ? 'กำลังวิเคราะห์ใหม่…' : 'วิเคราะห์ใหม่'}
                    </button>
                  </div>
                </div>
                <div className="text-xs leading-relaxed text-fg whitespace-pre-line">
                  {news.aiSummary}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/60 bg-panel px-3.5 py-2 text-xs">
                <div className="flex items-center gap-2 text-muted">
                  <Icon name="sparkles" size={13} className="text-accent" />
                  <span>
                    {news?.hasAiKey
                      ? 'คลิกปุ่มด้านขวาเพื่อให้ AI ช่วยอ่านและสรุปข่าวเป็นภาษาไทย'
                      : 'ระบุ ANTHROPIC_API_KEY หรือ GEMINI_API_KEY ใน .env เพื่อเปิดใช้สรุปข่าวด้วย AI'}
                  </span>
                </div>
                {news?.hasAiKey && (
                  <div className="flex items-center gap-1.5">
                    {news.availableProviders && news.availableProviders.length > 1 && (
                      <div className="seg text-[11px]" role="group">
                        <button
                          type="button"
                          aria-pressed={selectedProvider === 'claude'}
                          onClick={() => setSelectedProvider('claude')}
                          disabled={aiLoading}
                        >
                          Claude
                        </button>
                        <button
                          type="button"
                          aria-pressed={selectedProvider === 'gemini'}
                          onClick={() => setSelectedProvider('gemini')}
                          disabled={aiLoading}
                        >
                          Gemini
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSummarizeAi()}
                      disabled={aiLoading || newsLoading || !news.items?.length}
                      className="btn btn-sm btn-primary"
                    >
                      <Icon name="sparkles" size={12} />
                      {aiLoading
                        ? 'AI กำลังอ่านและสรุป…'
                        : `สรุปด้วย ${selectedProvider === 'claude' ? 'Claude' : 'Gemini'}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {aiError && (
              <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                {aiError}
              </div>
            )}

            {/* รายการข่าวล่าสุด */}
            {newsLoading && !news ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted">
                <Icon name="refresh" size={14} className="animate-spin text-accent" />
                กำลังดึงข่าวล่าสุดจาก Yahoo Finance...
              </div>
            ) : news && news.items.length > 0 ? (
              <div className="space-y-2">
                {news.items.slice(0, 6).map((item) => (
                  <a
                    key={item.id}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 rounded-lg border border-line bg-field/30 p-2.5 transition-colors hover:border-line-strong hover:bg-hover"
                  >
                    {item.thumbnail && (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="h-12 w-16 shrink-0 rounded object-cover border border-line"
                        loading="lazy"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[11px] text-muted">{item.publisher}</span>
                        <span className="text-[11px] text-faint">· {formatRelativeTimeThai(item.publishedAt)}</span>
                        <span
                          className={`ml-auto badge text-[10px] ${
                            item.sentiment === 'positive'
                              ? 'bg-bull/15 text-bull'
                              : item.sentiment === 'negative'
                                ? 'bg-bear/15 text-bear'
                                : 'bg-field text-faint'
                          }`}
                        >
                          {item.sentiment === 'positive'
                            ? '🟢 ปัจจัยบวก'
                            : item.sentiment === 'negative'
                              ? '🔴 ปัจจัยลบ'
                              : '⚪ ทั่วไป'}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-fg group-hover:text-accent flex items-start justify-between gap-2">
                        <span className="line-clamp-2 leading-snug">{item.title}</span>
                        <Icon name="external" size={12} className="shrink-0 text-muted group-hover:text-accent mt-0.5" />
                      </div>
                      {item.highlightKeywords.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {item.highlightKeywords.map((k) => (
                            <span key={k} className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-fg-2">
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-line bg-field/20 p-4 text-center text-xs text-muted">
                {newsError ? `ดึงข่าวไม่สำเร็จ: ${newsError}` : `ไม่พบข่าวล่าสุดสำหรับ ${symbol}`}
              </div>
            )}
          </div>

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
