import type { Fetchers } from '../fetch-job';
import { fetchDukascopy } from './dukascopy';
import { fetchMt5 } from './mt5';
import { fetchYahoo, searchYahoo, yahooFundamentals, type YahooSearchResult } from './yahoo';

/** ตัวดึงข้อมูลจริงของแต่ละแหล่ง — ใช้ร่วมกันทั้ง CLI และ API */
export const FETCHERS: Fetchers = { yahoo: fetchYahoo, mt5: fetchMt5, dukascopy: fetchDukascopy };
export { searchYahoo, yahooFundamentals, type YahooSearchResult };
