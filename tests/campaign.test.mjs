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

test('existing production content without the new fields remains compatible', async () => {
  const { request } = fixture();
  const old = await request('POST', news);
  assert.equal(old.status, 201);
  const r = await request('GET', null, { auth: false });
  assert.deepEqual(r.body.sectorPolicies, []);
  assert.deepEqual(r.body.videos, []);
  assert.equal(r.body.news.length, 1);
  const first = await request('POST', { kind: 'sectorPolicies', union: '공공운수노조', field: '택시', title: '일한 만큼 월급', content: '공약 내용', published: true, revision: r.body.revision });
  assert.equal(first.status, 201);
  assert.equal(first.body.news.length, 1);
  assert.ok(first.body.sectorPolicies[0].publishedAt);
});

test('sector policy draft publishing timestamps and edits are stable', async () => {
  const { request } = fixture();
  const draft = await request('POST', { kind: 'sectorPolicies', union: '공공운수노조', field: '화물', title: '화물 공약', content: '첫 내용', published: false, revision: 'initial' });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.sectorPolicies[0].publishedAt, null);
  const item = draft.body.sectorPolicies[0];
  const published = await request('PATCH', { kind: 'sectorPolicies', id: item.id, union: item.union, field: item.field, title: item.title, content: item.content, published: true, revision: draft.body.revision });
  const date = published.body.sectorPolicies[0].publishedAt;
  assert.ok(Date.parse(date) > Date.now() - 60_000);
  const edited = await request('PATCH', { kind: 'sectorPolicies', id: item.id, union: item.union, field: item.field, title: '문구 교체', content: '수정', published: true, revision: published.body.revision });
  assert.equal(edited.body.sectorPolicies[0].publishedAt, date);
  const hidden = await request('PATCH', { kind: 'sectorPolicies', id: item.id, union: item.union, field: item.field, title: '문구 교체', content: '수정', published: false, revision: edited.body.revision });
  assert.equal(hidden.body.sectorPolicies[0].published, false);
  const removed = await request('DELETE', { kind: 'sectorPolicies', id: item.id, revision: hidden.body.revision });
  assert.equal(removed.body.sectorPolicies.length, 0);
});

test('sector policy and landscape video validate inputs and require authorization', async () => {
  const { request } = fixture();
  const base = { kind: 'sectorPolicies', union: '금속노조', field: '', title: '공약', content: '공약 내용', published: true, revision: 'initial' };
  for (const patch of [{ union: '' }, { title: '<'.repeat(121) }, { content: '' }, { published: 'true' }, { field: '나'.repeat(81) }]) {
    assert.equal((await request('POST', { ...base, ...patch })).status, 400);
  }
  assert.equal((await request('POST', base, { auth: false })).status, 401);
  assert.equal((await request('POST', { kind: 'videos', title: '영상', url: 'https://youtube.com/@channel', revision: 'initial' })).status, 400);
  assert.equal((await request('POST', { kind: 'videos', title: '영상', url: 'https://youtu.be/abcdefghijk', revision: 'initial' }, { auth: false })).status, 401);
});

test('multiple landscape videos preserve the single existing representative video', async () => {
  const { request } = fixture();
  const original = await request('PATCH', { kind: 'video', url: 'https://youtu.be/abcdefghijk', revision: 'initial' });
  const v1 = await request('POST', { kind: 'videos', title: '첫 번째 가로영상', url: 'https://youtu.be/12345678901', revision: original.body.revision });
  assert.equal(v1.status, 201);
  const v2 = await request('POST', { kind: 'videos', title: '두 번째 가로영상', url: 'https://www.youtube.com/watch?v=ABCDEFGHIJK', revision: v1.body.revision });
  assert.equal(v2.body.videoUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(v2.body.videos.length, 2);
  const change = await request('PATCH', { kind: 'videos', id: v2.body.videos[0].id, title: '수정된 제목', url: 'https://youtu.be/12345678901', revision: v2.body.revision });
  assert.equal(change.body.videos[0].title, '수정된 제목');
  const del = await request('DELETE', { kind: 'videos', id: change.body.videos[0].id, revision: change.body.revision });
  assert.equal(del.body.videos.length, 1);
  assert.equal(del.body.videoUrl, v2.body.videoUrl);
});

test('unpublished sector drafts stay private in public API but visible to admins', async () => {
  const { request } = fixture();
  const draft = await request('POST', { kind: 'sectorPolicies', union: '금속노조', field: '자동차부품', title: '미공개 내용', content: '외부에 공개하지 않을 공약', published: false, revision: 'initial' });
  assert.equal(draft.status, 201);
  const publicRead = await request('GET', null, { auth: false });
  assert.equal(publicRead.body.sectorPolicies.length, 0);
  const adminRead = await request('GET', null, { query: '?admin=1' });
  assert.equal(adminRead.body.sectorPolicies.length, 1);
  assert.equal(adminRead.body.sectorPolicies[0].title, '미공개 내용');
  const item = adminRead.body.sectorPolicies[0];
  const publiced = await request('PATCH', { kind: 'sectorPolicies', id: item.id, union: item.union, field: item.field, title: item.title, content: item.content, published: true, revision: adminRead.body.revision });
  const visible = await request('GET', null, { auth: false });
  assert.equal(visible.body.sectorPolicies[0].publishedAt, publiced.body.sectorPolicies[0].publishedAt);
});

test('construction seed publishes three revised policies even with pre-existing Netlify data', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  assert.equal(seed.sectorPolicies.length, 14);
  assert.deepEqual(seed.sectorPolicies.filter(p => p.union === '건설노동자').map(p => p.order), [1, 2, 3]);
  assert.ok(seed.sectorPolicies.every(p => p.published));
  assert.equal(seed.sectorPolicies.filter(p => p.union === '건설노동자' && p.field === '건설노조').length, 3);
  const f = fixture(seed);
  f.stores.set(CONTENT_STORE, new Map([['published', {
    data: { news: [{ id: 'news-1', title: '기존 소식', date: '2026-10-30', content: '보존', images: [] }],
      shorts: [{ id: 'short-1', title: '기존 쇼츠', url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
      videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk', videos: [], sectorPolicies: [] },
    etag: 'existing-revision-1'
  }]]));
  const read = await f.request('GET', null, { auth: false });
  assert.equal(read.status, 200);
  assert.equal(read.body.news[0].title, '기존 소식');
  assert.equal(read.body.shorts.length, 1);
  assert.equal(read.body.videoUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(read.body.sectorPolicies.length, 14);
  const admin = await f.request('GET', null, { query: '?admin=1' });
  assert.equal(admin.body.sectorPolicies.length, 14);
  const target = admin.body.sectorPolicies.find(p => p.order === 1);
  const updated = await f.request('PATCH', { kind: 'sectorPolicies', id: target.id, union: target.union,
    field: target.field, title: '수정 테스트', content: target.content, published: true,
    revision: admin.body.revision });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.sectorPolicies.length, 14);
  assert.equal(updated.body.sectorPolicies.find(p => p.id === target.id).headline, target.headline);
  assert.equal(updated.body.sectorPolicies.find(p => p.id === target.id).order, 1);
  assert.equal(updated.body.sectorPolicies.find(p => p.id === target.id).publishedAt, target.publishedAt);
  assert.equal(updated.body.news[0].title, '기존 소식');
  const deleted = await f.request('DELETE', { kind: 'sectorPolicies', id: target.id, revision: updated.body.revision });
  assert.equal(deleted.status, 200);
  const readAgain = await f.request('GET', null, { auth: false });
  assert.equal(readAgain.body.sectorPolicies.length, 13);
  assert.ok(!readAgain.body.sectorPolicies.some(p => p.id === target.id));
  assert.equal(readAgain.body.news.length, 1);
});


test('education worker seed adds three published, 72-hour NEW eligible policies without disturbing construction', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const education = seed.sectorPolicies.filter(p => p.union === '교육노동자');
  assert.equal(education.length, 3);
  assert.deepEqual(education.map(p => p.order), [1, 2, 3]);
  assert.ok(education.every(p => p.published && p.field === '교육' && p.headline === '교육노동자와 함께 만들겠습니다.'));
  assert.ok(education.every(p => Number.isFinite(Date.parse(p.publishedAt))));
  assert.match(education[0].content, /지방교육재정교부금 축소 반대/);
  assert.match(education[1].content, /교원노조법 폐기/);
  assert.match(education[2].content, /학교 AI 사용은 교육주체 토론과 합의로/);
  const f = fixture(seed);
  const read = await f.request('GET', null, { auth: false });
  assert.equal(read.body.sectorPolicies.filter(p => p.union === '교육노동자').length, 3);
  assert.equal(read.body.sectorPolicies.filter(p => p.union === '건설노동자').length, 3);
});

test('construction headline and three revised text blocks remain complete', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const items = seed.sectorPolicies.filter(p => p.union === '건설노동자');
  assert.equal(items[0].headline, '건설노동자와 함께 만들겠습니다.');
  assert.match(items[0].content, /50억 미만 소규모 건설현장 '안전관리자 고용 기금' 조성/);
  assert.match(items[1].content, /경기도 유관 실·국과 건설노조 간 '직통 노정교섭' 지원/);
  assert.match(items[2].content, /성남·안산 건설기능학교 운영 예산 복원 및 확대/);
  assert.match(items[2].content, /한전 규정 개정 시 노조 소통 창구 마련/);
});

test('construction web poster appears on sector pledges even in preexisting production content', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const construction = seed.sectorPolicies[0];
  assert.equal(construction.poster, '/images/construction-poster.webp');
  const f = fixture(seed);
  const saved = structuredClone(seed.sectorPolicies);
  delete saved[0].poster; // mirrors production data saved before web poster functionality
  f.stores.set(CONTENT_STORE, new Map([['published', {
    data: { news: [], shorts: [], videoUrl: '', videos: [], sectorPolicies: saved },
    etag: 'earlier-version'
  }]]));
  const publicRead = await f.request('GET', null, { auth: false });
  assert.equal(publicRead.body.sectorPolicies[0].poster, '/images/construction-poster.webp');
  const edit = await f.request('PATCH', { kind: 'sectorPolicies', id: construction.id,
    union: construction.union, field: construction.field, title: construction.title,
    content: construction.content, published: true, revision: publicRead.body.revision });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.sectorPolicies[0].poster, '/images/construction-poster.webp');
  const remove = await f.request('PATCH', { kind: 'sectorPolicies', id: construction.id,
    union: construction.union, field: construction.field, title: construction.title,
    content: construction.content, poster: '', published: true, revision: edit.body.revision });
  assert.equal(remove.status, 200);
  const afterRemoval = await f.request('GET', null, { auth: false });
  assert.equal(afterRemoval.body.sectorPolicies[0].poster, '');
});

test('sector poster uploads reuse protected WebP pipeline and disallow remote images', async () => {
  const f = fixture();
  const base = { kind: 'sectorPolicies', union: '공공운수노조', field: '택시', title: '공약',
    content: '내용', published: true, revision: 'initial' };
  assert.equal((await f.request('POST', { ...base, poster: 'https://attacker.invalid/pixel.webp' })).status, 400);
  assert.equal((await f.request('POST', { ...base, poster: '/images/other.jpg' })).status, 400);
  assert.equal((await f.request('POST', { ...base, poster: 123 })).status, 400);
  const bytes = new Uint8Array(24); bytes.set(Buffer.from('RIFF'), 0); bytes.set(Buffer.from('WEBPVP8 '), 8);
  new DataView(bytes.buffer).setUint32(4, 16, true);
  const upload = await f.request('POST', null, { query: '?upload=1', raw: bytes, headers: { 'Content-Type': 'image/webp' } });
  assert.equal(upload.status, 201);
  const created = await f.request('POST', { ...base, poster: upload.body.url });
  assert.equal(created.status, 201);
  assert.equal(created.body.sectorPolicies[0].poster, upload.body.url);
  const updated = await f.request('PATCH', { ...base, id: created.body.sectorPolicies[0].id,
    revision: created.body.revision, title: '문구 수정' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.sectorPolicies[0].poster, upload.body.url);
});

test('worker-facing card headline is validated, saved and remains editable', async () => {
  const f = fixture();
  const body = { kind: 'sectorPolicies', union: '건설산업연맹', field: '건설노조',
    title: '건설 공약', content: '현장 약속', published: true,
    headline: '건설노동자와 함께 만들겠습니다.', revision: 'initial' };
  assert.equal((await f.request('POST', { ...body, headline: '다른 표현' })).status, 400);
  const created = await f.request('POST', body);
  assert.equal(created.status, 201);
  assert.equal(created.body.sectorPolicies[0].headline, '건설노동자와 함께 만들겠습니다.');
  const original = created.body.sectorPolicies[0];
  const updated = await f.request('PATCH', { ...body, id: original.id,
    headline: '건설기계노동자와 함께 만들겠습니다.', revision: created.body.revision });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.sectorPolicies[0].headline, '건설기계노동자와 함께 만들겠습니다.');
  assert.equal(updated.body.sectorPolicies[0].publishedAt, original.publishedAt);
  const olderApiEdit = await f.request('PATCH', { kind: 'sectorPolicies', id: original.id,
    union: original.union, field: original.field, title: '변경', content: '새로운 내용',
    published: true, revision: updated.body.revision });
  assert.equal(olderApiEdit.status, 200);
  assert.equal(olderApiEdit.body.sectorPolicies[0].headline, '건설기계노동자와 함께 만들겠습니다.');
  assert.equal(olderApiEdit.body.sectorPolicies[0].union, '건설노동자');
});

test('migrates four saved construction pledges to three without losing unrelated live data', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const oldTime = '2026-11-03T00:00:00.000Z';
  const previous = [1, 2, 3, 4].map(n => ({
    id: `seed-construction-20261103-${n}`, union: '건설산업연맹', field: '건설노조',
    title: `이전 공약 ${n}`, content: `이전 내용 ${n}`, headline: '건설노동자와 함께 만들겠습니다.',
    order: n, published: true, publishedAt: oldTime,
    ...(n === 1 ? { poster: '/images/construction-poster.webp' } : {})
  }));
  const independent = { id: 'other-sector', union: '금속노조', field: '자동차부품',
    title: '별도 공약', content: '유지할 내용', published: true, publishedAt: oldTime };
  const f = fixture(seed);
  f.stores.set(CONTENT_STORE, new Map([['published', {
    data: {
      news: [{ id: 'saved-news', title: '기존 사진과 소식', date: '2026-11-02',
        content: '변경 금지', images: ['images/old.jpg'] }],
      shorts: [{ id: 'saved-short', title: '기존 쇼츠', url: 'https://youtu.be/abcdefghijk' }],
      videos: [{ id: 'saved-video', title: '가로 영상', url: 'https://youtu.be/abcdefghijk' }],
      videoUrl: 'https://youtu.be/abcdefghijk',
      sectorPolicies: [...previous, independent]
    }, etag: 'old-save'
  }]]));
  const initial = await f.request('GET', null, { auth: false });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.news.length, 1);
  assert.equal(initial.body.shorts.length, 1);
  assert.equal(initial.body.videos.length, 1);
  assert.equal(initial.body.videoUrl, 'https://youtu.be/abcdefghijk');
  assert.equal(initial.body.constructionContentVersion, 2);
  const construction = initial.body.sectorPolicies.filter(p => p.union === '건설노동자');
  assert.equal(construction.length, 3);
  assert.deepEqual(construction.map(p => p.title), seed.sectorPolicies.filter(p => p.union === '건설노동자').map(p => p.title));
  assert.deepEqual(construction.map(p => p.content), seed.sectorPolicies.filter(p => p.union === '건설노동자').map(p => p.content));
  assert.equal(construction[0].poster, '/images/construction-poster.webp');
  assert.equal(construction[0].publishedAt, oldTime);
  assert.equal(initial.body.sectorPolicies.find(p => p.id === 'other-sector').title, '별도 공약');
  const edited = await f.request('PATCH', {
    kind: 'sectorPolicies', id: construction[0].id, union: construction[0].union,
    field: construction[0].field, headline: construction[0].headline,
    title: '수정 후 유지되는 제목', content: construction[0].content,
    poster: construction[0].poster, published: true, revision: initial.body.revision
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.constructionContentVersion, 2);
  const afterEdit = await f.request('GET', null, { auth: false });
  assert.equal(afterEdit.body.sectorPolicies.find(p => p.id === construction[0].id).title, '수정 후 유지되는 제목');
  assert.equal(afterEdit.body.sectorPolicies.filter(p => p.union === '건설노동자').length, 3);
  assert.equal(afterEdit.body.news[0].images[0], 'images/old.jpg');
  const deleted = await f.request('DELETE', { kind: 'sectorPolicies',
    id: construction[2].id, revision: edited.body.revision });
  assert.equal(deleted.status, 200);
  const afterDeletion = await f.request('GET', null, { auth: false });
  assert.equal(afterDeletion.body.sectorPolicies.filter(p => p.union === '건설노동자').length, 2);
  assert.equal(afterDeletion.body.sectorPolicies.find(p => p.id === 'other-sector').content, '유지할 내용');
});

test('the revised construction policies preserve all fourteen detail lines verbatim', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const items = seed.sectorPolicies.filter(p => p.union === '건설노동자');
  assert.deepEqual(items.map(x => x.content.split('\n').length), [5, 5, 4]);
  assert.equal(items[0].title, "'모범 발주자' 경기도의 역할 강제, 불법하도급·체불 근절");
  assert.equal(items[1].title, '경기도 조례 개정, 경기도 노정교섭 구축');
  assert.equal(items[2].title, '건설노동자 참여 & 안전망 구축');
  assert.match(items[0].content, /불법하도급 지자체 단속 강화, 노동조합 직접 참여 요구/);
  assert.match(items[1].content, /지역건설노동자·장비 ‘우선 고용’ 조례 개정 및 현실화/);
  assert.match(items[2].content, /전기노동자 불이익 처분 시 소명 기회 보장/);
});

test('IT, civil service and healthcare policies are added verbatim without changing existing sectors', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const names = ['IT노동자', '공무원노동자', '보건의료노동자'];
  const counts = [3, 2, 3], bulletCounts = [[3, 2, 2], [3, 3], [2, 3, 2]];
  for (let k = 0; k < names.length; k++) {
    const sector = seed.sectorPolicies.filter(p => p.union === names[k]);
    assert.equal(sector.length, counts[k], names[k]);
    assert.deepEqual(sector.map(p => p.order), Array.from({ length: counts[k] }, (_, i) => i + 1));
    assert.deepEqual(sector.map(p => p.content.split('\n').length), bulletCounts[k]);
    assert.ok(sector.every(p => p.published && p.headline === names[k] + '와 함께 만들겠습니다.'));
    assert.ok(sector.every(p => Number.isFinite(Date.parse(p.publishedAt))));
  }
  const it = seed.sectorPolicies.filter(p => p.union === 'IT노동자');
  assert.equal(it[0].title, '고정 OT를 포함한 포괄임금제 근절');
  assert.match(it[0].content, /화섬식품노조 IT위원회의 표준근로계약서 제작 논의 및 사용 장려/);
  assert.match(it[1].content, /경기고용노동청, 지청 등에 관련 민원 발생 시 적극적이고 신속한 개입 유도/);
  assert.match(it[2].content, /성남지청 등 노동기본권 보호, 보장을 위한 정례 협의 확대/);
  const civil = seed.sectorPolicies.filter(p => p.union === '공무원노동자');
  assert.match(civil[0].content, /정치기본권 보장으로 시민의 권리 회복/);
  assert.match(civil[1].content, /악성민원-갑질, 민주노총 감정노동 공동대응으로 완전 근절/);
  const health = seed.sectorPolicies.filter(p => p.union === '보건의료노동자');
  assert.match(health[0].content, /국립 암센터\) 총액인건비 폐지/);
  assert.match(health[1].content, /현장투쟁의 든든한 뒷배 경기법률원 개소/);
  assert.match(health[2].content, /산별 영역을 넘는 초기업단위 교섭/);
  const f = fixture(seed);
  const read = await f.request('GET', null, { auth: false });
  assert.equal(read.status, 200);
  assert.equal(read.body.sectorPolicies.length, 14);
  for(const [k,name] of names.entries()) assert.equal(read.body.sectorPolicies.filter(p => p.union === name).length, counts[k]);
  assert.equal(read.body.sectorPolicies.filter(p => p.union === '건설노동자').length, 3);
  assert.equal(read.body.sectorPolicies.filter(p => p.union === '교육노동자').length, 3);
});

test('older worker web posters are upgraded without affecting edits, removals or unrelated content', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../gg-campaign-site/content/site.json', import.meta.url), 'utf8'));
  const old = [
    ['IT노동자', '/images/it-worker-poster.webp', '/images/it-worker-telegram-v2.webp'],
    ['공무원노동자', '/images/civilservice-worker-poster.webp', '/images/civilservice-worker-telegram-v2.webp'],
    ['보건의료노동자', '/images/healthcare-worker-poster.webp', '/images/healthcare-worker-telegram-v2.webp'],
  ];
  const previous = structuredClone(seed.sectorPolicies);
  for(const [union,prior] of old) previous.find(p => p.union===union && p.order===1).poster=prior;
  const explicitlyRemoved = previous.find(p => p.union==='IT노동자' && p.order===2);
  explicitlyRemoved.poster='';
  const f=fixture(seed);
  f.stores.set(CONTENT_STORE,new Map([['published',{
    data: {news: [{id:'news',title:'기존 뉴스',date:'2026-11-03',content:'보존',images:[]}],
      shorts: [],videoUrl:'',videos:[],sectorPolicies:previous,constructionContentVersion:2,
      retiredSeedPolicyIds:[]},
    etag:'old-worker-poster-revision'
  }]]));
  const read=await f.request('GET',null,{auth:false});
  assert.equal(read.status,200);
  for(const [union,prior,updated] of old){
    const item=read.body.sectorPolicies.find(p=>p.union===union && p.order===1);
    assert.equal(item.poster,updated);
    assert.notEqual(item.poster,prior);
  }
  assert.equal(read.body.sectorPolicies.find(p=>p.id===explicitlyRemoved.id).poster,'');
  assert.equal(read.body.news[0].title,'기존 뉴스');
  assert.equal(read.body.sectorPolicies.filter(p=>p.union==='건설노동자').length,3);
  assert.equal(read.body.sectorPolicies.filter(p=>p.union==='교육노동자').length,3);
});
