export interface StockNewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: number; // UTC ms
  thumbnail?: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number;
  highlightKeywords: string[];
}

export interface StockNewsSummary {
  symbol: string;
  fetchedAt: number;
  items: StockNewsItem[];
  overallSentiment: 'positive' | 'negative' | 'neutral';
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  sentimentScore: number;
  headlineSummary: string;
  aiSummary?: string | null;
  hasAiKey?: boolean;
}

const POSITIVE_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /\b(surges?|jumps?|rall(y|ies)|rises?|gains?|soars?|climbs?|skyrockets?)\b/i, label: 'ราคาพุ่ง' },
  { regex: /\b(beats?|tops?|exceeds?|outperforms?)\b/i, label: 'ผลงานดีกว่าคาด' },
  { regex: /\b(record (high|profit|revenue|sales))\b/i, label: 'สถิติสูงสุดใหม่' },
  { regex: /\b(growth|boom|expansion|rebound|recovery)\b/i, label: 'การเติบโต/ฟื้นตัว' },
  { regex: /\b(upgrades?|buy rating|outperform|price target raised|bullish|top pick)\b/i, label: 'ปรับเป้าขึ้น/แนะนำซื้อ' },
  { regex: /\b(launches?|unveils?|introduces?|breakthrough|partnership|strategic deal|wins? contract)\b/i, label: 'เปิดตัวสินค้า/ดีลใหม่' },
  { regex: /\b(strong (demand|sales|earnings|results|outlook|guidance))\b/i, label: 'ความต้องการ/งบแข็งแกร่ง' },
  { regex: /\b(dividend (hike|boost|increase)|share buyback)\b/i, label: 'เพิ่มปันผล/ซื้อหุ้นคืน' },
  { regex: /\b(ai (boost|growth|demand|advantage|leader|winner))\b/i, label: 'กระแส AI หนุน' },
];

const NEGATIVE_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /\b(falls?|drops?|plunges?|sinks?|slumps?|dives?|tumbles?|declines?|slides?|crash(es)?)\b/i, label: 'ราคาร่วง/ปรับลง' },
  { regex: /\b(misses?|falls short|disappoints?|lags?|loser)\b/i, label: 'พลาดเป้า/ต่ำกว่าคาด' },
  { regex: /\b(downgrades?|sell rating|underperform|price target cut|bearish)\b/i, label: 'ปรับลดเกรด/เป้าหมาย' },
  { regex: /\b(cuts? (guidance|forecast|jobs|spending|prices)|lowers? guidance)\b/i, label: 'ลดคาดการณ์งบ/รายได้' },
  { regex: /\b(lawsuit|sued|investigation|probe|sec (probe|investigation|charges|inquiry|lawsuit)|antitrust|regulatory hurdle|fine|penalty)\b/i, label: 'คดีความ/การสอบสวน' },
  { regex: /\b(warning|warns?|risk|threat|concerns?|fears?|crisis|struggles?)\b/i, label: 'ความเสี่ยง/เตือนชะลอ' },
  { regex: /\b(layoffs?|job cuts|fired|restructuring)\b/i, label: 'ปลดพนักงาน' },
  { regex: /\b(loss(es)? widens?|debt crisis|bankruptcy|default)\b/i, label: 'ขาดทุน/หนี้สิน' },
  { regex: /\b(recall|defect|glitch|delay|halt|scandal)\b/i, label: 'เรียกคืนสินค้า/สะดุด' },
];

/**
 * วิเคราะห์ Sentiment และสกัดคำสำคัญจากหัวข้อข่าวการเงิน
 */
export function classifyNewsSentiment(title: string): {
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  keywords: string[];
} {
  const keywords: string[] = [];
  let score = 0;

  for (const { regex, label } of POSITIVE_PATTERNS) {
    if (regex.test(title)) {
      score += 1;
      if (!keywords.includes(label)) keywords.push(label);
    }
  }

  for (const { regex, label } of NEGATIVE_PATTERNS) {
    if (regex.test(title)) {
      score -= 1;
      if (!keywords.includes(label)) keywords.push(label);
    }
  }

  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  return { sentiment, score, keywords };
}

/**
 * สรุปภาพรวมของชุดข่าวล่าสุดสำหรับหุ้น
 */
export function summarizeNewsItems(
  symbol: string,
  rawItems: Omit<StockNewsItem, 'sentiment' | 'sentimentScore' | 'highlightKeywords'>[],
  aiSummary?: string | null,
  hasAiKey = false,
): StockNewsSummary {
  const items: StockNewsItem[] = rawItems.map((item) => {
    const { sentiment, score, keywords } = classifyNewsSentiment(item.title);
    return {
      ...item,
      sentiment,
      sentimentScore: score,
      highlightKeywords: keywords,
    };
  });

  const positiveCount = items.filter((x) => x.sentiment === 'positive').length;
  const negativeCount = items.filter((x) => x.sentiment === 'negative').length;
  const neutralCount = items.filter((x) => x.sentiment === 'neutral').length;
  const sentimentScore = items.reduce((acc, x) => acc + x.sentimentScore, 0);

  let overallSentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (positiveCount > negativeCount && sentimentScore > 0) {
    overallSentiment = 'positive';
  } else if (negativeCount > positiveCount && sentimentScore < 0) {
    overallSentiment = 'negative';
  }

  // รวมประเด็นสำคัญที่พบ
  const allKeywords = [...new Set(items.flatMap((x) => x.highlightKeywords))];
  const topTopics = allKeywords.slice(0, 3);

  let headlineSummary = '';
  if (items.length === 0) {
    headlineSummary = `ยังไม่มีข่าวล่าสุดที่มีนัยสำคัญสำหรับ ${symbol} ในช่วงนี้`;
  } else if (overallSentiment === 'positive') {
    const topicsText = topTopics.length > 0 ? ` โดยมีปัจจัยหนุนหลัก: ${topTopics.join(', ')}` : '';
    headlineSummary = `ข่าวล่าสุดระยะสั้นโน้มเอียงเชิงบวก (บวก ${positiveCount} จาก ${items.length} ข่าว)${topicsText}`;
  } else if (overallSentiment === 'negative') {
    const topicsText = topTopics.length > 0 ? ` มีแรงกดดันหลักจาก: ${topTopics.join(', ')}` : '';
    headlineSummary = `ข่าวล่าสุดระยะสั้นควรระมัดระวัง (ลบ ${negativeCount} จาก ${items.length} ข่าว)${topicsText}`;
  } else {
    headlineSummary = `กระแสข่าวล่าสุดอยู่ในระดับปกติ/แกว่งตัว (บวก ${positiveCount}, ลบ ${negativeCount}, ทั่วไป ${neutralCount}) ยังไม่มีทิศทางข่าวชัดเจน`;
  }

  return {
    symbol: symbol.toUpperCase(),
    fetchedAt: Date.now(),
    items,
    overallSentiment,
    positiveCount,
    negativeCount,
    neutralCount,
    sentimentScore,
    headlineSummary,
    aiSummary: aiSummary ?? null,
    hasAiKey,
  };
}
