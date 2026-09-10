const { isAdminRequest, parseRequestBody, setNoStore } = require('../../lib/chat-control');
const { getSettingsState, saveDraft, publishDraft } = require('../../lib/accommodation-settings');
const { getUsageSnapshot } = require('../../lib/chat-usage');

function metadata(record) {
  return record ? {
    revision: record.revision,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    publishedAt: record.publishedAt,
    publishedBy: record.publishedBy
  } : null;
}

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') {
      const [state, snapshot] = await Promise.all([getSettingsState(), getUsageSnapshot()]);
      return res.status(200).json({
        draft: state.draft.settings,
        draftMeta: metadata(state.draft),
        published: state.published.settings,
        publishedMeta: metadata(state.published),
        usage: { calls: snapshot.usage.dayCalls, ...snapshot.usage },
        limits: { daily: snapshot.limits.dailyLimit || 0, monthly: snapshot.limits.monthlyLimit || 0 }
      });
    }

    const body = parseRequestBody(req);
    if (req.method === 'PUT') {
      if (!body || !body.draft || typeof body.draft !== 'object' || Array.isArray(body.draft)) return res.status(400).json({ error: 'draft must be an object' });
      const draft = await saveDraft(body.draft, body.expectedRevision ?? null);
      return res.status(200).json({ draft: draft.settings, draftMeta: metadata(draft) });
    }
    if (req.method === 'POST') {
      if (!body || body.action !== 'publish') return res.status(400).json({ error: 'action must be publish' });
      const published = await publishDraft(body.expectedRevision ?? null);
      return res.status(200).json({ published: published.settings, publishedMeta: metadata(published) });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (error.code === 'DRAFT_CONFLICT') return res.status(409).json({ error: error.message, code: error.code });
    if (error.code === 'INVALID_LIMIT') return res.status(400).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: error.message || 'Site content storage is unavailable' });
  }
};
