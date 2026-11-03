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
  assert.match(index, /<b>산별·업종별 공약<\/b>/);
  assert.match(index, /<h3>산별·업종별 공약 관리<\/h3>/);
  assert.doesNotMatch(index, /산별·업종별 맞춤 공약/);
});
