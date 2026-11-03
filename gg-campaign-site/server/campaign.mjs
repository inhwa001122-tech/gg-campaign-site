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
    })), shorts: [], videos: [], sectorPolicies: [], videoUrl: youtubeId(seed.videoUrl) ? youtubeUrl(youtubeId(seed.videoUrl)) : ''
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
      const stored = existing ? existing.data : seedContent(seed);
      const revision = existing?.etag || 'initial';
      // Backwards-compatible schema extension: do not overwrite an existing production store.
      if (!stored || !Array.isArray(stored.news) || !Array.isArray(stored.shorts) || typeof stored.videoUrl !== 'string' ||
        (stored.videos !== undefined && !Array.isArray(stored.videos)) ||
        (stored.sectorPolicies !== undefined && !Array.isArray(stored.sectorPolicies))) throw Error('Stored content schema');
      // Make newly published campaign pledges available even when production already
      // has older photos/videos saved in Netlify Blobs. Never reset that existing data.
      // A removed default stays removed through an explicit deletion marker.
      if (stored.retiredSeedPolicyIds !== undefined && !Array.isArray(stored.retiredSeedPolicyIds)) throw Error('Stored content schema');
      const constructionContentVersion = 2;
      const upgradingConstruction = (stored.constructionContentVersion || 0) < constructionContentVersion;
      const oldConstructionIds = [1, 2, 3, 4].map(n => `seed-construction-20261103-${n}`);
      const retiredSeedPolicyIds = [...(stored.retiredSeedPolicyIds || [])].filter(id =>
        !upgradingConstruction || !oldConstructionIds.includes(id));
      const sectorPolicies = (stored.sectorPolicies || []).filter(item =>
        !upgradingConstruction || item.id !== oldConstructionIds[3]).map(item => ({ ...item }));
      const olderWorkerPosters = {
        '/images/it-worker-poster.webp': '/images/it-worker-original-v3.webp',
        '/images/it-worker-telegram-v2.webp': '/images/it-worker-original-v3.webp',
        '/images/civilservice-worker-poster.webp': '/images/civilservice-worker-original-v3.webp',
        '/images/civilservice-worker-telegram-v2.webp': '/images/civilservice-worker-original-v3.webp',
        '/images/healthcare-worker-poster.webp': '/images/healthcare-worker-original-v3.webp',
        '/images/healthcare-worker-telegram-v2.webp': '/images/healthcare-worker-original-v3.webp'
      };;
      for (const item of (Array.isArray(seed.sectorPolicies) ? seed.sectorPolicies : [])) {
        const saved = sectorPolicies.find(p => p.id === item.id);
        if (saved && olderWorkerPosters[saved.poster] === item.poster) {
          // Replace only this specific prior upload; do not override a poster
          // customized or explicitly removed by a site administrator.
          saved.poster = item.poster;
        }
        if (saved && upgradingConstruction && oldConstructionIds.includes(item.id)) {
          Object.assign(saved, item, {
            publishedAt: saved.publishedAt || item.publishedAt,
            poster: saved.poster === undefined ? (item.poster || '') : saved.poster
          });
        } else if (!saved && !retiredSeedPolicyIds.includes(item.id)) {
          sectorPolicies.push({ ...item });
        } else if (saved && item.poster && saved.poster === undefined) {
          // One-time web poster addition for older published seed records.
          // An explicit blank poster indicates that an editor removed it.
          saved.poster = item.poster;
        }
      }
      // Rename the existing production category without resetting saved pledges or other content.
      // Older Netlify Blobs entries can still contain the former federation label.
      for (const item of sectorPolicies) {
        if (item.union === '건설산업연맹') item.union = '건설노동자';
      }
      const data = { ...stored, videos: stored.videos || [], sectorPolicies, retiredSeedPolicyIds, constructionContentVersion };
      if (!writing) {
        // Unpublished campaign promises must remain private to authenticated managers.
        const visible = url.searchParams.get('admin') === '1' ? data : {
          ...data, sectorPolicies: data.sectorPolicies.filter(item => item.published === true)
        };
        return json({ ...visible, revision });
      }
      if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail('JSON 요청이 필요합니다.', 415);
      let input;
      try { input = JSON.parse(new TextDecoder().decode(await readBody(request, 32768))); }
      catch (error) { if (error instanceof InputError) throw error; fail('올바른 JSON 요청이 아닙니다.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('올바른 요청이 아닙니다.');
      if (input.revision !== revision) fail('다른 관리자가 변경했습니다. 새로고침한 뒤 다시 저장해 주세요.', 409);
      const kind = input.kind;
      if (!['news', 'shorts', 'video', 'videos', 'sectorPolicies'].includes(kind)) fail('지원하지 않는 항목입니다.');
      if (kind === 'video') {
        if (request.method !== 'PATCH') fail('지원하지 않는 요청입니다.', 405);
        const id = input.url === '' ? '' : youtubeId(input.url);
        if (input.url !== '' && !id) fail('유튜브 영상 주소를 확인해 주세요. 채널 주소는 사용할 수 없습니다.');
        data.videoUrl = id ? youtubeUrl(id) : '';
      } else {
        const list = data[kind], index = list.findIndex(n => n.id === input.id);
        if (request.method !== 'POST' && index === -1) fail('항목을 찾을 수 없습니다. 새로고침해 주세요.', 404);
        if (request.method === 'DELETE') {
          list.splice(index, 1);
          if (kind === 'sectorPolicies' && Array.isArray(seed.sectorPolicies) &&
            seed.sectorPolicies.some(p => p.id === input.id) && !data.retiredSeedPolicyIds.includes(input.id)) {
            data.retiredSeedPolicyIds.push(input.id);
          }
        }
        else {
          if (request.method === 'POST' && list.length >= (kind === 'news' ? 200 : kind === 'sectorPolicies' ? 400 : 100)) fail('등록 한도에 도달했습니다. 오래된 항목을 정리해 주세요.');
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
          } else if (kind === 'sectorPolicies') {
            const selectedUnion = text(input.union, 80);
            item.union = selectedUnion === '건설산업연맹' ? '건설노동자' : selectedUnion;
            item.field = input.field === '' || input.field === undefined ? '' : text(input.field, 80);
            item.content = text(input.content, 6000);
            const previous = index < 0 ? null : list[index];
            if (input.headline !== undefined) {
              const headline = text(input.headline, 120);
              if (!/^.{1,70}노동자와 함께 만들겠습니다\.$/u.test(headline)) {
                fail('대표 문구는 ‘건설노동자와 함께 만들겠습니다.’ 형식으로 입력해 주세요.');
              }
              item.headline = headline;
            } else if (previous?.headline) {
              item.headline = previous.headline;
            } else {
              // Keep older clients backward-compatible while giving every new
              // sector card the same worker-centered public heading format.
              const type = (item.field || item.union).replace(/노조$/u, '').trim();
              item.headline = `${type}노동자와 함께 만들겠습니다.`;
            }
            if (Number.isInteger(previous?.order)) item.order = previous.order;
            // Poster image is optional and managed with the existing authenticated
            // 1 MB WebP photo upload service. No third-party URLs are accepted.
            const poster = input.poster === undefined ? (previous?.poster || '') : input.poster;
            if (typeof poster !== 'string') fail('웹자보 이미지를 확인해 주세요.');
            if (poster !== '') {
              const isSame = previous?.poster === poster;
              const isSeedImage = Array.isArray(seed.sectorPolicies) && seed.sectorPolicies.some(p => p.id === item.id && p.poster === poster);
              const storedImage = /^\/\.netlify\/functions\/campaign\?image=([0-9a-f-]+)$/.exec(poster);
              if (storedImage && uuid.test(storedImage[1])) {
                if (!isSame && !await media().getMetadata(`photos/${storedImage[1]}`)) fail('업로드한 웹자보 이미지를 찾을 수 없습니다.');
              } else if (!(isSeedImage && localImage(poster))) {
                fail('웹자보 이미지 경로를 확인해 주세요.');
              }
            }
            item.poster = poster;
            if (typeof input.published !== 'boolean') fail('공개 여부를 확인해 주세요.');
            item.published = input.published;
            // Only a transition from draft to published starts the 72-hour NEW period.
            // Editing an already published item never renews its badge.
            const old = index < 0 ? null : list[index];
            item.publishedAt = item.published ?
              (old?.published && old.publishedAt ? old.publishedAt : new Date().toISOString()) :
              (old?.publishedAt || null);
          } else {
            const id = youtubeId(input.url);
            if (!id) fail('유튜브 개별 영상 주소를 확인해 주세요.');
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
