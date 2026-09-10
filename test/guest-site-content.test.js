const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('guide-extay.html', 'utf8');

test('guest guide loads only published content and reapplies it after language changes', () => {
  assert.match(html, /fetch\('\/api\/site-content'/);
  assert.match(html, /cache:'no-store'/);
  assert.match(html, /applyPublishedSiteContent\(data\?\.published\|\|data\)/);
  assert.match(html, /applyStaticLanguage\(\);applyPublishedSiteContent\(publishedSiteContent\)/);
});

test('published content updates guest essentials, maps, media, guides and FAQ safely', () => {
  for (const marker of [
    '#heroTitle', '#gettingAddress', '#gettingTransit', 'stayEssentials',
    'wifiSsid', 'wifiPassword', 'guides.parking', 'guides.laundry',
    'guides.trash', 'guides.facilities', 'property.naverMapUrl',
    'property.googleMapUrl', 'images.hero', 'images.gallery', 'renderManagedFaq'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /summary\.textContent=managedValue\(item\.question\)/);
  assert.match(html, /copy\.textContent=managedValue\(item\.answer\)/);
  assert.match(html, /parsed\.protocol==='https:'/);
  assert.match(html, /noopener noreferrer/);
});

test('draft preview stays local to the admin browser and usage-limit responses do not fall through to a local answer', () => {
  assert.match(html, /draft-preview/);
  assert.match(html, /localStorage\.getItem\('extay-admin-preview'\)/);
  assert.match(html, /600000/);
  assert.match(html, /res\.status===429/);
  assert.match(html, /AI 상담 사용 한도/);
});
