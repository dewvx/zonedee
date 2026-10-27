import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import YahooFinance from 'yahoo-finance2';
import {
  classifyNewsSentiment,
  summarizeNewsItems,
  type StockNewsItem,
  type StockNewsSummary,
} from '@zonedee/core';

let yfClient: InstanceType<typeof YahooFinance> | null = null;

export const NEWS_TTL_MS = 15 * 60_000; // 15 นาที

/**
 * ดึงข่าวล่าสุดของ symbol จาก Yahoo Finance
 */
export async function fetchYahooNews(symbol: string, count = 8): Promise<StockNewsItem[]> {
  yfClient ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const sUpper = symbol.toUpperCase();
  const query = sUpper === 'XAUUSD' ? 'GC=F' : sUpper;

  try {
    const res = await yfClient.search(query, { newsCount: count });
    const raw = res.news ?? [];

    return raw.map((n: any) => {
      let thumbnail: string | null = null;
      if (n.thumbnail?.resolutions?.length) {
        thumbnail = n.thumbnail.resolutions[0]?.url ?? null;
      }
      const publishedAt = n.providerPublishTime
        ? new Date(n.providerPublishTime).getTime()
        : Date.now();
      const title = String(n.title ?? '').trim();
      const { sentiment, score, keywords } = classifyNewsSentiment(title);

      return {
        id: String(n.uuid || n.link || Math.random().toString(36).slice(2)),
        title,
        publisher: String(n.publisher ?? 'Yahoo Finance'),
        link: String(n.link ?? '#'),
        publishedAt,
        thumbnail,
        sentiment,
        sentimentScore: score,
        highlightKeywords: keywords,
      };
    });
  } catch (err) {
    console.warn(`[News] Failed to fetch news for ${symbol}:`, (err as Error).message);
    return [];
  }
}

/**
 * จัดการ Cache ข่าวใน SQLite และเชื่อมต่อ Gemini AI สำหรับสรุปข่าว
 */
export class NewsCache {
  private db: DatabaseSync;

  constructor(
    dbPath: string,
    private now: () => number = Date.now,
  ) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS news_cache (
        symbol TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        ai_summary TEXT,
        fetched_at INTEGER NOT NULL
      );
    `);
  }

  get(symbol: string): StockNewsSummary | null {
    const row = this.db
      .prepare('SELECT data, ai_summary, fetched_at FROM news_cache WHERE symbol = ?')
      .get(symbol.toUpperCase()) as
      | { data: string; ai_summary: string | null; fetched_at: number }
      | undefined;
    if (!row) return null;
    try {
      const summary = JSON.parse(row.data) as StockNewsSummary;
      summary.aiSummary = row.ai_summary;
      summary.hasAiKey = Boolean(process.env.GEMINI_API_KEY);
      return summary;
    } catch {
      return null;
    }
  }

  async getOrFetch(symbol: string, force = false): Promise<StockNewsSummary> {
    const sUpper = symbol.toUpperCase();
    const existing = this.db
      .prepare('SELECT data, ai_summary, fetched_at FROM news_cache WHERE symbol = ?')
      .get(sUpper) as
      | { data: string; ai_summary: string | null; fetched_at: number }
      | undefined;

    if (!force && existing && this.now() - existing.fetched_at < NEWS_TTL_MS) {
      try {
        const summary = JSON.parse(existing.data) as StockNewsSummary;
        summary.aiSummary = existing.ai_summary;
        summary.hasAiKey = Boolean(process.env.GEMINI_API_KEY);
        return summary;
      } catch {
        // ignore and refetch
      }
    }

    const items = await fetchYahooNews(sUpper);
    const hasAiKey = Boolean(process.env.GEMINI_API_KEY);
    const summary = summarizeNewsItems(sUpper, items, existing?.ai_summary, hasAiKey);

    const put = this.db.prepare(
      'INSERT INTO news_cache (symbol, data, ai_summary, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at',
    );
    put.run(sUpper, JSON.stringify(summary), existing?.ai_summary ?? null, this.now());

    return summary;
  }

  async summarizeWithAi(symbol: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('ยังไม่ได้กำหนด GEMINI_API_KEY ในไฟล์ .env');
    }

    const summary = await this.getOrFetch(symbol, false);
    if (!summary.items || summary.items.length === 0) {
      throw new Error(`ไม่พบข่าวล่าสุดของ ${symbol} สำหรับการสรุป`);
    }

    const newsListText = summary.items
      .slice(0, 6)
      .map(
        (item, idx) =>
          `${idx + 1}. [${item.publisher}] ${item.title} (${new Date(item.publishedAt).toLocaleDateString()})`,
      )
      .join('\n');

    const prompt = `คุณเป็นนักวิเคราะห์การเงินและตลาดหุ้นมืออาชีพ
โปรดอ่านหัวข้อข่าวและสาระสำคัญของหุ้น ${symbol} ต่อไปนี้ แล้วสรุปเป็นภาษาไทยให้กระชับ ชัดเจน เข้าใจง่าย:

ข่าวล่าสุด:
${newsListText}

คำแนะนำในการสรุป:
1. สรุปภาพรวม 1 ย่อหน้าสั้นๆ ว่าช่วงนี้มีประเด็นอะไรเด่นที่สุด (บวกหรือลบ)
2. สรุปเป็น 3-4 ประเด็นสำคัญ (Bullet points) เช่น ปัจจัยหนุน, ความเสี่ยง หรือผลกระทบต่อราคาหุ้น
3. สรุปคำแนะนำสั้นๆ สำหรับนักลงทุน (เช่น ควรจับตาวันประกาศงบ, ระวังความผันผวน, หรือเป็นสัญญาณบวก)

ตอบเฉพาะข้อความสรุปภาษาไทย ไม่ต้องมีคำเกริ่นนำอื่น`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API Error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as any;
    const aiText = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!aiText) throw new Error('ไม่ได้รับข้อความตอบกลับจาก Gemini API');

    this.db.prepare('UPDATE news_cache SET ai_summary = ? WHERE symbol = ?').run(aiText, symbol.toUpperCase());
    return aiText;
  }
}
