/*
 * 기호 2번 선본 홈페이지 - GitHub 최신 소식 자동 반영
 * 기존 홈페이지 스크립트/익명 게시판 로직을 변경하지 않습니다.
 * 읽기 전용: 공개 GitHub 저장소의 site.json 및 사진 경로만 가져옵니다.
 * 1회 배포 후 Decap CMS가 main에 저장한 변경사항은 추가 배포 없이 표시됩니다.
 */
(() => {
  'use strict';

  const REPO = 'inhwa001122-tech/gg-campaign-site';
  const SITE_PATH = 'gg-campaign-site';
  const PREVIEW_BRANCH = 'sns-photo-preview';
  const branch = /^deploy-preview-\d+--thethe-up-2\.netlify\.app$/i.test(location.hostname)
    ? PREVIEW_BRANCH : 'main';
  const rawRoot = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(branch)}/${SITE_PATH}/`;
  const originalFetch = window.fetch.bind(window);
  let requestPromise = null;

  const mediaUrl = value => {
    if (typeof value !== 'string' || !value.trim()) return value;
    const input = value.trim();
    if (/^https?:\/\//i.test(input) || /^(?:data:|blob:)/i.test(input)) return input;

    // Decap CMS public_folder: /images, media_folder: gg-campaign-site/images
    let path = input.replace(/^\.?\/+/, '').replace(/^gg-campaign-site\//, '');
    if (!path.startsWith('images/')) return input;
    const parts = path.split('/');
    if (parts.some(x => !x || x === '.' || x === '..' || /[?#]/.test(x))) return input;
    return rawRoot + parts.map(encodeURIComponent).join('/');
  };

  const prepare = data => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('최신 홈페이지 데이터 형식이 올바르지 않습니다.');
    }
    // 후보, 공약, SNS 내용은 JSON 그대로 유지하고 사진 주소만 최신 GitHub 원본으로 바꿉니다.
    if (data.heroImage) data.heroImage = mediaUrl(data.heroImage);
    if (Array.isArray(data.candidates)) {
      data.candidates.forEach(c => { if (c && c.photo) c.photo = mediaUrl(c.photo); });
    }
    if (Array.isArray(data.news)) {
      data.news.forEach(n => { if (n && n.image) n.image = mediaUrl(n.image); });
    }
    return data;
  };

  const isSiteJsonRequest = input => {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
    try {
      const parsed = new URL(url, location.href);
      const current = new URL('content/site.json', location.href);
      return parsed.origin === current.origin && parsed.pathname === current.pathname;
    } catch (_) { return false; }
  };

  async function readLiveData() {
    if (!requestPromise) {
      // 날짜별/매일 게시가 실제로 반영되도록 브라우저/중간 캐시를 우회합니다.
      // 같은 페이지에 여러 스크립트가 있어도 한 번만 GitHub에 요청합니다.
      const bucket = Math.floor(Date.now() / 30000);
      const remote = rawRoot + 'content/site.json?refresh=' + bucket;
      requestPromise = originalFetch(remote, {
        method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store'
      }).then(async response => {
        if (!response.ok) throw new Error('GitHub 최신 데이터 응답: ' + response.status);
        return prepare(await response.json());
      });
    }
    return requestPromise;
  }

  // 기존 script.js와 campaign-updates.js가 사용하는 site.json 읽기만 최신 데이터로 바꿉니다.
  // GitHub가 일시적으로 응답하지 않으면 기존 배포된 데이터로 자동 복귀합니다.
  window.fetch = function (input, options) {
    if (!isSiteJsonRequest(input)) return originalFetch(input, options);
    return readLiveData()
      .then(data => new Response(JSON.stringify(data), {
        status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }))
      .catch(error => {
        console.warn('최신 소식 불러오기 실패. 기존 배포 내용을 사용합니다.', error);
        return originalFetch(input, options);
      });
  };
})();
