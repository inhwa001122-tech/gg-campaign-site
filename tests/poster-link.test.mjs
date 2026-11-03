import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../gg-campaign-site/construction-poster.html', import.meta.url), 'utf8');

test('construction poster retains social link-preview metadata', () => {
  assert.match(html, /property="og:image" content="https:\/\/thethe-up-2\.netlify\.app\/images\/construction-poster\.webp"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:url"/);
});
test('clicking poster preview redirects ordinary visitors to construction sector pledges', () => {
  assert.match(html, /window\.location\.replace\('\/#construction-policy'\)/);
  assert.equal((html.match(/href="https:\/\/thethe-up-2\.netlify\.app\/#construction-policy"/g) || []).length, 2);
  assert.match(html, /has\('preview'\)/);
});

test('sector poster appears once as a card thumbnail while policies occupy full width', () => {
  const js = readFileSync(new URL('../gg-campaign-site/live-content.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../gg-campaign-site/live-content.css', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../gg-campaign-site/index.html', import.meta.url), 'utf8');
  assert.match(js, /sector-poster-thumb/);
  assert.match(js, /details\.append\(share\)/);
  assert.doesNotMatch(js, /sector-poster-expand|sector-poster-sidebar|웹자보 확대 보기/);
  assert.match(css, /\.sector-card\.has-poster \.sector-card-body\{display:block;width:100%\}/);
  assert.doesNotMatch(css, /sector-poster-sidebar|sector-poster-expand/);
  assert.match(index, /<b>산업별·업종별 공약<\/b>/);
  assert.match(index, /<h3>산업별·업종별 공약 관리<\/h3>/);
  assert.doesNotMatch(index, /산별·업종별 맞춤 공약/);
});

test('public industry section and pledge cards use worker-centered headings only', () => {
  const index = readFileSync(new URL('../gg-campaign-site/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../gg-campaign-site/live-content.js', import.meta.url), 'utf8');
  assert.match(index, /현장과 함께 만드는 기대 그 이상<br><b>산업별·업종별 공약<\/b>/);
  assert.match(index, /<label for="sectorHeadline">카드 대표 문구 \(필수\)<\/label>/);
  assert.match(index, /id="sectorHeadline" required/);
  assert.doesNotMatch(index, /산업산별·업종별 공약/);
  assert.match(js, /info\.append\(el\('span', headline \|\| '현장 노동자와 함께 만들겠습니다\.', 'sector-card-name'\)\)/);
  assert.doesNotMatch(js, /info\.append\(el\('span', union, 'sector-card-name'\)\)/);
  assert.match(js, /headline: \$\('sectorHeadline'\)\.value/);
  assert.match(js, /\$\('sectorHeadline'\)\.value = item\.headline \|\| ''/);
});

test('portrait and landscape uploads display fully without forcing a landscape crop', () => {
  const styles = readFileSync(new URL('../gg-campaign-site/styles.css', import.meta.url), 'utf8');
  const content = readFileSync(new URL('../gg-campaign-site/live-content.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../gg-campaign-site/live-content.js', import.meta.url), 'utf8');
  assert.match(styles, /\.news-thumb\{min-height:210px;height:auto;/);
  assert.match(styles, /\.news-thumb img\{display:block;width:100%;height:auto;max-height:560px;object-fit:contain\}/);
  assert.match(styles, /\.dialog-panel img\{display:block;width:auto;max-width:100%;height:auto;max-height:none;object-fit:contain;/);
  assert.match(styles, /\.candidate-img img\{height:100%;width:100%;object-fit:contain\}/);
  assert.match(styles, /\.hero-photo img\{width:100%;height:100%;object-fit:contain\}/);
  assert.match(content, /\.photo-selection img\{display:block;width:auto;max-width:100%;height:auto;max-height:250px;object-fit:contain;/);
  assert.match(content, /\.sector-poster-thumb\{width:96px;height:132px;flex:none;object-fit:contain;/);
  assert.match(script, /imageOrientation: 'from-image'/);
});
