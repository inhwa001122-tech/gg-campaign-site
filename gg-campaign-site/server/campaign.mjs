import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { MAX_PHOTOS, MAX_IMAGE_BYTES, youtubeId, youtubeUrl } from '../campaign-shared.js';

// These site-scoped stores are deliberately separate from both existing board stores.
export const CONTENT_STORE = 'gg-campaign-content-v1';
export const MEDIA_STORE = 'gg-campaign-media-v1';
export function campaignStoreName(name, deployment = {}, env = process.env) {
  const context = deployment.context || env.CONTEXT;
  if (!['deploy-preview', 'branch-deploy'].includes(context)) return name;
  const scope = env.REVIEW_ID || env.BRANCH || deployment.id || env.DEPLOY_ID || 'isolated';
  return name + '-preview-' + createHash('sha256').update(scope).digest('hex').slice(0, 12);
}
const KEY = 'published';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new InputError(message, status); };
function text(value, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`입력 길이를 확인해 주세요. (${min}~${max}자)`);
  return value.trim();
}
function isAuthorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 12) return false;
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (supplied.length < 12 || supplied.length > 500) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(secret), hash(supplied));
}
function localImage(value) {
  return typeof value === 'string' && /^\/?images\/[^?#]+$/u.test(value) && !value.split('/').includes('..');
}
function seedContent(seed) {
  return {
    news: (seed.news || []).map(n => ({
      id: `legacy-${createHash('sha256').update(JSON.stringify(n)).digest('hex').slice(0, 24)}`,
      title: n.title, date: n.date, content: n.content || '',
      images: n.image && localImage(n.image) ? [n.image] : []
    })), shorts: [], videoUrl: youtubeId(seed.videoUrl) ? youtubeUrl(youtubeId(seed.videoUrl)) : ''
  };
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('날짜를 확인해 주세요.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('날짜를 확인해 주세요.');
  return value;
}
async function readBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) fail('업로드 용량을 초과했습니다.', 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); fail('업로드 용량을 초과했습니다.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function createCampaignHandler({ getStore, seed = {}, secret = () => process.env.BOARD_ADMIN_SECRET || '' }) {
  return async request => {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return json({ error: '지원하지 않는 요청입니다.' }, 405);
      const writing = request.method !== 'GET';
      if ((writing || url.searchParams.get('admin') === '1') && !isAuthorized(request, secret())) {
        return json({ error: '관리자 인증이 필요합니다. 비밀번호를 확인해 주세요.' }, 401);
      }
      const media = () => getStore({ name: MEDIA_STORE, consistency: 'strong' });
      const image = url.searchParams.get('image');
      if (image !== null) {
        if (request.method !== 'GET' || !uuid.test(image)) fail('사진을 찾을 수 없습니다.', 404);
        const stored = await media().getWithMetadata(`photos/${image}`, { type: 'arrayBuffer' });
        if (!stored) fail('사진을 찾을 수 없습니다.', 404);
        return new Response(stored.data, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
      }
      if (url.searchParams.get('upload') === '1') {
        if (request.method !== 'POST') fail('지원하지 않는 요청입니다.', 405);
        if (request.headers.get('content-type') !== 'image/webp') fail('압축한 WebP 사진만 업로드할 수 있습니다.', 415);
        const bytes = await readBody(request, MAX_IMAGE_BYTES);
        const marker = (start, end) => String.fromCharCode(...bytes.slice(start, end));
        if (bytes.length < 20 || marker(0, 4) !== 'RIFF' || marker(8, 12) !== 'WEBP' ||
          !['VP8 ', 'VP8L', 'VP8X'].includes(marker(12, 16)) || new DataView(bytes.buffer).getUint32(4, true) !== bytes.length - 8) fail('올바른 WebP 사진이 아닙니다.', 415);
        const id = randomUUID();
        const result = await media().set(`photos/${id}`, bytes.buffer, { onlyIfNew: true });
        if (!result.modified) fail('사진 저장에 실패했습니다. 다시 시도해 주세요.', 503);
        return json({ id, url: `/.netlify/functions/campaign?image=${id}` }, 201);
      }
      const store = getStore({ name: CONTENT_STORE, consistency: 'strong' });
      let existing = await store.getWithMetadata(KEY, { type: 'json' });
      if (existing && !existing.etag) {
        // Netlify's local Blobs emulator omits GET ETags even in SDK 11.1.7.
        // Its listing supplies them. Bracket a strong read with two listings;
        // never guess a revision or fall back to an unconditional write.
        const etag = async () => (await store.list({ prefix: KEY })).blobs.find(b => b.key === KEY)?.etag;
        const before = await etag();
        existing = await store.getWithMetadata(KEY, { type: 'json' });
        const after = await etag();
        if (!existing || !before || before !== after) fail('목록이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.', 409);
        existing.etag = after;
      }
      const data = existing ? existing.data : seedContent(seed);
      const revision = existing?.etag || 'initial';
      // A corrupt/unknown schema must never silently reset published data.
      if (!data || !Array.isArray(data.news) || !Array.isArray(data.shorts) || typeof data.videoUrl !== 'string') throw Error('Stored content schema');
      if (!writing) return json({ ...data, revision });
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('JSON 요청이 필요합니다.', 415);
      let input;
      try { input = JSON.parse(new TextDecoder().decode(await readBody(request, 32768))); }
      catch (error) { if (error instanceof InputError) throw error; fail('올바른 JSON 요청이 아닙니다.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('올바른 요청이 아닙니다.');
      if (input.revision !== revision) fail('다른 관리자가 변경했습니다. 새로고침한 뒤 다시 저장해 주세요.', 409);
      const kind = input.kind;
      if (!['news', 'shorts', 'video'].includes(kind)) fail('지원하지 않는 항목입니다.');
      if (kind === 'video') {
        if (request.method !== 'PATCH') fail('지원하지 않는 요청입니다.', 405);
        const id = input.url === '' ? '' : youtubeId(input.url);
        if (input.url !== '' && !id) fail('유튜브 영상 주소를 확인해 주세요. 채널 주소는 사용할 수 없습니다.');
        data.videoUrl = id ? youtubeUrl(id) : '';
      } else {
        const list = data[kind], index = list.findIndex(n => n.id === input.id);
        if (request.method !== 'POST' && index === -1) fail('항목을 찾을 수 없습니다. 새로고침해 주세요.', 404);
        if (request.method === 'DELETE') list.splice(index, 1);
        else {
          if (request.method === 'POST' && list.length >= (kind === 'news' ? 200 : 100)) fail('등록 한도에 도달했습니다. 오래된 항목을 정리해 주세요.');
          const item = { id: request.method === 'POST' ? randomUUID() : list[index].id, title: text(input.title, 120) };
          if (kind === 'news') {
            item.date = validDate(input.date); item.content = text(input.content, 6000);
            if (!Array.isArray(input.images) || input.images.length > MAX_PHOTOS) fail(`사진은 ${MAX_PHOTOS}장까지 등록할 수 있습니다.`);
            const oldImages = index === -1 ? [] : list[index].images;
            for (const value of input.images) {
              if (oldImages.includes(value) && localImage(value)) continue;
              const match = typeof value === 'string' && /^\/\.netlify\/functions\/campaign\?image=([0-9a-f-]+)$/.exec(value);
              if (!match || !uuid.test(match[1]) || !await media().getMetadata(`photos/${match[1]}`)) fail('업로드한 사진을 찾을 수 없습니다. 다시 업로드해 주세요.');
            }
            item.images = [...new Set(input.images)];
          } else {
            const id = youtubeId(input.url); if (!id) fail('유튜브 쇼츠 영상 주소를 확인해 주세요.');
            item.url = youtubeUrl(id);
          }
          if (request.method === 'POST') list.push(item); else list[index] = item;
        }
      }
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 4 * 1024 * 1024) fail('소식 저장 용량 한도에 도달했습니다. 오래된 소식을 정리해 주세요.');
      const result = await store.setJSON(KEY, data, existing ? { onlyIfMatch: revision } : { onlyIfNew: true });
      if (!result.modified) fail('다른 관리자가 변경했습니다. 새로고침한 뒤 다시 저장해 주세요.', 409);
      return json({ ...data, revision: result.etag }, request.method === 'POST' ? 201 : 200);
    } catch (error) {
      // Never log request bodies, auth headers, secrets or provider error strings.
      if (error instanceof InputError) return json({ error: error.message }, error.status);
      console.error('Campaign storage operation failed');
      return json({ error: '저장소에 연결하지 못했습니다. 입력 내용을 보관한 뒤 다시 시도해 주세요.' }, 503);
    }
  };
}
