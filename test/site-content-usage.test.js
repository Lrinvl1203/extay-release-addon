const assert = require('node:assert/strict');
const test = require('node:test');

const privateBlob = require('../lib/private-blob');
const settings = require('../lib/accommodation-settings');
const usage = require('../lib/chat-usage');
const control = require('../lib/chat-control');
const settingsHandler = require('../api/accommodation-settings');
const adminSettingsHandler = require('../api/admin/accommodation-settings');
const publishHandler = require('../api/admin/accommodation-settings/publish');
const siteContentHandler = require('../api/site-content');
const siteContentAdminHandler = require('../api/admin/site-content');
const usageHandler = require('../api/admin/chat-usage');
const chatHandler = require('../api/chat');

function streamFor(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

function createBlobStore() {
  const values = new Map();
  let nextEtag = 1;
  return {
    values,
    client: {
      async get(path) {
        if (!values.has(path)) return null;
        const entry = values.get(path);
        return { stream: streamFor(entry.body), blob: { etag: entry.etag } };
      },
      async put(path, body, options) {
        const prior = values.get(path);
        if (options.allowOverwrite === false && prior) throw new Error('already exists');
        if (options.ifMatch && (!prior || options.ifMatch !== prior.etag)) throw new Error('etag mismatch');
        values.set(path, { body, etag: `etag-${nextEtag++}`, options });
        return { pathname: path };
      }
    }
  };
}

function response() {
  const result = { headers: {}, statusCode: null, body: undefined };
  result.setHeader = (name, value) => { result.headers[name] = value; };
  result.status = code => { result.statusCode = code; return result; };
  result.json = body => { result.body = body; return body; };
  return result;
}

async function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test.afterEach(() => {
  privateBlob._test.resetBlobClientForTests();
  control._test.resetBlobClientForTests();
});

test('private Blob weak ETags are normalized for conditional updates', () => {
  assert.equal(privateBlob._test.normalizeEtag('W/"fc155ab0"'), 'fc155ab0');
  assert.equal(privateBlob._test.normalizeEtag('plain-etag'), 'plain-etag');
  assert.equal(privateBlob._test.normalizeEtag(null), null);
});

test('usage periods follow the accommodation time zone instead of UTC', () => {
  const previous = process.env.CHAT_USAGE_TIME_ZONE;
  process.env.CHAT_USAGE_TIME_ZONE = 'Asia/Seoul';
  try {
    assert.deepEqual(usage._test.period(new Date('2026-09-10T16:30:00Z')), { day: '2026-09-11', month: '2026-09' });
  } finally {
    if (previous === undefined) delete process.env.CHAT_USAGE_TIME_ZONE;
    else process.env.CHAT_USAGE_TIME_ZONE = previous;
  }
});

test('settings API starts from current Extay defaults, saves a normalized draft, and publishes it with an actor record', async () => {
  const store = createBlobStore();
  privateBlob._test.setBlobClientForTests(store.client);
  await withEnv({ CHAT_ADMIN_PASSWORD: 'admin password', CHAT_ADMIN_ACTOR: 'extay-operator' }, async () => {
    let res = response();
    await adminSettingsHandler({ method: 'GET', headers: { 'x-admin-password': 'admin password' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draft.settings.property.name, '익스테이 맨션 해방촌');
    assert.equal(res.body.draft.settings.guides.wifiSsid, 'U+Net46F0_5G');
    assert.deepEqual(res.body.draft.settings.limits, { daily: 0, monthly: 0 });

    res = response();
    await adminSettingsHandler({
      method: 'PUT',
      headers: { 'x-admin-password': 'admin password' },
      body: {
        settings: {
          property: { name: 'New Stay', description: '새 소개', kakaoUrl: 'javascript:alert(1)', googleMapUrl: 'https://maps.example/stay' },
          guides: { wifiSsid: 'Guest WiFi', wifiPassword: 'new-password' },
          images: { hero: ['https://images.example/hero.jpg', 'assets/extay/local.webp', 'javascript:bad'], gallery: [] },
          faq: [{ question: 'Where is the key?', answer: 'Check Airbnb messages.' }],
          limits: { daily: 3, monthly: 40 }
        }
      }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draft.settings.property.name, 'New Stay');
    assert.equal(res.body.draft.settings.property.description, '새 소개');
    assert.equal(res.body.draft.settings.property.kakaoUrl, '');
    assert.equal(res.body.draft.settings.property.googleMapUrl, 'https://maps.example/stay');
    assert.deepEqual(res.body.draft.settings.images.hero, ['https://images.example/hero.jpg', 'assets/extay/local.webp']);
    assert.equal(res.body.draft.updatedBy, 'extay-operator');
    assert.match(res.body.draft.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    const revision = res.body.draft.revision;

    res = response();
    await publishHandler({ method: 'POST', headers: { 'x-admin-password': 'admin password' }, body: { expectedRevision: revision } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.published.settings.property.name, 'New Stay');
    assert.equal(res.body.published.publishedBy, 'extay-operator');
  });
});

test('published settings are publicly readable without draft data and no-store', async () => {
  const store = createBlobStore();
  privateBlob._test.setBlobClientForTests(store.client);
  await withEnv({ CHAT_ADMIN_PASSWORD: 'admin password' }, async () => {
    const draft = await settings.saveDraft({ property: { name: 'Published Stay' } });
    await settings.publishDraft(draft.revision);
    const res = response();
    await settingsHandler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.published.settings.property.name, 'Published Stay');
    assert.equal(res.body.draft, undefined);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
  });
});

test('admin site-content contract supplies defaults, usage, draft save, and publish for the existing admin UI', async () => {
  const store = createBlobStore();
  privateBlob._test.setBlobClientForTests(store.client);
  await withEnv({ CHAT_ADMIN_PASSWORD: 'admin password' }, async () => {
    let res = response();
    await siteContentAdminHandler({ method: 'GET', headers: { 'x-admin-password': 'admin password' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draft.property.address, '서울시 용산구 신흥로 59, 2층');
    assert.equal(res.body.usage.calls, 0);
    assert.deepEqual(res.body.limits, { daily: 0, monthly: 0 });

    const nextDraft = { ...res.body.draft, limits: { daily: 2, monthly: 20 } };
    res = response();
    await siteContentAdminHandler({ method: 'PUT', headers: { 'x-admin-password': 'admin password' }, body: { draft: nextDraft } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.draft.limits.daily, 2);

    res = response();
    await siteContentAdminHandler({ method: 'POST', headers: { 'x-admin-password': 'admin password' }, body: { action: 'publish' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.published.limits.monthly, 20);

    res = response();
    await siteContentHandler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.published.limits.daily, 2);
    assert.equal(res.body.metadata.publishedBy, undefined);
    assert.equal(typeof res.body.metadata.publishedAt, 'string');
  });
});

test('usage limits persist, expose a no-store admin snapshot, and stop the next call before OpenAI', async () => {
  const store = createBlobStore();
  privateBlob._test.setBlobClientForTests(store.client);
  control._test.setBlobClientForTests({ get: async () => null, put: async () => ({}) });
  await withEnv({ CHAT_ADMIN_PASSWORD: 'admin password', CHAT_CONTROL_INITIAL_ENABLED: 'true', OPENAI_API_KEY: 'test-key' }, async () => {
    let res = response();
    await usageHandler({ method: 'PUT', headers: { 'x-admin-password': 'admin password' }, body: { dailyLimit: 1, monthlyLimit: 5 } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.limits.dailyLimit, 1);

    const now = new Date();
    const first = await usage.reserveChatUsage(now);
    assert.equal(first.allowed, true);
    const second = await usage.reserveChatUsage(now);
    assert.deepEqual(second.code, 'CHAT_DAILY_LIMIT');

    res = response();
    await usageHandler({ method: 'GET', headers: { 'x-admin-password': 'admin password' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.usage.dayCalls, 1);
    assert.equal(res.body.usage.totalCalls, 1);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');

    const originalFetch = global.fetch;
    let openAiCalls = 0;
    global.fetch = async () => { openAiCalls += 1; throw new Error('OpenAI should be blocked'); };
    try {
      res = response();
      await chatHandler({ method: 'POST', body: { message: 'hello' } }, res);
      assert.equal(res.statusCode, 429);
      assert.equal(res.body.code, 'CHAT_DAILY_LIMIT');
      assert.equal(openAiCalls, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('published settings become higher-priority developer context for the OpenAI path', async () => {
  const request = require('../api/chat')._test.buildRequestBody('What is the Wi-Fi?', [], 'gpt-5.4', 'en', {
    property: { name: 'Current Published Stay' },
    guides: { wifiSsid: 'Published WiFi' }
  });
  assert.match(request.input[1].content, /CURRENT_PUBLISHED_SITE_CONTENT/);
  assert.match(request.input[1].content, /Current Published Stay/);
  assert.match(request.input[1].content, /follow CURRENT_PUBLISHED_SITE_CONTENT/);
});
