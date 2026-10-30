/* Read only main's CMS content. Live activity/Shorts are served by our own Functions.
   No global fetch interception: the anonymous board always keeps its original API. */
(() => {
  const root = 'https://raw.githubusercontent.com/inhwa001122-tech/gg-campaign-site/main/gg-campaign-site/';
  let promise;
  window.loadCampaignSite = () => promise ||= (async () => {
    const deployed = await fetch('content/site.json', { cache: 'no-store' });
    if (!deployed.ok) throw Error('사이트 정보를 불러오지 못했습니다.');
    const fallback = await deployed.json();
    let data = fallback, remote = false;
    // Local development must be deterministic and must not import production changes.
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      try {
        const r = await fetch(root + 'content/site.json?refresh=' + Math.floor(Date.now() / 30000), {
          cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000)
        });
        if (!r.ok) throw Error('CMS unavailable');
        const latest = await r.json();
        if (!latest || !Array.isArray(latest.candidates) || !Array.isArray(latest.promises)) throw Error('CMS data invalid');
        data = { ...fallback, ...latest };
        remote = true;
      } catch { /* Use the verified deployed copy when GitHub is unavailable. */ }
    }
    if (remote) {
      const media = path => {
        if (typeof path !== 'string') return path;
        const normalized = path.replace(/^\/?(?:gg-campaign-site\/)?/, '');
        if (!normalized.startsWith('images/') || normalized.split('/').some(p => !p || p === '..' || /[?#]/.test(p))) return path;
        return root + normalized.split('/').map(encodeURIComponent).join('/');
      };
      data.heroImage = media(data.heroImage);
      data.candidates.forEach(c => { c.photo = media(c.photo); });
      (data.news || []).forEach(n => { n.image = media(n.image); });
    }
    return data;
  })();
})();
