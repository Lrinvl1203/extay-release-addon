const { readPrivateJson, writePrivateJson } = require('./private-blob');

const LIMITS_PATH = 'extay/chat-limits.json';
const USAGE_PATH = 'extay/chat-usage.json';
const MAX_RETRIES = 4;

function actor() {
  return String(process.env.CHAT_ADMIN_ACTOR || 'property-admin').slice(0, 120);
}

function parseLimit(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function envLimit(name) {
  const value = Number(process.env[name]);
  return parseLimit(value);
}

function defaultLimits() {
  return {
    dailyLimit: envLimit('CHAT_DAILY_CALL_LIMIT'),
    monthlyLimit: envLimit('CHAT_MONTHLY_CALL_LIMIT'),
    updatedAt: null,
    updatedBy: null
  };
}

function period(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CHAT_USAGE_TIME_ZONE || 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, month: day.slice(0, 7) };
}

function normalizeLimits(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    dailyLimit: parseLimit(value.dailyLimit),
    monthlyLimit: parseLimit(value.monthlyLimit),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : null
  };
}

function normalizeUsage(value, currentPeriod) {
  const dayCalls = value?.day === currentPeriod.day && Number.isSafeInteger(value?.dayCalls) && value.dayCalls >= 0 ? value.dayCalls : 0;
  const monthCalls = value?.month === currentPeriod.month && Number.isSafeInteger(value?.monthCalls) && value.monthCalls >= 0 ? value.monthCalls : 0;
  const totalCalls = Number.isSafeInteger(value?.totalCalls) && value.totalCalls >= 0 ? value.totalCalls : 0;
  return { day: currentPeriod.day, month: currentPeriod.month, dayCalls, monthCalls, totalCalls, updatedAt: value?.updatedAt || null };
}

async function getChatLimits() {
  const stored = await readPrivateJson(LIMITS_PATH);
  return stored ? normalizeLimits(stored.value) : defaultLimits();
}

async function setChatLimits({ dailyLimit, monthlyLimit }) {
  if ((dailyLimit !== null && !parseLimit(dailyLimit)) || (monthlyLimit !== null && !parseLimit(monthlyLimit))) {
    const error = new Error('Limits must be positive integers or null');
    error.code = 'INVALID_LIMIT';
    throw error;
  }
  const stored = await readPrivateJson(LIMITS_PATH);
  const limits = {
    dailyLimit: dailyLimit === null ? null : dailyLimit,
    monthlyLimit: monthlyLimit === null ? null : monthlyLimit,
    updatedAt: new Date().toISOString(),
    updatedBy: actor()
  };
  await writePrivateJson(LIMITS_PATH, limits, { etag: stored?.etag || null, createOnly: !stored?.etag });
  return limits;
}

async function getUsageSnapshot(now = new Date()) {
  const [limits, stored] = await Promise.all([getChatLimits(), readPrivateJson(USAGE_PATH)]);
  return { limits, usage: normalizeUsage(stored?.value, period(now)) };
}

async function reserveChatUsage(now = new Date()) {
  let limits;
  try {
    limits = await getChatLimits();
  } catch (_) {
    return { allowed: false, code: 'CHAT_USAGE_UNAVAILABLE' };
  }
  if (!limits.dailyLimit && !limits.monthlyLimit) return { allowed: true, usage: null, limits };

  const currentPeriod = period(now);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const stored = await readPrivateJson(USAGE_PATH);
      const usage = normalizeUsage(stored?.value, currentPeriod);
      if (limits.dailyLimit && usage.dayCalls >= limits.dailyLimit) return { allowed: false, code: 'CHAT_DAILY_LIMIT', usage, limits };
      if (limits.monthlyLimit && usage.monthCalls >= limits.monthlyLimit) return { allowed: false, code: 'CHAT_MONTHLY_LIMIT', usage, limits };
      const next = { ...usage, dayCalls: usage.dayCalls + 1, monthCalls: usage.monthCalls + 1, totalCalls: usage.totalCalls + 1, updatedAt: new Date().toISOString() };
      await writePrivateJson(USAGE_PATH, next, { etag: stored?.etag || null, createOnly: !stored?.etag });
      return { allowed: true, usage: next, limits };
    } catch (_) {
      // An ETag collision is retried with the latest counter; Blob cannot atomically increment.
    }
  }
  return { allowed: false, code: 'CHAT_USAGE_UNAVAILABLE' };
}

module.exports = {
  LIMITS_PATH,
  USAGE_PATH,
  getChatLimits,
  setChatLimits,
  getUsageSnapshot,
  reserveChatUsage,
  _test: { period, normalizeUsage, normalizeLimits }
};
