import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignHandler, campaignStoreName, CONTENT_STORE, MEDIA_STORE } from '../gg-campaign-site/server/campaign.mjs';
import { youtubeId, MAX_IMAGE_BYTES } from '../gg-campaign-site/campaign-shared.js';

const secret = 'unit-test-only-not-a-real-credential';
function fixture(seed = {}, { omitETag = false } = {}) {
  const stores = new Map(); let version = 0, conflict = false;
  const getStore = ({ name }) => {
    assert.ok([CONTENT_STORE, MEDIA_STORE].includes(name), 'must never access board stores');
    if (!stores.has(name)) stores.set(name, new Map());
    const values = stores.get(name);
    return {
      async getWithMetadata(key) { const value = structuredClone(values.get(key) || null); if (value && omitETag) delete value.etag; return value; },
      async list() { return { blobs: [...values].map(([key, value]) => ({ key, etag: value.etag })) }; },
      async getMetadata(key) { return values.has(key) ? { etag: values.get(key).etag } : null; },
      async set(key, data, options) { return this.setJSON(key, data, options); },
      async setJSON(key, data, options) {
        if (conflict || (options.onlyIfNew && values.has(key)) || (options.onlyIfMatch && values.get(key)?.etag !== options.onlyIfMatch)) return { modified: false };
        const etag = `v${++version}`; values.set(key, { data: structuredClone(data), etag }); return { modified: true, etag };
      }
    };
  };
  const handler = createCampaignHandler({ getStore, seed, secret: () => secret });
  async function request(method = 'GET', body, { auth = true, query = '', headers = {}, raw } = {}) {
    const response = await handler(new Request('http://localhost/.netlify/functions/campaign' + query, {
      method, headers: { ...(auth ? { Authorization: 'Bearer ' + secret } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined)
    }));
    return { status: response.status, body: (response.headers.get('content-type') || '').includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()), headers: response.headers };
  }
  return { request, conflict: () => { conflict = true; }, stores };
}
const news = { kind: 'news', title: '<img onerror=alert(1)>', date: '2026-10-30', content: '본문\n두 번째 줄', images: [], revision: 'initial' };

test('YouTube allowlist rejects channels, userinfo, ports, scripts and spoofed hosts', () => {
  for (const u of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://youtube.com/@channel', 'http://youtu.be/abcdefghijk', 'https://user@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:444/watch?v=abcdefghijk', 'https://youtu.be/short', 'https://youtube.com/shorts/abcdefghijk/extra']) assert.equal(youtubeId(u), '');
  for (const u of ['https://www.youtube.com/shorts/abcdefghijk?si=x', 'https://youtu.be/abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk&t=1']) assert.equal(youtubeId(u), 'abcdefghijk');
});
test('runtime deployment context isolates preview stores from production and other previews', () => {
  assert.equal(campaignStoreName(CONTENT_STORE, { context: 'production' }, {}), CONTENT_STORE);
  const a = campaignStoreName(CONTENT_STORE, { context: 'deploy-preview', id: 'one' }, {});
  assert.notEqual(a, CONTENT_STORE);
  assert.notEqual(a, campaignStoreName(CONTENT_STORE, { context: 'deploy-preview', id: 'two' }, {}));
  assert.equal(campaignStoreName(MEDIA_STORE, { context: 'deploy-preview', id: 'new' }, { REVIEW_ID: '1' }), campaignStoreName(MEDIA_STORE, { context: 'deploy-preview', id: 'old' }, { REVIEW_ID: '1' }));
});
test('public seed preserves real legacy news; channel does not become a candidate video', async () => {
  const { request, stores } = fixture({ news: [{ title: '기존 소식', date: '2026-10-29', content: '원문', image: '/images/기존.jpg' }], videoUrl: 'https://youtube.com/@channel' });
  const r = await request(); assert.equal(r.status, 200); assert.equal(r.body.videoUrl, ''); assert.equal(r.body.news[0].title, '기존 소식'); assert.deepEqual(r.body.news[0].images, ['/images/기존.jpg']); assert.equal(stores.get(CONTENT_STORE).size, 0);
});
test('all write routes and admin reads require server auth, even with admin fields in body', async () => {
  const { request } = fixture();
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request(method, { ...news, admin: true }, { auth: false })).status, 401);
  assert.equal((await request('GET', null, { auth: false, query: '?admin=1' })).status, 401);
  assert.equal((await request('POST', null, { auth: false, query: '?upload=1', raw: 'image' })).status, 401);
});
test('cross-origin writes/reads are rejected', async () => {
  const { request } = fixture(); assert.equal((await request('POST', news, { headers: { Origin: 'https://evil.test' } })).status, 403);
});
test('news create/edit/delete, stale revisions and nonexisting records', async () => {
  const { request } = fixture(); const created = await request('POST', news); assert.equal(created.status, 201);
  const id = created.body.news[0].id;
  assert.equal((await request('PATCH', { ...news, id })).status, 409);
  const edited = await request('PATCH', { ...news, id, revision: created.body.revision, title: '수정한 소식' }); assert.equal(edited.body.news[0].title, '수정한 소식');
  const removed = await request('DELETE', { kind: 'news', id, revision: edited.body.revision }); assert.equal(removed.status, 200); assert.equal(removed.body.news.length, 0);
  assert.equal((await request('DELETE', { kind: 'news', id, revision: removed.body.revision })).status, 404);
});
test('atomic storage conflict returns 409 instead of overwriting concurrent changes', async () => {
  const f = fixture(); f.conflict(); assert.equal((await f.request('POST', news)).status, 409);
});
test('local emulator missing GET ETag uses bracketed listing without dropping conditional writes', async () => {
  const { request } = fixture({}, { omitETag: true });
  const a = await request('POST', news);
  const read = await request(); assert.equal(read.body.revision, a.body.revision);
  const b = await request('PATCH', { ...news, id: a.body.news[0].id, title: '안전한 수정', revision: a.body.revision });
  assert.equal(b.status, 200); assert.equal(b.body.news[0].title, '안전한 수정');
  assert.equal((await request('PATCH', { ...news, id: a.body.news[0].id, revision: a.body.revision })).status, 409);
});
test('record and UTF-8 byte limits keep published responses below buffered function limits', async () => {
  const seedNews = count => Array.from({ length: count }, (_, i) => ({ title: `소식 ${i}`, date: '2026-10-30', content: '가'.repeat(6000) }));
  assert.equal((await fixture({ news: seedNews(200) }).request('POST', news)).status, 400);
  assert.equal((await fixture({ news: seedNews(250) }).request('PATCH', { kind: 'video', url: '', revision: 'initial' })).status, 400);
});
test('shorts create/edit/delete and invalid URLs', async () => {
  const { request } = fixture();
  assert.equal((await request('POST', { ...news, kind: 'shorts', url: 'javascript:alert(1)' })).status, 400);
  const a = await request('POST', { kind: 'shorts', title: '현장 영상', url: 'https://youtube.com/shorts/abcdefghijk', revision: 'initial' }); assert.equal(a.status, 201);
  const b = await request('PATCH', { kind: 'shorts', id: a.body.shorts[0].id, title: '영상 수정', url: 'https://youtu.be/12345678901', revision: a.body.revision }); assert.equal(b.body.shorts[0].url, 'https://www.youtube.com/watch?v=12345678901');
  const c = await request('DELETE', { kind: 'shorts', id: b.body.shorts[0].id, revision: b.body.revision }); assert.equal(c.body.shorts.length, 0);
});
test('candidate video can be set and cleared, rejects channel URLs', async () => {
  const { request } = fixture();
  assert.equal((await request('PATCH', { kind: 'video', url: 'https://youtube.com/@channel', revision: 'initial' })).status, 400);
  const a = await request('PATCH', { kind: 'video', url: 'https://youtu.be/abcdefghijk', revision: 'initial' }); assert.equal(a.status, 200);
  assert.equal((await request('PATCH', { kind: 'video', url: '', revision: a.body.revision })).body.videoUrl, '');
});
test('bounded metadata, real date checks, photo count and external media rejection', async () => {
  const { request } = fixture();
  for (const overrides of [{ title: '' }, { title: 'a'.repeat(121) }, { date: '2026-02-30' }, { content: 'a'.repeat(6001) }, { images: Array(9).fill('x') }, { images: ['https://evil.test/pixel'] }, { images: ['/images/not-an-existing-photo.jpg'] }]) assert.equal((await request('POST', { ...news, ...overrides })).status, 400, JSON.stringify(overrides).slice(0, 100));
  assert.equal((await request('POST', null, { headers: { 'Content-Type': 'application/json' }, raw: 'x'.repeat(32769) })).status, 413);
});
test('uploads reject spoofed types, invalid signatures and over-limit streamed bodies', async () => {
  const { request } = fixture();
  assert.equal((await request('POST', null, { query: '?upload=1', headers: { 'Content-Type': 'image/svg+xml' }, raw: '<svg/>' })).status, 415);
  assert.equal((await request('POST', null, { query: '?upload=1', headers: { 'Content-Type': 'image/webp' }, raw: '<script>bad</script>' })).status, 415);
  assert.equal((await request('POST', null, { query: '?upload=1', headers: { 'Content-Type': 'image/webp' }, raw: new Uint8Array(MAX_IMAGE_BYTES + 1) })).status, 413);
});
test('uploaded media can be referenced, served with safe caching, and survives news deletion', async () => {
  const { request } = fixture(); const bytes = new Uint8Array(24); bytes.set(Buffer.from('RIFF'), 0); bytes.set(Buffer.from('WEBPVP8 '), 8); new DataView(bytes.buffer).setUint32(4, 16, true);
  const photo = await request('POST', null, { query: '?upload=1', raw: bytes, headers: { 'Content-Type': 'image/webp' } }); assert.equal(photo.status, 201);
  const a = await request('POST', { ...news, images: [photo.body.url] }); assert.equal(a.status, 201);
  await request('DELETE', { kind: 'news', id: a.body.news[0].id, revision: a.body.revision });
  const image = await request('GET', null, { auth: false, query: '?image=' + photo.body.id }); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/webp'); assert.deepEqual(image.body, bytes);
  assert.equal((await request('GET', null, { query: '?image=../secret' })).status, 404);
});
test('storage failure and corrupt content never silently reset the store', async () => {
  const handler = createCampaignHandler({ getStore: () => ({ getWithMetadata: async () => ({ data: {} }) }) });
  assert.equal((await handler(new Request('http://localhost/'))).status, 503);
});
