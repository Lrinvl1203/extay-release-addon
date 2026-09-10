const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('admin.html', 'utf8');

test('admin exposes every managed accommodation section and field', () => {
  for (const section of ['basic', 'guide', 'contact', 'faq', 'usage', 'review']) {
    assert.match(html, new RegExp(`data-tab="${section}"`));
    assert.match(html, new RegExp(`data-panel="${section}"`));
  }
  for (const field of [
    'property.name', 'property.address', 'property.transit', 'property.description',
    'property.phone', 'property.kakaoUrl', 'property.naverMapUrl', 'property.googleMapUrl',
    'stay.checkIn', 'stay.checkOut', 'stay.entry', 'stay.parking', 'stay.luggage',
    'guides.wifiSsid', 'guides.wifiPassword', 'guides.wifiNotes', 'guides.parking',
    'guides.laundry', 'guides.trash', 'guides.facilities', 'images.hero', 'images.gallery',
    'limits.daily', 'limits.monthly'
  ]) assert.match(html, new RegExp(`data-field="${field.replace('.', '\\.')}"`));
});

test('admin supports safe FAQ editing, validation, draft preview and explicit publish', () => {
  assert.match(html, /function createFaqRow/);
  assert.match(html, /questionInput\.dataset\.faq='question'/);
  assert.match(html, /answerInput\.dataset\.faq='answer'/);
  assert.match(html, /editor\.children\.length>=10/);
  assert.match(html, /function validateContent/);
  assert.match(html, /validateContent\(next\)/);
  assert.match(html, /extay-admin-preview/);
  assert.match(html, /draft-preview=1/);
  assert.match(html, /action:'publish'/);
  assert.match(html, /expectedRevision:draftRevision/);
  assert.match(html, /window\.confirm/);
  assert.doesNotMatch(html, /innerHTML\s*=/);
});

test('admin keeps credentials out of persisted browser state and is mobile responsive', () => {
  assert.match(html, /let password=''/);
  assert.match(html, /'X-Admin-Password':password/);
  assert.doesNotMatch(html, /localStorage\.setItem\([^,]*password/i);
  assert.doesNotMatch(html, />1203</);
  assert.match(html, /@media\(max-width:560px\)/);
  assert.match(html, /usage\.dayCalls/);
  assert.match(html, /usage\.monthCalls/);
  assert.match(html, /usage\.totalCalls/);
});
