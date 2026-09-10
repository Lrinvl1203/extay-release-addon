const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const guide = fs.readFileSync(path.join(root, 'guide-extay.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('guest chat fails closed and gates every entry point', () => {
  assert.match(guide, /<html lang="ko" class="chat-disabled">/);
  assert.match(guide, /let chatEnabled=false/);
  assert.match(guide, /fetch\('\/api\/chat-status'/);
  assert.match(guide, /setChatAvailability\(false\)/);
  assert.match(guide, /function openChat\(\)\{if\(!chatEnabled\)return/);
  assert.match(guide, /res\.status===503\)\{setChatAvailability\(false\);return/);
  assert.match(guide, /chatEnabled\|\|item\.icon!==['"]smart_toy/);
  assert.match(guide, /html\.chat-disabled #conciergeWidget/);
});

test('admin page keeps password in memory and uses scoped control API', () => {
  assert.match(admin, /let password=''/);
  assert.match(admin, /X-Admin-Password/);
  assert.match(admin, /\/api\/admin\/chat-control/);
  assert.match(admin, /JSON\.stringify\(\{enabled,reason:/);
  assert.match(admin, /password=''/);
  assert.doesNotMatch(admin, /OPENAI_API_KEY|api[_-]?key/i);
  assert.match(admin, /href="guide-extay\.html"/);
});
