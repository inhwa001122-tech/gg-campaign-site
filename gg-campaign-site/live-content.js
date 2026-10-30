import { MAX_PHOTOS, MAX_IMAGE_BYTES, youtubeId, embedUrl } from './campaign-shared.js';

const $ = id => document.getElementById(id);
const endpoint = '/.netlify/functions/campaign';
let token = '', state = null, selection = [], busy = false;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function status(message, error = false) {
  $('contentAdminStatus').textContent = message;
  $('contentAdminStatus').classList.toggle('is-error', error);
}
function frame(id, title) {
  const node = document.createElement('iframe');
  node.src = embedUrl(id); node.title = title; node.loading = 'lazy';
  node.referrerPolicy = 'strict-origin-when-cross-origin';
  node.allow = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  node.allowFullscreen = true; return node;
}
function renderPublic() {
  window.updateCampaignNews(state.news);
  const grid = $('shortsGrid'); grid.replaceChildren();
  for (const item of state.shorts) {
    const id = youtubeId(item.url); if (!id) continue;
    const card = el('article', undefined, 'short-card'), holder = el('div', undefined, 'short-frame');
    holder.append(frame(id, item.title)); card.append(holder, el('h3', item.title));
    const link = el('a', '유튜브에서 보기 ↗'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    card.append(link); grid.append(card);
  }
  if (!grid.children.length) grid.append(el('p', '쇼츠 공개를 준비하고 있습니다.', 'empty-state'));
  const id = youtubeId(state.videoUrl), art = $('candidateVideo');
  art.classList.toggle('has-video', !!id);
  if (id) art.replaceChildren(frame(id, '기호 2번 후보 홍보영상'));
  else art.replaceChildren(el('span', '▶', 'play-ring'), el('span', 'WE MOVE TOGETHER'));
  $('videoPending').hidden = !!id;
  $('videoLink').style.display = id ? 'inline-flex' : 'none';
  if (id) { $('videoLink').href = '#candidateVideo'; $('videoLink').removeAttribute('target'); $('videoLink').textContent = '후보영상 보기 ↓'; }
}
async function api(method = 'GET', body, query = '') {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = body instanceof Blob ? body.type : 'application/json';
  const response = await fetch(endpoint + query, { method, headers, body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let result;
  try { result = await response.json(); } catch { throw Error('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) {
    if (response.status === 401) logout(false);
    throw Error(result.error || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return result;
}
function apply(data) { state = data; renderPublic(); if (token) renderLists(); }
async function reload(admin = false) { apply(await api('GET', undefined, admin ? '?admin=1' : '')); }
function revokeSelection() { for (const item of selection) if (item.blob) URL.revokeObjectURL(item.preview); }
function resetNews() {
  revokeSelection(); selection = []; $('newsEditor').reset(); $('newsId').value = '';
  $('newsDate').value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  renderPhotos();
}
function resetShort() { $('shortEditor').reset(); $('shortId').value = ''; }
function logout(announce = true) {
  token = ''; $('contentManager').hidden = true; $('contentLoginForm').hidden = false; $('contentPassword').value = '';
  resetNews(); resetShort(); if (announce) status('로그아웃했습니다.');
}
function renderPhotos() {
  const holder = $('photoSelection'); holder.replaceChildren();
  selection.forEach((item, i) => {
    const figure = el('figure'), image = el('img'); image.src = item.preview; image.alt = `선택한 사진 ${i + 1}`;
    const remove = el('button', `사진 ${i + 1} 제외`); remove.type = 'button'; remove.disabled = busy;
    remove.onclick = () => { if (item.blob) URL.revokeObjectURL(item.preview); selection.splice(i, 1); renderPhotos(); };
    figure.append(image, remove); holder.append(figure);
  });
}
function editNews(item) {
  resetNews(); $('newsId').value = item.id; $('newsTitle').value = item.title; $('newsDate').value = item.date; $('newsBody').value = item.content;
  selection = item.images.map(url => ({ url, preview: url })); renderPhotos(); $('newsTitle').focus();
}
function editShort(item) { $('shortId').value = item.id; $('shortTitle').value = item.title; $('shortUrl').value = item.url; $('shortTitle').focus(); }
function renderLists() {
  for (const [kind, target, edit] of [['news', 'newsManageList', editNews], ['shorts', 'shortManageList', editShort]]) {
    const list = $(target); list.replaceChildren();
    for (const item of state[kind]) {
      const row = el('li'); row.append(el('span', (item.date ? item.date + ' · ' : '') + item.title));
      const change = el('button', '수정'), remove = el('button', '삭제', 'danger');
      change.type = remove.type = 'button'; change.disabled = remove.disabled = busy;
      change.onclick = () => edit(item);
      remove.onclick = () => run(async () => {
        if (!confirm(`‘${item.title}’ 항목을 삭제할까요?`)) return;
        apply(await api('DELETE', { kind, id: item.id, revision: state.revision }));
        if (kind === 'news' && $('newsId').value === item.id) resetNews();
        if (kind === 'shorts' && $('shortId').value === item.id) resetShort();
        status('삭제했습니다. 홈페이지에 바로 반영되었습니다.');
      });
      row.append(change, remove); list.append(row);
    }
  }
}
async function run(action) {
  if (busy) return;
  busy = true;
  const controls = [...$('contentAdmin').querySelectorAll('button, input, textarea')];
  controls.forEach(n => { n.disabled = true; });
  try { await action(); }
  catch (error) { status(error.message, true); }
  finally { busy = false; controls.forEach(n => { n.disabled = false; }); renderPhotos(); if (token && state) renderLists(); }
}
async function compress(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error('JPG, PNG, WebP 사진만 선택해 주세요.');
  if (file.size > 20 * 1024 * 1024) throw Error('원본 사진은 한 장당 20MB 이하여야 합니다.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (bitmap.width * bitmap.height > 80_000_000) throw Error('사진 해상도가 너무 큽니다. 크기를 줄여 주세요.');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.5, 0.35]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
      if (!blob || blob.type !== 'image/webp') throw Error('사진 압축을 지원하는 최신 브라우저를 사용해 주세요.');
      if (blob.size <= MAX_IMAGE_BYTES) return { blob, preview: URL.createObjectURL(blob) };
    }
    throw Error('사진을 1MB 이하로 압축하지 못했습니다. 작은 사진을 선택해 주세요.');
  } finally { bitmap.close(); }
}
$('contentLoginForm').onsubmit = event => {
  event.preventDefault(); const candidate = $('contentPassword').value;
  run(async () => {
    token = candidate;
    try {
      await reload(true); $('contentPassword').value = ''; $('contentLoginForm').hidden = true; $('contentManager').hidden = false;
      $('candidateVideoUrl').value = state.videoUrl; resetNews(); resetShort(); status('관리자 로그인 완료. 사진과 영상을 관리할 수 있습니다.');
    } catch (error) { token = ''; throw error; }
  });
};
$('contentLogout').onclick = () => logout();
$('contentReload').onclick = () => run(async () => { await reload(true); status('최신 목록을 불러왔습니다. 입력 중인 내용은 유지했습니다.'); });
$('newsReset').onclick = resetNews; $('shortReset').onclick = resetShort;
$('newsPhotos').onchange = () => {
  const files = [...$('newsPhotos').files];
  run(async () => {
    if (files.length + selection.length > MAX_PHOTOS) throw Error(`사진은 ${MAX_PHOTOS}장까지 선택할 수 있습니다.`);
    status('사진을 압축하고 있습니다…');
    // Sequential compression keeps memory bounded on mobile devices.
    for (const file of files) { selection.push(await compress(file)); renderPhotos(); }
    status('사진 준비 완료. 공개 저장을 누르면 등록됩니다.');
  }).finally(() => { $('newsPhotos').value = ''; });
};
$('newsEditor').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    if (!state) throw Error('목록을 먼저 새로고침해 주세요.');
    const payload = { kind: 'news', id: $('newsId').value, title: $('newsTitle').value, date: $('newsDate').value, content: $('newsBody').value, revision: state.revision };
    status('소식과 사진을 저장하고 있습니다…');
    for (const item of selection) if (!item.url) item.url = (await api('POST', item.blob, '?upload=1')).url;
    payload.images = selection.map(item => item.url);
    apply(await api(payload.id ? 'PATCH' : 'POST', payload)); resetNews(); status('소식을 저장했습니다. 홈페이지에 바로 공개되었습니다.');
  });
};
$('shortEditor').onsubmit = event => {
  event.preventDefault(); run(async () => {
    if (!youtubeId($('shortUrl').value)) throw Error('유튜브 개별 영상 주소를 확인해 주세요.');
    const id = $('shortId').value;
    apply(await api(id ? 'PATCH' : 'POST', { kind: 'shorts', id, title: $('shortTitle').value, url: $('shortUrl').value, revision: state.revision }));
    resetShort(); status('쇼츠를 저장했습니다. 홈페이지에 바로 공개되었습니다.');
  });
};
$('videoEditor').onsubmit = event => {
  event.preventDefault(); run(async () => {
    const url = $('candidateVideoUrl').value.trim(); if (url && !youtubeId(url)) throw Error('유튜브 개별 영상 주소를 확인해 주세요.');
    apply(await api('PATCH', { kind: 'video', url, revision: state.revision })); status('후보영상 설정을 저장했습니다.');
  });
};
const site = await window.campaignSiteReady;
try { await reload(); }
catch {
  // Keep existing deployed content visible during a storage outage; never write a reset.
  state = { news: (site?.news || []).map((n, i) => ({ ...n, id: `fallback-${i}`, images: n.image ? [n.image] : [] })), shorts: [], videoUrl: site?.videoUrl || '' };
  renderPublic(); status('실시간 소식을 불러오지 못했습니다. 기존 소식을 표시합니다. 잠시 후 새로고침해 주세요.', true);
}
// Visitors see changes without redeployment; don't interrupt an administrator's edits.
setInterval(() => { if (!token && !document.hidden) reload().catch(() => {}); }, 60000);
document.addEventListener('visibilitychange', () => { if (!token && !document.hidden) reload().catch(() => {}); });
