const { randomUUID } = require('node:crypto');
const { readPrivateJson, writePrivateJson } = require('./private-blob');
const { setChatLimits } = require('./chat-usage');

const DRAFT_PATH = 'extay/accommodation-settings-draft.json';
const PUBLISHED_PATH = 'extay/accommodation-settings-published.json';
const MAX_SETTINGS_BYTES = 64 * 1024;

const DEFAULT_SITE_CONTENT = Object.freeze({
  property: {
    name: '익스테이 맨션 해방촌',
    address: '서울시 용산구 신흥로 59, 2층',
    transit: '녹사평역 2번 출구에서 도보 약 15분, 마을버스 이용 시 약 10분입니다.',
    description: '해방촌의 골목과 남산 사이에서 함께 온 사람들과 천천히 머무는 집입니다.',
    phone: '',
    kakaoUrl: '',
    naverMapUrl: 'https://map.naver.com/p/search/%EC%84%9C%EC%9A%B8%EC%8B%9C%20%EC%9A%A9%EC%82%B0%EA%B5%AC%20%EC%8B%A0%ED%9D%A5%EB%A1%9C%2059%202%EC%B8%B5',
    googleMapUrl: 'https://www.google.com/maps/search/?api=1&query=%EC%84%9C%EC%9A%B8%EC%8B%9C%20%EC%9A%A9%EC%82%B0%EA%B5%AC%20%EC%8B%A0%ED%9D%A5%EB%A1%9C%2059'
  },
  stay: {
    checkIn: '16:00',
    checkOut: '11:00',
    entry: '비대면 셀프 체크인입니다. 개인 키 번호는 체크인 당일 Airbnb 메시지로 안내됩니다.',
    parking: '건물 주차는 불가합니다. 주변 유료 공영주차장 또는 모두의주차장 앱을 이용해 주세요.',
    luggage: '체크인 전·체크아웃 후 숙소 내 짐 보관은 불가합니다. 녹사평역 코인락커를 확인해 주세요.'
  },
  guides: {
    wifiSsid: 'U+Net46F0_5G',
    wifiPassword: '8H3#22E97B',
    wifiNotes: '숙소 내부에서는 5G 네트워크를 우선 선택하고, 대소문자·숫자·특수문자를 그대로 입력해 주세요.',
    parking: '주말 점심과 저녁 피크 시간에는 주변 주차장이 만차일 수 있습니다.',
    laundry: '세탁기와 건조기 사용 전 주머니 속 물건을 확인하고, 밤에는 진동과 소음에 유의해 주세요.',
    trash: '음식물은 싱크대 위 전용 통에, 재활용과 일반 쓰레기는 베란다 쓰레기통에 넣어 주세요.',
    facilities: 'TV·OTT, 온수·난방, 비품 보관함, 공용 화장실과 옥상 이용 안내는 가이드에서 확인할 수 있습니다.'
  },
  images: { hero: [], gallery: [] },
  faq: [],
  limits: { daily: 0, monthly: 0 }
});

function actor() {
  return String(process.env.CHAT_ADMIN_ACTOR || 'property-admin').slice(0, 120);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitize(value, depth = 0) {
  if (depth > 8) throw new Error('Settings nesting is too deep');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 10000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error('Settings array is too large');
    return value.map(item => sanitize(item, depth + 1));
  }
  if (!isPlainObject(value)) throw new Error('Settings must contain JSON values only');
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (key.length > 120) throw new Error('Settings key is too long');
    clean[key] = sanitize(item, depth + 1);
  }
  return clean;
}

function cloneDefaultSiteContent() {
  return JSON.parse(JSON.stringify(DEFAULT_SITE_CONTENT));
}

function plainText(value, fallback, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function safeUrl(value, fallback = '') {
  const candidate = plainText(value, fallback, 2000);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return /^https?:$/.test(url.protocol) ? url.toString() : fallback;
  } catch (_) {
    return fallback;
  }
}

function safeImageUrl(value) {
  const candidate = plainText(value, '', 2000);
  if (/^assets\/(?!.*\.\.)[^\s"'<>]+$/i.test(candidate)) return candidate;
  return safeUrl(candidate);
}

function normalizeLimit(value, fallback) {
  if (value === null || value === '') return 0;
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function normalizeUrlList(value, fallback, maximum) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, maximum).map(safeImageUrl).filter(Boolean);
}

function normalizeFaq(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  return value.slice(0, 10).map(item => ({
    question: plainText(item?.question, '', 500),
    answer: plainText(item?.answer, '', 5000)
  })).filter(item => item.question && item.answer);
}

function normalizeSiteContent(value) {
  const defaults = cloneDefaultSiteContent();
  const input = isPlainObject(value) ? value : {};
  const property = isPlainObject(input.property) ? input.property : {};
  const stay = isPlainObject(input.stay) ? input.stay : {};
  const guides = isPlainObject(input.guides) ? input.guides : {};
  const images = isPlainObject(input.images) ? input.images : {};
  const limits = isPlainObject(input.limits) ? input.limits : {};
  return {
    property: {
      name: plainText(property.name, defaults.property.name, 200),
      address: plainText(property.address, defaults.property.address, 500),
      transit: plainText(property.transit, defaults.property.transit, 3000),
      description: plainText(property.description, defaults.property.description, 1200),
      phone: plainText(property.phone, defaults.property.phone, 100),
      kakaoUrl: safeUrl(property.kakaoUrl, defaults.property.kakaoUrl),
      naverMapUrl: safeUrl(property.naverMapUrl, defaults.property.naverMapUrl),
      googleMapUrl: safeUrl(property.googleMapUrl, defaults.property.googleMapUrl)
    },
    stay: {
      checkIn: plainText(stay.checkIn, defaults.stay.checkIn, 50),
      checkOut: plainText(stay.checkOut, defaults.stay.checkOut, 50),
      entry: plainText(stay.entry, defaults.stay.entry, 3000),
      parking: plainText(stay.parking, defaults.stay.parking, 3000),
      luggage: plainText(stay.luggage, defaults.stay.luggage, 3000)
    },
    guides: {
      wifiSsid: plainText(guides.wifiSsid, defaults.guides.wifiSsid, 200),
      wifiPassword: plainText(guides.wifiPassword, defaults.guides.wifiPassword, 500),
      wifiNotes: plainText(guides.wifiNotes, defaults.guides.wifiNotes, 3000),
      parking: plainText(guides.parking, defaults.guides.parking, 3000),
      laundry: plainText(guides.laundry, defaults.guides.laundry, 3000),
      trash: plainText(guides.trash, defaults.guides.trash, 3000),
      facilities: plainText(guides.facilities, defaults.guides.facilities, 5000)
    },
    images: {
      hero: normalizeUrlList(images.hero, defaults.images.hero, 3),
      gallery: normalizeUrlList(images.gallery, defaults.images.gallery, 12)
    },
    faq: normalizeFaq(input.faq, defaults.faq),
    limits: {
      daily: normalizeLimit(limits.daily, defaults.limits.daily),
      monthly: normalizeLimit(limits.monthly, defaults.limits.monthly)
    }
  };
}

function normalizeRecord(value) {
  if (!value || !isPlainObject(value) || !isPlainObject(value.settings)) return null;
  return {
    revision: typeof value.revision === 'string' ? value.revision : null,
    settings: value.settings,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : null,
    publishedBy: typeof value.publishedBy === 'string' ? value.publishedBy : null
  };
}

async function readRecord(pathname) {
  const record = await readPrivateJson(pathname);
  if (!record) return { record: null, etag: null };
  return { record: normalizeRecord(record.value), etag: record.etag };
}

async function getSettingsState() {
  const [draft, published] = await Promise.all([readRecord(DRAFT_PATH), readRecord(PUBLISHED_PATH)]);
  return {
    draft: draft.record || { revision: null, settings: cloneDefaultSiteContent(), updatedAt: null, updatedBy: null, publishedAt: null, publishedBy: null },
    published: published.record || { revision: null, settings: cloneDefaultSiteContent(), updatedAt: null, updatedBy: null, publishedAt: null, publishedBy: null }
  };
}

async function getPublishedSettings() {
  try {
    return (await readRecord(PUBLISHED_PATH)).record || { revision: null, settings: cloneDefaultSiteContent(), updatedAt: null, updatedBy: null, publishedAt: null, publishedBy: null };
  } catch (_) {
    return null;
  }
}

async function saveDraft(settings, expectedRevision = null) {
  const cleaned = normalizeSiteContent(sanitize(settings));
  if (Buffer.byteLength(JSON.stringify(cleaned), 'utf8') > MAX_SETTINGS_BYTES) throw new Error('Settings are too large');
  const current = await readRecord(DRAFT_PATH);
  if (expectedRevision !== null && current.record?.revision !== expectedRevision) {
    const error = new Error('Draft has changed. Reload before saving.');
    error.code = 'DRAFT_CONFLICT';
    throw error;
  }
  const draft = {
    revision: randomUUID(),
    settings: cleaned,
    updatedAt: new Date().toISOString(),
    updatedBy: actor(),
    publishedAt: null,
    publishedBy: null
  };
  await writePrivateJson(DRAFT_PATH, draft, { etag: current.etag, createOnly: !current.etag });
  return draft;
}

async function publishDraft(expectedRevision = null) {
  const draft = await readRecord(DRAFT_PATH);
  if (!draft.record) draft.record = { revision: null, settings: cloneDefaultSiteContent(), updatedAt: null, updatedBy: null };
  if (expectedRevision !== null && draft.record.revision !== expectedRevision) {
    const error = new Error('Draft has changed. Reload before publishing.');
    error.code = 'DRAFT_CONFLICT';
    throw error;
  }
  const existing = await readRecord(PUBLISHED_PATH);
  const published = {
    revision: draft.record.revision,
    settings: draft.record.settings,
    updatedAt: new Date().toISOString(),
    updatedBy: actor(),
    publishedAt: new Date().toISOString(),
    publishedBy: actor()
  };
  await writePrivateJson(PUBLISHED_PATH, published, { etag: existing.etag, createOnly: !existing.etag });
  // Limits are copied to their own small record so each guest chat need not load full site content.
  await setChatLimits({
    dailyLimit: published.settings.limits.daily || null,
    monthlyLimit: published.settings.limits.monthly || null
  });
  return published;
}

module.exports = {
  DRAFT_PATH,
  PUBLISHED_PATH,
  getSettingsState,
  getPublishedSettings,
  saveDraft,
  publishDraft,
  _test: { DEFAULT_SITE_CONTENT, sanitize, normalizeRecord, normalizeSiteContent }
};
