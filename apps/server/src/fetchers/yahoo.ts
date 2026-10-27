import YahooFinance from 'yahoo-finance2';
import { TIMEFRAME_MS, bucketStart, type Candle, type FundamentalData, type Timeframe } from '@zonedee/core';

export interface YahooQuote {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

const INTERVAL: Partial<Record<Timeframe, '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk'>> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  D1: '1d',
  W1: '1wk',
};

/**
 * แปลง quotes ของ Yahoo เป็น Candle
 * - ปัดเวลาให้ตรง bucket ของ TF (Yahoo รายวันให้เวลาเปิดตลาด เช่น 13:30 UTC → 00:00 UTC)
 * - ตัดแถว null ทิ้ง (วันหยุด / ช่วงไม่มีเทรด)
 * - หุ้น: ราคาปรับ split แล้ว แต่ไม่ได้ปรับปันผล · forex: volume = 0
 */
export function mapYahooQuotes(quotes: readonly YahooQuote[], tf: Timeframe): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const q of quotes) {
    if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
    if (!(q.open > 0 && q.high > 0 && q.low > 0 && q.close > 0)) continue;
    const time = bucketStart(q.date.getTime(), tf);
    // แถวซ้ำเวลาเดียวกัน (Yahoo ชอบส่งแท่งปัจจุบันมาซ้ำ) ใช้แถวหลังสุด
    byTime.set(time, {
      time,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

let client: InstanceType<typeof YahooFinance> | null = null;

/** ดึงแท่งจาก Yahoo Finance ช่วง [from, to) */
export async function fetchYahoo(symbol: string, tf: Timeframe, from: Date, to: Date): Promise<Candle[]> {
  const interval = INTERVAL[tf];
  if (!interval) throw new Error(`Yahoo ไม่มี interval สำหรับ ${tf}`);
  client ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  // ขยาย period2 ไปอีก 1 แท่ง ให้ได้แท่งล่าสุดที่ยังไม่ปิดด้วย
  const result = await client.chart(symbol, {
    period1: from,
    period2: new Date(to.getTime() + TIMEFRAME_MS[tf]),
    interval,
  });
  return mapYahooQuotes(result.quotes, tf);
}

/** รายชื่อหุ้นจาก screener สำเร็จรูปของ Yahoo (เช่น small_cap_gainers) */
export async function yahooScreener(
  id:
    | 'small_cap_gainers'
    | 'aggressive_small_caps'
    | 'day_gainers'
    | 'day_losers'
    | 'most_actives'
    | 'most_shorted_stocks'
    | 'undervalued_large_caps'
    | 'growth_technology_stocks',
  count: number,
): Promise<{ symbol: string; name: string; marketCap: number | null }[]> {
  client ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const res = await client.screener({ scrIds: id, count });
  return res.quotes.map((q) => ({
    symbol: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    marketCap: typeof q.marketCap === 'number' ? q.marketCap : null,
  }));
}

/**
 * วันประกาศงบครั้งถัดไปจาก quote ของ Yahoo (ค่าประมาณ อาจคลาด ±2 วัน)
 * เลือกวันที่เร็วสุดที่ยังไม่ผ่านไปเกิน 1 วัน จาก earningsTimestampStart / earningsTimestamp / earningsTimestampEnd
 */
export async function yahooEarnings(symbols: readonly string[], now = Date.now()): Promise<Map<string, number | null>> {
  client ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const out = new Map<string, number | null>();
  if (symbols.length === 0) return out;
  const quotes = await client.quote([...symbols], {
    fields: ['symbol', 'earningsTimestamp', 'earningsTimestampStart', 'earningsTimestampEnd'],
  });
  for (const q of quotes) {
    const r = q as { symbol: string; earningsTimestamp?: Date; earningsTimestampStart?: Date; earningsTimestampEnd?: Date };
    out.set(r.symbol, pickEarnings([r.earningsTimestampStart, r.earningsTimestamp, r.earningsTimestampEnd], now));
  }
  for (const s of symbols) if (!out.has(s)) out.set(s, null);
  return out;
}

export function pickEarnings(dates: readonly (Date | undefined)[], now: number): number | null {
  const ts = dates
    .map((d) => (d instanceof Date ? d.getTime() : NaN))
    .filter((t) => Number.isFinite(t) && t >= now - 86_400_000)
    .sort((a, b) => a - b);
  return ts[0] ?? null;
}

export interface YahooSearchResult {
  symbol: string;
  name: string;
  type?: string;
  exchange?: string;
}

/** ค้นหาหุ้น/ETF จาก Yahoo Finance search */
export async function searchYahoo(query: string, count = 8): Promise<YahooSearchResult[]> {
  client ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const res = await client.search(query, { quotesCount: count, newsCount: 0 });
  const results: YahooSearchResult[] = [];
  for (const item of res.quotes ?? []) {
    const q = item as { symbol?: string; quoteType?: string; shortname?: string; longname?: string; exchange?: string };
    const sym = q.symbol?.toUpperCase();
    if (!sym) continue;
    if (q.quoteType === 'EQUITY' || q.quoteType === 'ETF') {
      results.push({
        symbol: sym,
        name: q.shortname || q.longname || sym,
        type: q.quoteType,
        exchange: q.exchange,
      });
    }
  }
  return results;
}

/**
 * ดึงข้อมูลงบการเงินย่อและอัตราส่วนทางการเงินจาก Yahoo Finance
 * (P/E, Forward P/E, PEG, P/B, ROE, รายได้, อัตรากำไร, หนี้สิน, เงินปันผล)
 */
export async function yahooFundamentals(symbols: readonly string[]): Promise<Map<string, FundamentalData>> {
  client ??= new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  const out = new Map<string, FundamentalData>();
  if (symbols.length === 0) return out;

  const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // 1. ดึง Valuation เบื้องต้นแบบ Bulk (รวดเร็ว 1 request ได้ครบทุกตัว)
  try {
    const quotes = await client.quote([...symbols], {
      fields: [
        'symbol',
        'trailingPE',
        'forwardPE',
        'priceToBook',
        'trailingAnnualDividendYield',
        'dividendYield',
        'marketCap',
        'epsTrailingTwelveMonths',
      ],
    });

    for (const item of quotes) {
      const q = item as {
        symbol?: string;
        trailingPE?: number;
        forwardPE?: number;
        priceToBook?: number;
        dividendYield?: number;
        trailingAnnualDividendYield?: number;
      };
      const sym = q.symbol?.toUpperCase();
      if (!sym) continue;
      out.set(sym, {
        pe: numOrNull(q.trailingPE),
        forwardPe: numOrNull(q.forwardPE),
        pb: numOrNull(q.priceToBook),
        dividendYield: numOrNull(q.dividendYield ?? q.trailingAnnualDividendYield),
      });
    }
  } catch (err) {
    console.warn('yahoo quote fundamentals error:', (err as Error).message);
  }

  // 2. ดึงรายละเอียดลึก (financialData + defaultKeyStatistics) ทีละตัว
  for (const sym of symbols) {
    const sUpper = sym.toUpperCase();
    try {
      const summary = await client.quoteSummary(sym, {
        modules: ['financialData', 'defaultKeyStatistics'],
      });
      const fin = summary.financialData as Record<string, unknown> | undefined;
      const stats = summary.defaultKeyStatistics as Record<string, unknown> | undefined;
      const prev = out.get(sUpper) ?? {};

      out.set(sUpper, {
        ...prev,
        pe: prev.pe ?? numOrNull(stats?.trailingPE),
        forwardPe: prev.forwardPe ?? numOrNull(stats?.forwardPE),
        pegRatio: numOrNull(stats?.pegRatio),
        pb: prev.pb ?? numOrNull(stats?.priceToBook),
        roe: numOrNull(fin?.returnOnEquity),
        revenue: numOrNull(fin?.totalRevenue),
        revenueGrowth: numOrNull(fin?.revenueGrowth),
        profitMargin: numOrNull(fin?.profitMargins),
        debtToEquity: numOrNull(fin?.debtToEquity),
        targetMeanPrice: numOrNull(fin?.targetMeanPrice),
      });
    } catch {
      // ถ้าไม่มี module financialData ให้เก็บข้อมูลจาก bulk quote ต่อไป
    }
  }

  for (const s of symbols) {
    const sUpper = s.toUpperCase();
    if (!out.has(sUpper)) out.set(sUpper, {});
  }
  return out;
}
