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
 * จัดการ Cache ข่าวใน SQLite และเชื่อมต่อ Gemini / Claude AI สำหรับสรุปข่าว
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
        ai_provider TEXT,
        fetched_at INTEGER NOT NULL
      );
    `);
    // ป้องกันกรณีตารางเดิมยังไม่มีคอลัมน์ ai_provider
    try {
      this.db.exec('ALTER TABLE news_cache ADD COLUMN ai_provider TEXT');
    } catch {
      /* คอลัมน์มีอยู่แล้ว */
    }
  }

  getAvailableProviders(): ('gemini' | 'claude')[] {
    const providers: ('gemini' | 'claude')[] = [];
    if (process.env.GEMINI_API_KEY) providers.push('gemini');
    if (process.env.ANTHROPIC_API_KEY) providers.push('claude');
    return providers;
  }

  get(symbol: string): StockNewsSummary | null {
    const row = this.db
      .prepare('SELECT data, ai_summary, ai_provider, fetched_at FROM news_cache WHERE symbol = ?')
      .get(symbol.toUpperCase()) as
      | { data: string; ai_summary: string | null; ai_provider: string | null; fetched_at: number }
      | undefined;
    if (!row) return null;
    try {
      const summary = JSON.parse(row.data) as StockNewsSummary;
      const providers = this.getAvailableProviders();
      summary.aiSummary = row.ai_summary;
      summary.aiProvider = (row.ai_provider as 'gemini' | 'claude') ?? null;
      summary.hasAiKey = providers.length > 0;
      summary.availableProviders = providers;
      return summary;
    } catch {
      return null;
    }
  }

  async getOrFetch(symbol: string, force = false): Promise<StockNewsSummary> {
    const sUpper = symbol.toUpperCase();
    const providers = this.getAvailableProviders();
    const existing = this.db
      .prepare('SELECT data, ai_summary, ai_provider, fetched_at FROM news_cache WHERE symbol = ?')
      .get(sUpper) as
      | { data: string; ai_summary: string | null; ai_provider: string | null; fetched_at: number }
      | undefined;

    if (!force && existing && this.now() - existing.fetched_at < NEWS_TTL_MS) {
      try {
        const summary = JSON.parse(existing.data) as StockNewsSummary;
        summary.aiSummary = existing.ai_summary;
        summary.aiProvider = (existing.ai_provider as 'gemini' | 'claude') ?? null;
        summary.hasAiKey = providers.length > 0;
        summary.availableProviders = providers;
        return summary;
      } catch {
        // ignore and refetch
      }
    }

    const items = await fetchYahooNews(sUpper);
    const summary = summarizeNewsItems(
      sUpper,
      items,
      existing?.ai_summary,
      providers.length > 0,
      providers,
      (existing?.ai_provider as 'gemini' | 'claude') ?? null,
    );

    const put = this.db.prepare(
      'INSERT INTO news_cache (symbol, data, ai_summary, ai_provider, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at',
    );
    put.run(sUpper, JSON.stringify(summary), existing?.ai_summary ?? null, existing?.ai_provider ?? null, this.now());

    return summary;
  }

  async summarizeWithAi(
    symbol: string,
    requestedProvider?: 'gemini' | 'claude',
  ): Promise<{ aiSummary: string; provider: 'gemini' | 'claude' }> {
    const providers = this.getAvailableProviders();
    if (providers.length === 0) {
      throw new Error('ยังไม่ได้กำหนด GEMINI_API_KEY หรือ ANTHROPIC_API_KEY ในไฟล์ .env');
    }

    let provider: 'gemini' | 'claude' = requestedProvider ?? (providers.includes('claude') ? 'claude' : 'gemini');
    if (requestedProvider && !providers.includes(requestedProvider)) {
      throw new Error(`ยังไม่ได้กำหนด API Key สำหรับ ${requestedProvider === 'claude' ? 'Claude (ANTHROPIC_API_KEY)' : 'Gemini (GEMINI_API_KEY)'}`);
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

    let aiText = '';

    if (provider === 'claude') {
      const apiKey = process.env.ANTHROPIC_API_KEY!;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 600,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Claude API Error (${res.status}): ${errText.slice(0, 200)}`);
      }

      const json = (await res.json()) as any;
      aiText = json?.content?.[0]?.text?.trim() ?? '';
    } else {
      const apiKey = process.env.GEMINI_API_KEY!;
      const candidateModels = [
        process.env.GEMINI_MODEL,
        'gemini-2.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.1-flash-lite',
        'gemini-1.5-flash',
      ].filter(Boolean) as string[];

      let lastErrorText = '';
      for (const model of candidateModels) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
          lastErrorText = `Gemini API Error (${res.status}): ${errText.slice(0, 200)}`;
          // ถ้าเป็น 404 (model ไม่พบหรือยกเลิกการรองรับ) ให้ลองรุ่นถัดไป
          if (res.status === 404) continue;
          throw new Error(lastErrorText);
        }

        const json = (await res.json()) as any;
        aiText = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        if (aiText) break;
      }

      if (!aiText && lastErrorText) {
        throw new Error(lastErrorText);
      }
    }

    if (!aiText) throw new Error(`ไม่ได้รับข้อความตอบกลับจาก ${provider === 'claude' ? 'Claude' : 'Gemini'} API`);

    this.db
      .prepare('UPDATE news_cache SET ai_summary = ?, ai_provider = ? WHERE symbol = ?')
      .run(aiText, provider, symbol.toUpperCase());

    return { aiSummary: aiText, provider };
  }
}
