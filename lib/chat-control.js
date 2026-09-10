const { createHash, timingSafeEqual } = require('node:crypto');
const { get, put } = require('@vercel/blob');

const CONTROL_PATH = 'extay/chat-control.json';
let blobClient = { get, put };

function initialEnabled() {
  return String(process.env.CHAT_CONTROL_INITIAL_ENABLED || '').toLowerCase() === 'true';
}

function disabledControl() {
  return { enabled: false, reason: '', updatedAt: null };
}

function normalizeControl(value) {
  if (!value || typeof value.enabled !== 'boolean') return null;
  return {
    enabled: value.enabled,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 500) : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null
  };
}

async function readBlobText(blob) {
  return new Response(blob.stream).text();
}

async function getChatControl() {
  try {
    const blob = await blobClient.get(CONTROL_PATH, { access: 'private', useCache: false });
    if (!blob) return { enabled: initialEnabled(), reason: '', updatedAt: null };
    const control = normalizeControl(JSON.parse(await readBlobText(blob)));
    return control || disabledControl();
  } catch (_) {
    // A read failure must never leave the paid API enabled.
    return disabledControl();
  }
}

async function setChatControl(enabled, reason = '') {
  const control = {
    enabled,
    reason: String(reason || '').trim().slice(0, 500),
    updatedAt: new Date().toISOString()
  };
  await blobClient.put(CONTROL_PATH, JSON.stringify(control), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
  return control;
}

function requestHeader(req, name) {
  const headers = req && req.headers ? req.headers : {};
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest();
}

function isAdminRequest(req) {
  const expected = process.env.CHAT_ADMIN_PASSWORD;
  const supplied = requestHeader(req, 'x-admin-password');
  if (!expected || typeof supplied !== 'string') return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}

function parseRequestBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch (_) {
      return null;
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function setBlobClientForTests(client) {
  blobClient = client;
}

function resetBlobClientForTests() {
  blobClient = { get, put };
}

module.exports = {
  CONTROL_PATH,
  getChatControl,
  setChatControl,
  isAdminRequest,
  parseRequestBody,
  setNoStore,
  _test: { initialEnabled, normalizeControl, setBlobClientForTests, resetBlobClientForTests }
};
