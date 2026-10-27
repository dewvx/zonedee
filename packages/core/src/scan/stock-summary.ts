import type { KeyLevels } from './key-levels';
import type { WatchMetrics } from './watch-metrics';

export interface FundamentalData {
  pe?: number | null;
  forwardPe?: number | null;
  pegRatio?: number | null;
  pb?: number | null;
  roe?: number | null;
  dividendYield?: number | null;
  revenue?: number | null;
  revenueGrowth?: number | null;
  profitMargin?: number | null;
  debtToEquity?: number | null;
  targetMeanPrice?: number | null;
}

export interface StockSummaryInput {
  symbol: string;
  metrics?: WatchMetrics | null;
  levels?: KeyLevels | null;
  fundamentals?: FundamentalData | null;
  /** จำนวนวันก่อนถึงวันประกาศงบ (เช่น 3 วัน, 0 = วันนี้, ติดลบถ้าเพิ่งผ่านมา, null = ไม่ทราบ) */
  earningsDaysLeft?: number | null;
}

export type TrendBias = 'bullish' | 'neutral' | 'bearish';

export interface SummaryBullet {
  type: 'pro' | 'con' | 'info';
  category: 'trend' | 'momentum' | 'level' | 'fundamental' | 'earnings';
  text: string;
}

export interface StockSummaryResult {
  symbol: string;
  bias: TrendBias;
  /** สรุปภาพรวมแบบสั้น 1 บรรทัด */
  headline: string;
  /** สรุปเนื้อหาภาพรวม 2-3 บรรทัด */
  paragraph: string;
  /** รายการประเด็นบวก / ประเด็นระวัง / ข้อมูลสำคัญ */
  bullets: SummaryBullet[];
  /** คำแนะนำเชิงกลยุทธ์ (สำหรับ DCA หรือ Swing) */
  actionAdvice: string;
}

/**
 * สรุปสถานะหุ้นอัตโนมัติภาษาไทย (Rule-based ไม่ใช้ AI เพื่อประหยัดค่าใช้จ่าย)
 * ประมวลผลจาก:
 * 1. เทรนด์ราคาและเส้นค่าเฉลี่ย SMA 50 / SMA 200
 * 2. โมเมนตัม RSI 14 และระยะห่างจากจุดสูงสุด/ต่ำสุด 52 สัปดาห์
 * 3. ตำแหน่งแนวรับต้านหลัก (Key Levels)
 * 4. งบการเงินย่อ (P/E, Growth, Profit Margin, Debt/Equity, ROE, ปันผล)
 * 5. ความเสี่ยงวันประกาศงบการเงิน
 */
export function summarizeStock(input: StockSummaryInput): StockSummaryResult {
  const { symbol, metrics, levels, fundamentals, earningsDaysLeft } = input;
  const bullets: SummaryBullet[] = [];
  let proScore = 0;
  let conScore = 0;

  // ── 1. วิเคราะห์เทรนด์ (SMA 50 / 200) ───────────────────────────────────
  let trendDesc = 'แนวโน้มยังไม่ชัดเจน';
  if (metrics && metrics.close > 0) {
    const { close, sma50, sma200 } = metrics;
    if (sma50 !== null && sma200 !== null) {
      if (close >= sma50 && sma50 >= sma200) {
        proScore += 2;
        trendDesc = 'ขาขึ้นแข็งแกร่ง (Golden Cross)';
        bullets.push({
          type: 'pro',
          category: 'trend',
          text: `เทรนด์ขาขึ้นแข็งแกร่ง: ราคายืนเหนือ SMA 50 ($${sma50.toFixed(2)}) และ SMA 200 ($${sma200.toFixed(2)})`,
        });
      } else if (close >= sma200) {
        proScore += 1;
        trendDesc = 'อยู่ในเทรนด์ขาขึ้นระยะยาว';
        bullets.push({
          type: 'pro',
          category: 'trend',
          text: `เทรนด์ระยะยาวเป็นบวก: ราคายืนเหนือเส้นค่าเฉลี่ย 200 วัน ($${sma200.toFixed(2)})`,
        });
      } else if (close < sma50 && sma50 < sma200) {
        conScore += 2;
        trendDesc = 'ขาลงต่อเนื่อง (Death Cross)';
        bullets.push({
          type: 'con',
          category: 'trend',
          text: `เทรนด์ขาลง: ราคาอยู่ใต้ทั้ง SMA 50 ($${sma50.toFixed(2)}) และ SMA 200 ($${sma200.toFixed(2)})`,
        });
      } else if (close < sma200) {
        conScore += 1;
        trendDesc = 'มีแรงกดดันขาลงระยะยาว';
        bullets.push({
          type: 'con',
          category: 'trend',
          text: `ราคาอยู่ใต้เส้น 200 วัน ($${sma200.toFixed(2)}) สะท้อนถึงแรงกดดันฝั่งขายในภาพใหญ่`,
        });
      }
    }
  }

  // ── 2. วิเคราะห์โมเมนตัมและระยะ 52 สัปดาห์ ───────────────────────────────
  if (metrics) {
    const { rsi14, fromHigh52Pct } = metrics;
    if (rsi14 !== null) {
      if (rsi14 >= 70) {
        conScore += 1;
        bullets.push({
          type: 'con',
          category: 'momentum',
          text: `RSI อยู่ในโซนซื้อมากเกินไป (${rsi14.toFixed(1)}) ระวังแรงขายทำกำไรหรือการพักตัวระยะสั้น`,
        });
      } else if (rsi14 <= 30) {
        proScore += 1;
        bullets.push({
          type: 'pro',
          category: 'momentum',
          text: `RSI เข้าเขตขายมากเกินไป (${rsi14.toFixed(1)}) ราคาเริ่มเข้าสู่โซนสะสมและอาจเกิด Technical Rebound`,
        });
      } else if (rsi14 >= 50) {
        proScore += 1;
        bullets.push({
          type: 'pro',
          category: 'momentum',
          text: `โมเมนตัมอยู่ในเกณฑ์ดี (RSI ${rsi14.toFixed(1)} ยืนเหนือระดับ 50)`,
        });
      } else {
        conScore += 0.5;
        bullets.push({
          type: 'con',
          category: 'momentum',
          text: `โมเมนตัมชะลอตัว (RSI ${rsi14.toFixed(1)} ต่ำกว่าระดับกึ่งกลาง 50)`,
        });
      }
    }

    if (fromHigh52Pct !== null) {
      if (fromHigh52Pct >= -5) {
        bullets.push({
          type: 'info',
          category: 'momentum',
          text: `ราคาใกล้เคียงจุดสูงสุดในรอบ 52 สัปดาห์ (ห่างเพียง ${Math.abs(fromHigh52Pct).toFixed(1)}%)`,
        });
      } else if (fromHigh52Pct <= -35) {
        bullets.push({
          type: 'info',
          category: 'momentum',
          text: `ราคาปรับฐานลงมาจากจุดสูงสุดรอบปีแล้ว ${Math.abs(fromHigh52Pct).toFixed(1)}%`,
        });
      }
    }
  }

  // ── 3. วิเคราะห์แนวรับ-แนวต้านหลัก ──────────────────────────────────────
  let levelDesc = '';
  if (levels) {
    const { status, supports, resistances, brokeResistance, brokeSupport } = levels;
    if (status === 'broke-resistance') {
      proScore += 2;
      levelDesc = 'เพิ่งเบรกทะลุแนวต้าน';
      bullets.push({
        type: 'pro',
        category: 'level',
        text: `สัญญาณเบรกเอาต์: เพิ่งทะลุแนวต้านสำคัญ ($${(brokeResistance?.price ?? resistances[0]?.price ?? 0).toFixed(2)}) ขึ้นมาได้`,
      });
    } else if (status === 'broke-support') {
      conScore += 2;
      levelDesc = 'เพิ่งหลุดแนวรับ';
      bullets.push({
        type: 'con',
        category: 'level',
        text: `สัญญาณเตือน: เพิ่งหลุดแนวรับสำคัญ ($${(brokeSupport?.price ?? supports[0]?.price ?? 0).toFixed(2)}) ลงไป`,
      });
    } else if (status === 'near-support') {
      proScore += 1.5;
      const sp = supports[0];
      levelDesc = 'พักตัวใกล้แนวรับ';
      bullets.push({
        type: 'pro',
        category: 'level',
        text: `ราคาพักตัวใกล้แนวรับสำคัญ ($${(sp?.price ?? 0).toFixed(2)} ห่าง ${Math.abs(sp?.distancePct ?? 0).toFixed(1)}%) เป็นจุดเสี่ยงต่ำสำหรับรอเข้าซื้อ`,
      });
    } else if (status === 'near-resistance') {
      conScore += 1;
      const res = resistances[0];
      levelDesc = 'ขึ้นชนแนวต้าน';
      bullets.push({
        type: 'con',
        category: 'level',
        text: `ราคาขึ้นมาใกล้แนวต้านสำคัญ ($${(res?.price ?? 0).toFixed(2)} ห่าง ${Math.abs(res?.distancePct ?? 0).toFixed(1)}%) อาจมีแรงต้านการขึ้น`,
      });
    }
  }

  // ── 4. วิเคราะห์งบการเงินและ Valuation ──────────────────────────────────
  if (fundamentals) {
    const { pe, revenueGrowth, profitMargin, debtToEquity, dividendYield, roe } = fundamentals;

    // Valuation P/E
    if (typeof pe === 'number') {
      if (pe > 0 && pe <= 20) {
        proScore += 1;
        bullets.push({
          type: 'pro',
          category: 'fundamental',
          text: `มูลค่าราคาไม่แพง: Trailing P/E อยู่ที่ ${pe.toFixed(1)}x`,
        });
      } else if (pe > 50) {
        conScore += 1;
        bullets.push({
          type: 'con',
          category: 'fundamental',
          text: `ราคาซื้อขายในระดับพรีเมียมสูง: P/E อยู่ที่ ${pe.toFixed(1)}x`,
        });
      } else if (pe < 0) {
        conScore += 0.5;
        bullets.push({
          type: 'con',
          category: 'fundamental',
          text: `บริษัทยังไม่มีกำไรสุทธิ (P/E ติดลบ)`,
        });
      }
    }

    // Revenue Growth
    if (typeof revenueGrowth === 'number') {
      if (revenueGrowth >= 0.15) {
        proScore += 1.5;
        bullets.push({
          type: 'pro',
          category: 'fundamental',
          text: `รายได้เติบโตแข็งแกร่ง: เพิ่มขึ้น ${(revenueGrowth * 100).toFixed(1)}% YoY`,
        });
      } else if (revenueGrowth < 0) {
        conScore += 1;
        bullets.push({
          type: 'con',
          category: 'fundamental',
          text: `รายได้ชะลอตัวลง: ติดลบ ${(Math.abs(revenueGrowth) * 100).toFixed(1)}% YoY`,
        });
      }
    }

    // Profit Margin
    if (typeof profitMargin === 'number') {
      if (profitMargin >= 0.2) {
        proScore += 1;
        bullets.push({
          type: 'pro',
          category: 'fundamental',
          text: `อัตรากำไรสุทธิสูงมาก (${(profitMargin * 100).toFixed(1)}%) สะท้อนความสามารถในการแข่งขัน (Moat)`,
        });
      } else if (profitMargin < 0) {
        conScore += 1;
        bullets.push({
          type: 'con',
          category: 'fundamental',
          text: `ผลการดำเนินงานขาดทุน (Net Margin ${(profitMargin * 100).toFixed(1)}%)`,
        });
      }
    }

    // Debt to Equity
    if (typeof debtToEquity === 'number' && debtToEquity > 200) {
      conScore += 1;
      bullets.push({
        type: 'con',
        category: 'fundamental',
        text: `ภาระหนี้สินค่อนข้างสูง: Debt/Equity ${debtToEquity.toFixed(0)}%`,
      });
    }

    // ROE
    if (typeof roe === 'number' && roe >= 0.15) {
      proScore += 0.5;
      bullets.push({
        type: 'pro',
        category: 'fundamental',
        text: `ผลตอบแทนต่อส่วนของผู้ถือหุ้น (ROE) แข็งแกร่ง ${(roe * 100).toFixed(1)}%`,
      });
    }

    // Dividend Yield
    if (typeof dividendYield === 'number' && dividendYield >= 0.015) {
      bullets.push({
        type: 'info',
        category: 'fundamental',
        text: `มีอัตราเงินปันผลตอบแทน ${(dividendYield * 100).toFixed(2)}% ต่อปี`,
      });
    }
  }

  // ── 5. วันประกาศงบการเงิน ──────────────────────────────────────────────
  if (typeof earningsDaysLeft === 'number') {
    if (earningsDaysLeft >= 0 && earningsDaysLeft <= 7) {
      conScore += 1.5;
      bullets.push({
        type: 'con',
        category: 'earnings',
        text: `⚠️ กำลังจะประกาศงบการเงินในอีก ${earningsDaysLeft === 0 ? 'วันนี้' : `${earningsDaysLeft} วัน`} มักมีความผันผวนของราคาสูงมาก`,
      });
    }
  }

  // ── 6. ประมวลผล Bias และสรุปภาพรวม ────────────────────────────────────
  let bias: TrendBias = 'neutral';
  if (proScore >= conScore + 1.5) {
    bias = 'bullish';
  } else if (conScore >= proScore + 1.5) {
    bias = 'bearish';
  }

  // สร้าง Headline
  let headline = '';
  if (bias === 'bullish') {
    headline = levelDesc
      ? `${trendDesc} · ${levelDesc}`
      : `${trendDesc} โมเมนตัมแข็งแกร่ง`;
  } else if (bias === 'bearish') {
    headline = levelDesc
      ? `${trendDesc} · ${levelDesc}`
      : `${trendDesc} ระวังแรงขายกดดัน`;
  } else {
    headline = levelDesc
      ? `แกว่งตัวในกรอบ · ${levelDesc}`
      : `ภาพรวมสมดุล กำลังสะสมกำลัง`;
  }

  // สร้าง Paragraph อธิบาย
  const priceStr = metrics ? `$${metrics.close.toFixed(2)}` : '';
  const paragraph = `${symbol} ปัจจุบันราคา ${priceStr} มีโครงสร้าง ${trendDesc} ${
    levelDesc ? `โดยสถานะล่าสุด${levelDesc}` : ''
  } ด้านโมเมนตัมและงบการเงินพบประเด็นเชิงบวก ${bullets.filter((b) => b.type === 'pro').length} ข้อ และข้อควรระวัง ${
    bullets.filter((b) => b.type === 'con').length
  } ข้อ`;

  // สร้าง Action Advice
  let actionAdvice = '';
  if (earningsDaysLeft !== null && earningsDaysLeft !== undefined && earningsDaysLeft >= 0 && earningsDaysLeft <= 5) {
    actionAdvice = '⚠️ ใกล้วันประกาศงบการเงิน ควรชะลอการเปิดสถานะใหม่ หรือลดขนาดไม้เพื่อควบคุมความผันผวน';
  } else if (bias === 'bullish') {
    if (levels?.status === 'near-support') {
      actionAdvice = 'โซนสะสม DCA เสี่ยงต่ำ: ราคาย่อตัวลงมาใกล้แนวรับสำคัญในขณะที่แนวโน้มหลักยังเป็นขาขึ้น';
    } else if (metrics?.rsi14 && metrics.rsi14 >= 70) {
      actionAdvice = 'แนวโน้มยังดีแต่ RSI ร้อนแรงเกินไป แนะนำรอจังหวะย่อตัวลงมาทดสอบแนวรับก่อนเข้าซื้อเพิ่ม';
    } else {
      actionAdvice = 'ทยอยสะสมตามแผน DCA ได้อย่างต่อเนื่อง โครงสร้างราคาส่วนใหญ่สนับสนุนทิศทางขาขึ้น';
    }
  } else if (bias === 'bearish') {
    if (levels?.status === 'near-support' && metrics?.rsi14 && metrics.rsi14 <= 30) {
      actionAdvice = 'ขาลงแต่ใกล้แนวรับและ RSI Oversold อาจมีเด้งระยะสั้น แต่ผู้ถือระยะยาวควรรอราคาสร้างฐานก่อน';
    } else {
      actionAdvice = 'ชะลอการซื้อถัวเฉลี่ย รอให้ราคาหยุดลงและสร้างฐานเหนือเส้นค่าเฉลี่ยสำคัญก่อนพิจารณาใหม่';
    }
  } else {
    actionAdvice = 'แกว่งตัวในกรอบ สามารถแบ่งไม้ซื้อสะสมทีละส่วน (DCA) ตามระดับแนวรับสำคัญได้';
  }

  return {
    symbol,
    bias,
    headline,
    paragraph,
    bullets,
    actionAdvice,
  };
}
