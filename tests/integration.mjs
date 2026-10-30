// Always run against an unlinked temporary Netlify Dev instance, never a live site.
import { mkdtemp, cp, symlink, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from '../gg-campaign-site/node_modules/@playwright/test/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'gg-campaign-integration-'));
const secret = randomBytes(32).toString('hex');
const port = 8899, base = `http://127.0.0.1:${port}`;
let server, browser, log = '', checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };
const pause = ms => new Promise(r => setTimeout(r, ms));
async function start() {
  const env = { ...process.env, BOARD_ADMIN_SECRET: secret, NETLIFY_TELEMETRY_DISABLED: '1', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' };
  delete env.NETLIFY_SITE_ID; delete env.NETLIFY_AUTH_TOKEN; delete env.NETLIFY_BLOBS_CONTEXT;
  const args = ['dev', '--offline', '--no-open', '--skip-gitignore', '--internal-disable-edge-functions', '--framework', '#static', '--dir', 'gg-campaign-site', '--functions', 'gg-campaign-site/netlify/functions', '--port', String(port)];
  server = process.env.NETLIFY_CLI_JS ? spawn(process.execPath, [process.env.NETLIFY_CLI_JS, ...args], { cwd: temp, env, detached: true }) : spawn('netlify', args, { cwd: temp, env, detached: true });
  server.stdout.on('data', b => { log = (log + b.toString()).slice(-16000); });
  server.stderr.on('data', b => { log = (log + b.toString()).slice(-16000); });
  server.on('error', e => { log += e.message; });
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error('Netlify Dev exited');
    try { const r = await fetch(base + '/.netlify/functions/campaign'); if (r.ok) return; } catch {}
    await pause(250);
  }
  throw Error('Netlify Dev readiness timed out');
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const ended = once(server, 'exit'); process.kill(-server.pid, 'SIGTERM');
  await Promise.race([ended, pause(3000)]);
  if (server.exitCode === null) { process.kill(-server.pid, 'SIGKILL'); await ended; }
}
async function api(path, method = 'GET', payload, auth = false, expected = 200, extraHeaders = {}) {
  const r = await fetch(base + '/.netlify/functions/' + path, { method, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + secret } : {}), ...extraHeaders }, body: payload ? JSON.stringify(payload) : undefined });
  assert.equal(r.status, expected, `${method} ${path}: ${await r.clone().text()}`); return r.json();
}
try {
  await cp(join(repo, 'netlify.toml'), join(temp, 'netlify.toml'));
  await cp(join(repo, 'gg-campaign-site'), join(temp, 'gg-campaign-site'), { recursive: true, filter: path => !path.split('/').some(p => p === 'node_modules' || p.startsWith('.env')) });
  await symlink(join(repo, 'gg-campaign-site/node_modules'), join(temp, 'gg-campaign-site/node_modules'), 'dir');
  await start(); pass('Netlify Dev bundles both functions and returns public content');
  for (const method of ['POST', 'PATCH', 'DELETE']) await api('campaign', method, { kind: 'news', admin: true }, false, 401);
  await api('campaign?admin=1', 'GET', undefined, false, 401);
  await api('campaign?upload=1', 'POST', { admin: true }, false, 401);
  await api('campaign', 'POST', {}, true, 403, { Origin: 'https://evil.test' });
  pass('real HTTP rejects auth bypass, unauthenticated uploads and cross-origin writes');

  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  // External video streaming and social authentication are deliberately outside this local test.
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base); await page.waitForSelector('#snsList a');
  assert.equal(await page.locator('#candidateGrid .candidate-card').count(), 3);
  assert.equal(await page.locator('#pledgeGrid .pledge-card').count(), 10);
  const site = JSON.parse(await readFile(join(repo, 'gg-campaign-site/content/site.json'), 'utf8'));
  const channels = ['instagramUrl', 'facebookUrl', 'telegramUrl', 'youtubeUrl'];
  const hrefs = await page.locator('#snsList a').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
  for (const key of channels) assert.ok(hrefs.includes(new URL(site[key]).href), key);
  await page.locator('#candidateGrid img, #heroPhoto img, .policy-pages img').evaluateAll(images => images.forEach(img => { img.loading = 'eager'; }));
  await page.waitForFunction(() => [...document.querySelectorAll('#candidateGrid img, #heroPhoto img, .policy-pages img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('#shortsGrid iframe').count(), 0); assert.equal(await page.locator('#candidateVideo iframe').count(), 0);
  assert.equal(await page.locator('#videoPending').isVisible(), true);
  await page.locator('#copyAccount').click(); await page.waitForFunction(() => document.getElementById('copyAccountStatus').textContent.includes('복사했습니다'));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '235073-56-037994');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('permission denied'); }; });
  await page.locator('#copyAccount').click(); await page.waitForFunction(() => document.getElementById('copyAccountStatus').textContent.includes('복사하지 못했습니다'));
  pass('three candidates, ten pledges, four original SNS URLs, empty videos and real clipboard copy');

  await page.locator('#contentAdmin summary').click(); await page.locator('#contentPassword').fill('incorrect-local-password');
  await page.locator('#contentLoginForm button').click(); await page.waitForFunction(() => document.getElementById('contentAdminStatus').textContent.includes('인증'));
  assert.equal(await page.locator('#contentManager').isVisible(), false);
  await page.locator('#contentPassword').fill(secret); await page.locator('#contentLoginForm button').click(); await page.waitForSelector('#contentManager', { state: 'visible' });
  pass('homepage administrator login is verified by the server');
  const photo = await readFile(join(repo, 'gg-campaign-site/images/policy-1.webp'));
  await page.locator('#newsTitle').fill('검증 소식 (로컬)'); await page.locator('#newsDate').fill('2026-10-30'); await page.locator('#newsBody').fill('활동사진 여러 장과 본문을 확인합니다.\n두 번째 줄입니다.');
  await page.locator('#newsPhotos').setInputFiles([{ name: 'one.webp', mimeType: 'image/webp', buffer: photo }, { name: 'two.webp', mimeType: 'image/webp', buffer: photo }]);
  await page.waitForFunction(() => document.getElementById('contentAdminStatus').textContent.includes('사진 준비 완료'));
  assert.equal(await page.locator('#photoSelection img').count(), 2);
  await page.locator('#newsSave').click(); await page.waitForSelector('#newsGrid .news-card');
  let data = await api('campaign'); assert.equal(data.news.length, 1); assert.equal(data.news[0].images.length, 2);
  for (const url of data.news[0].images) {
    const r = await fetch(base + url), b = new Uint8Array(await r.arrayBuffer());
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/webp'); assert.ok(b.length <= 1024 * 1024);
  }
  await page.locator('#newsGrid .news-card').click(); assert.equal(await page.locator('#newsDetail img').count(), 2); await page.locator('#newsDialog .dialog-close').click();
  pass('two browser-compressed photos upload to real local Blobs and display in the news detail');
  await page.locator('#newsManageList button').filter({ hasText: '수정' }).click(); await page.locator('#newsTitle').fill('수정 소식 (로컬)');
  await page.locator('#photoSelection button').first().click(); await page.locator('#newsSave').click();
  await page.waitForFunction(() => document.querySelector('#newsGrid h3')?.textContent === '수정 소식 (로컬)');
  data = await api('campaign'); assert.equal(data.news[0].images.length, 1);
  pass('news editing and photo removal persist without a build');
  await page.locator('#shortTitle').fill('로컬 쇼츠 검증'); await page.locator('#shortUrl').fill('https://www.youtube.com/shorts/abcdefghijk'); await page.locator('#shortEditor button[type=submit]').click();
  await page.waitForSelector('#shortsGrid iframe'); assert.match(await page.locator('#shortsGrid iframe').getAttribute('src'), /youtube-nocookie.com\/embed\/abcdefghijk$/);
  await page.locator('#shortManageList button').filter({ hasText: '수정' }).click(); await page.locator('#shortTitle').fill('수정 쇼츠'); await page.locator('#shortUrl').fill('https://youtu.be/12345678901'); await page.locator('#shortEditor button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#shortsGrid iframe')?.src.endsWith('/12345678901'));
  await page.locator('#candidateVideoUrl').fill('https://youtu.be/abcdefghijk'); await page.locator('#videoEditor button').click(); await page.waitForSelector('#candidateVideo iframe');
  pass('Shorts create/edit and candidate video embedded playback URLs update immediately');
  await mkdir(join(repo, 'test-results'), { recursive: true });
  await page.screenshot({ path: join(repo, 'test-results/desktop.png'), fullPage: true });
  await page.locator('#news').screenshot({ path: join(repo, 'test-results/news-desktop.png') });

  // Existing board function exercised unchanged, with isolated local storage and no production data.
  const boardPost = await api('board', 'POST', { topic: '응원 · 기타', subject: '로컬 회귀검증', message: '테스트 환경에서만 확인하는 익명 게시글입니다.', agree: true }, false, 201, { 'x-nf-client-connection-ip': 'local-regression-test' });
  await api('board', 'PATCH', { id: boardPost.id, action: 'reply', reply: '로컬 관리자 답변입니다.' }, true);
  assert.equal((await api('board')).posts.find(p => p.id === boardPost.id).reply, '로컬 관리자 답변입니다.');
  await api('board', 'PATCH', { id: boardPost.id, action: 'hide' }, true); assert.equal((await api('board')).posts.length, 0);
  await api('board', 'PATCH', { id: boardPost.id, action: 'show' }, true);
  pass('unchanged anonymous board: create, admin reply, hide and show');

  await context.close(); await stop(); await start();
  assert.equal((await api('campaign')).news[0].title, '수정 소식 (로컬)'); assert.equal((await api('campaign')).shorts[0].title, '수정 쇼츠'); assert.ok((await api('board')).posts.some(p => p.id === boardPost.id));
  pass('news, Shorts and existing board data survive service restart');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const m = await mobile.newPage(); m.on('pageerror', e => errors.push(e.message)); await m.goto(base); await m.waitForSelector('#shortsGrid iframe');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await m.locator('#contentAdmin summary').click(); await m.locator('#contentPassword').fill(secret); await m.locator('#contentLoginForm button').click(); await m.waitForSelector('#contentManager', { state: 'visible' });
  await m.locator('#newsManageList button').filter({ hasText: '수정' }).click(); await m.locator('#newsBody').fill('모바일에서 수정한 본문입니다.'); await m.locator('#newsSave').click();
  await m.waitForFunction(() => document.getElementById('contentAdminStatus').textContent.includes('소식을 저장했습니다'));
  assert.equal((await api('campaign')).news[0].content, '모바일에서 수정한 본문입니다.');
  await m.screenshot({ path: join(repo, 'test-results/mobile.png'), fullPage: true });
  await m.locator('.support-banner').screenshot({ path: join(repo, 'test-results/support-mobile.png') });
  await m.locator('#shorts').screenshot({ path: join(repo, 'test-results/shorts-mobile.png') });
  await m.setViewportSize({ width: 320, height: 740 });
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  m.on('dialog', dialog => dialog.accept());
  await m.locator('#shortManageList .danger').click(); await m.waitForFunction(() => !document.querySelector('#shortsGrid iframe'));
  await m.locator('#newsManageList .danger').click(); await m.waitForFunction(() => !document.querySelector('#newsGrid .news-card'));
  await m.locator('#candidateVideoUrl').fill(''); await m.locator('#videoEditor button').click(); await m.waitForFunction(() => !document.querySelector('#candidateVideo iframe'));
  await m.locator('#contentLogout').click(); assert.equal(await m.locator('#contentManager').isVisible(), false);
  await api('board', 'DELETE', { id: boardPost.id }, true); assert.equal((await api('board')).posts.length, 0);
  const empty = await api('campaign'); assert.equal(empty.news.length, 0); assert.equal(empty.shorts.length, 0); assert.equal(empty.videoUrl, '');
  assert.deepEqual(errors, []);
  pass('mobile edit/delete, clean empty states, logout, board deletion and zero browser script errors');
  console.log(`Completed ${checks} integration groups. External YouTube playback/SNS destination login and production storage were not tested.`);
} catch (error) {
  console.error(log.split(secret).join('[redacted]')); console.error(error.message?.split(secret).join('[redacted]')); process.exitCode = 1;
} finally {
  await browser?.close(); await stop(); await rm(temp, { recursive: true, force: true });
}
