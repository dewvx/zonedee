/**
 * ส่งข้อความเข้า LINE ผ่าน Messaging API (LINE Notify ปิดบริการไปแล้ว มี.ค. 2025)
 *
 * ตั้งค่าใน .env ที่โฟลเดอร์โปรเจกต์ (ดู .env.example):
 *   LINE_CHANNEL_ACCESS_TOKEN=...   (LINE Developers → channel ของ OA → Messaging API → Channel access token)
 *   LINE_USER_ID=U...               (Basic settings → Your user ID — ส่งหาตัวเอง)
 *
 * แผนฟรีของ LINE OA จำกัดจำนวนข้อความ push ต่อเดือน — ดูที่เหลือได้ในหน้าแจ้งเตือน (quota)
 * แอปนี้ส่งเฉพาะข้อความแจ้งเตือนหาตัวเอง ไม่ได้ส่งคำสั่งซื้อขาย
 */
export interface LineConfig {
  token: string;
  userId: string;
}

export interface LineQuota {
  /** ข้อความที่ส่งได้ต่อเดือน (null = ไม่จำกัด) */
  limit: number | null;
  used: number;
}

type FetchFn = typeof fetch;

export interface LineNotifier {
  readonly configured: boolean;
  push(text: string): Promise<void>;
  quota(): Promise<LineQuota>;
}

const API = 'https://api.line.me/v2/bot';
/** LINE จำกัดข้อความละ 5,000 ตัวอักษร */
const MAX_TEXT = 4900;

export function lineConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LineConfig | null {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const userId = env.LINE_USER_ID?.trim();
  return token && userId ? { token, userId } : null;
}

export function createLineNotifier(cfg: LineConfig | null, fetchFn: FetchFn = fetch): LineNotifier {
  const call = async (path: string, init?: RequestInit) => {
    if (!cfg) throw new Error('ยังไม่ได้ตั้งค่า LINE (ใส่ LINE_CHANNEL_ACCESS_TOKEN และ LINE_USER_ID ใน .env แล้วเปิด server ใหม่)');
    const res = await fetchFn(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      const hint =
        res.status === 401
          ? ' — token ผิดหรือหมดอายุ'
          : res.status === 429
            ? ' — ส่งเกินโควต้าเดือนนี้แล้ว หรือส่งถี่เกิน'
            : res.status === 400
              ? ' — เช็ก LINE_USER_ID และต้องแอด OA เป็นเพื่อนก่อน'
              : '';
      throw new Error(`LINE ตอบ ${res.status}: ${body.message ?? res.statusText}${hint}`);
    }
    return res;
  };

  return {
    configured: cfg !== null,
    async push(text) {
      await call('/message/push', {
        method: 'POST',
        body: JSON.stringify({ to: cfg?.userId, messages: [{ type: 'text', text: text.slice(0, MAX_TEXT) }] }),
      });
    },
    async quota() {
      const [q, c] = await Promise.all([call('/message/quota'), call('/message/quota/consumption')]);
      const quota = (await q.json()) as { type: 'none' | 'limited'; value?: number };
      const used = (await c.json()) as { totalUsage: number };
      return { limit: quota.type === 'limited' ? (quota.value ?? 0) : null, used: used.totalUsage };
    },
  };
}
