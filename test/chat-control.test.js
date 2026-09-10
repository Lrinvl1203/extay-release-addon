const assert = require('node:assert/strict');
const test = require('node:test');

const control = require('../lib/chat-control');
const statusHandler = require('../api/chat-status');
const adminHandler = require('../api/admin/chat-control');
const chatHandler = require('../api/chat');

function streamFor(text) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}

function createBlobStore(value = null) {
  let stored = value;
  const calls = { get: [], put: [] };
  return {
    calls,
    client: {
      async get(path, options) {
        calls.get.push({ path, options });
        return stored === null ? null : { stream: streamFor(stored) };
      },
      async put(path, body, options) {
        calls.put.push({ path, body, options });
        stored = body;
        return { pathname: path };
      }
    },
    value: () => stored
  };
}

function response() {
  const result = { headers: {}, statusCode: null, body: undefined };
  result.setHeader = (name, value) => { result.headers[name] = value; };
  result.status = code => { result.statusCode = code; return result; };
  result.json = body => { result.body = body; return body; };
  result.end = () => undefined;
  return result;
}

function withEnv(values, callback) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  return Promise.resolve(callback()).finally(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test.afterEach(() => control._test.resetBlobClientForTests());

test('control uses a private, uncached blob and fails closed on malformed or unavailable storage', async () => {
  const empty = createBlobStore();
  control._test.setBlobClientForTests(empty.client);
  await withEnv({ CHAT_CONTROL_INITIAL_ENABLED: 'true' }, async () => {
    assert.deepEqual(await control.getChatControl(), { enabled: true, reason: '', updatedAt: null });
  });
  assert.deepEqual(empty.calls.get[0], {
    path: control.CONTROL_PATH,
    options: { access: 'private', useCache: false }
  });

  control._test.setBlobClientForTests({ get: async () => { throw new Error('storage unavailable'); }, put: async () => {} });
  assert.deepEqual(await control.getChatControl(), { enabled: false, reason: '', updatedAt: null });

  const malformed = createBlobStore('{"enabled":"yes"}');
  control._test.setBlobClientForTests(malformed.client);
  assert.deepEqual(await control.getChatControl(), { enabled: false, reason: '', updatedAt: null });
});

test('admin API persists a private state record and rejects unauthenticated or invalid writes', async () => {
  const store = createBlobStore();
  control._test.setBlobClientForTests(store.client);
  await withEnv({ CHAT_ADMIN_PASSWORD: 'correct horse battery staple' }, async () => {
    let res = response();
    await adminHandler({ method: 'PUT', headers: {}, body: { enabled: true } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(store.calls.put.length, 0);

    res = response();
    await adminHandler({ method: 'PUT', headers: { 'x-admin-password': 'wrong password' }, body: { enabled: 'true' } }, res);
    assert.equal(res.statusCode, 401);

    res = response();
    await adminHandler({ method: 'PUT', headers: { 'x-admin-password': 'correct horse battery staple' }, body: { enabled: 'true' } }, res);
    assert.equal(res.statusCode, 400);

    res = response();
    await adminHandler({ method: 'PUT', headers: { 'x-admin-password': 'correct horse battery staple' }, body: { enabled: true, reason: 'Guest season starts' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.reason, 'Guest season starts');
    assert.match(res.body.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
    assert.equal(store.calls.put.length, 1);
    assert.deepEqual(store.calls.put[0].options, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json'
    });

    res = response();
    await adminHandler({ method: 'GET', headers: { 'x-admin-password': 'correct horse battery staple' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.reason, 'Guest season starts');

    res = response();
    await adminHandler({ method: 'POST', headers: { 'x-admin-password': 'correct horse battery staple' } }, res);
    assert.equal(res.statusCode, 405);
  });
});

test('public status is no-store and exposes only the enabled flag', async () => {
  const store = createBlobStore(JSON.stringify({ enabled: true, reason: 'internal note', updatedAt: '2026-09-11T00:00:00.000Z' }));
  control._test.setBlobClientForTests(store.client);
  const res = response();
  await statusHandler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { enabled: true });
  assert.equal(res.headers['Cache-Control'], 'no-store, max-age=0');
});

test('disabled chat blocks direct API calls before OpenAI fetch', async () => {
  const store = createBlobStore(JSON.stringify({ enabled: false, reason: 'budget guard', updatedAt: '2026-09-11T00:00:00.000Z' }));
  control._test.setBlobClientForTests(store.client);
  await withEnv({ OPENAI_API_KEY: 'test-key' }, async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = async () => { fetchCalls += 1; throw new Error('OpenAI must not be called'); };
    try {
      const res = response();
      await chatHandler({ method: 'POST', body: { message: 'hello' } }, res);
      assert.equal(res.statusCode, 503);
      assert.deepEqual(res.body, { error: 'Chat is currently unavailable', code: 'CHAT_DISABLED' });
      assert.equal(fetchCalls, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
