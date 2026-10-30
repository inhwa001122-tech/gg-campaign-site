// Shared validation: never turn arbitrary URLs into iframe sources.
export const MAX_PHOTOS = 8;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export function youtubeId(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
    let id = '';
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname)) {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else id = /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(u.pathname)?.[1] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
  } catch { return ''; }
}
export const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`;
export const embedUrl = id => `https://www.youtube-nocookie.com/embed/${id}`;
