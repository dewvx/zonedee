import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { JournalStore } from '../src/journal';
import { CandleStore } from '../src/store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
// PNG 1×1 โปร่งใส
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let dir: string;
let journal: JournalStore;
let store: CandleStore;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zonedee-journal-'));
  journal = new JournalStore(':memory:', join(dir, 'img'));
  store = new CandleStore(':memory:');
  const app = createApp({ store, runFetch: async () => ({ symbol: '', source: '', total: 0, errors: [], durationMs: 0 }), journal });
  server = await new Promise<Server>((r) => {
    const s = app.listen(0, () => r(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  journal.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('journal API', () => {
  it('สร้าง → ปิดเทรด → คิด R ให้ · รายการเรียงใหม่ก่อน', async () => {
    const a = (await (await send('POST', '/api/journal', { symbol: 'xauusd', tf: 'M5', direction: 'long', status: 'open', entryPrice: 2650, sl: 2645, tp: 2660 })).json()) as Json;
    expect(a).toMatchObject({ id: 1, symbol: 'XAUUSD', status: 'open', r: null });
    const closed = (await (await send('PUT', `/api/journal/${a.id}`, { status: 'closed', exitPrice: 2660 })).json()) as Json;
    expect(closed.r).toBeCloseTo(2);
    await send('POST', '/api/journal', { symbol: 'EURUSD', direction: 'short' });
    const list = (await (await fetch(`${base}/api/journal`)).json()) as Json[];
    expect(list.map((e) => e.symbol)).toEqual(['EURUSD', 'XAUUSD']);
  });

  it('รูป: แนบตอนสร้าง + เพิ่ม/ลบทีหลัง + เปิดดูได้ · ลบรายการ = ลบไฟล์', async () => {
    const e = (await (await send('POST', '/api/journal', { symbol: 'XAUUSD', image: PNG })).json()) as Json;
    expect(e.images).toHaveLength(1);
    const img = await fetch(`${base}/api/journal-images/${e.images[0]}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toContain('image/png');
    const e2 = (await (await send('POST', `/api/journal/${e.id}/images`, { dataUrl: PNG })).json()) as Json;
    expect(e2.images).toHaveLength(2);
    const e3 = (await (await send('DELETE', `/api/journal/${e.id}/images/${e2.images[0]}`)).json()) as Json;
    expect(e3.images).toEqual([e2.images[1]]);
    expect((await send('DELETE', `/api/journal/${e.id}`)).status).toBe(204);
    expect(existsSync(join(dir, 'img', e2.images[1]))).toBe(false);
  });

  it('ข้อมูลผิด → 400 / ไม่เจอ → 404 / ชื่อรูปแปลก → 404', async () => {
    expect((await send('POST', '/api/journal', { direction: 'long' })).status).toBe(400);
    expect((await send('PUT', '/api/journal/99', { symbol: 'X' })).status).toBe(404);
    const e = (await (await send('POST', '/api/journal', { symbol: 'XAUUSD' })).json()) as Json;
    expect((await send('POST', `/api/journal/${e.id}/images`, { dataUrl: 'data:text/html;base64,AAAA' })).status).toBe(400);
    expect((await fetch(`${base}/api/journal-images/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });
});
