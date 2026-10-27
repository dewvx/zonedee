import { describe, expect, it } from 'vitest';
import { classifyNewsSentiment, summarizeNewsItems } from '../src/scan/stock-news';

describe('Stock News & Sentiment (ระบบวิเคราะห์ข่าวหุ้น)', () => {
  it('classifyNewsSentiment ระบุข่าวเชิงบวกได้อย่างถูกต้อง', () => {
    const title = 'Apple Unveils New MacBook Pro Ahead Of November Launch — HSBC Sees Strong iPhone Demand, Potential AI-Driven Growth';
    const result = classifyNewsSentiment(title);
    expect(result.sentiment).toBe('positive');
    expect(result.score).toBeGreaterThan(0);
    expect(result.keywords).toContain('เปิดตัวสินค้า/ดีลใหม่');
  });

  it('classifyNewsSentiment ระบุข่าวเชิงลบ/ความเสี่ยงได้อย่างถูกต้อง', () => {
    const title = 'Tesla stock drops 5% following SEC investigation and earnings misses';
    const result = classifyNewsSentiment(title);
    expect(result.sentiment).toBe('negative');
    expect(result.score).toBeLessThan(0);
    expect(result.keywords).toContain('ราคาร่วง/ปรับลง');
    expect(result.keywords).toContain('คดีความ/การสอบสวน');
  });

  it('classifyNewsSentiment จัดประเภทข่าวทั่วไปเป็น neutral', () => {
    const title = 'Berkshire Hathaway files quarterly SEC report detailing stock holdings';
    const result = classifyNewsSentiment(title);
    expect(result.sentiment).toBe('neutral');
    expect(result.score).toBe(0);
  });

  it('summarizeNewsItems สรุปภาพรวมของชุดข่าวและคิดคะแนนสุทธิ', () => {
    const rawItems = [
      {
        id: '1',
        title: 'NVIDIA beats quarterly earnings estimates as AI chip demand surges',
        publisher: 'Reuters',
        link: 'https://example.com/1',
        publishedAt: Date.now() - 3600_000,
      },
      {
        id: '2',
        title: 'Analysts upgrade NVIDIA price target to new record high',
        publisher: 'Bloomberg',
        link: 'https://example.com/2',
        publishedAt: Date.now() - 7200_000,
      },
      {
        id: '3',
        title: 'Tech sector faces regulatory hurdle in Europe',
        publisher: 'CNBC',
        link: 'https://example.com/3',
        publishedAt: Date.now() - 10800_000,
      },
    ];

    const summary = summarizeNewsItems('NVDA', rawItems, null, true);
    expect(summary.symbol).toBe('NVDA');
    expect(summary.items).toHaveLength(3);
    expect(summary.positiveCount).toBe(2);
    expect(summary.negativeCount).toBe(1);
    expect(summary.overallSentiment).toBe('positive');
    expect(summary.headlineSummary).toContain('ข่าวล่าสุดระยะสั้นโน้มเอียงเชิงบวก');
    expect(summary.hasAiKey).toBe(true);
  });
});
