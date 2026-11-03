import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../gg-campaign-site/construction-poster.html', import.meta.url), 'utf8');

test('construction poster retains social link-preview metadata', () => {
  assert.match(html, /property="og:image" content="https:\/\/thethe-up-2\.netlify\.app\/images\/construction-poster\.webp"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:url"/);
});
test('clicking poster preview redirects ordinary visitors to homepage pledges', () => {
  assert.match(html, /window\.location\.replace\('\/#pledges'\)/);
  assert.equal((html.match(/href="https:\/\/thethe-up-2\.netlify\.app\/#pledges"/g) || []).length, 2);
  assert.match(html, /has\('preview'\)/);
});
