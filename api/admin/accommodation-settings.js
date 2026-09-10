const { isAdminRequest, parseRequestBody, setNoStore } = require('../../lib/chat-control');
const { getSettingsState, saveDraft } = require('../../lib/accommodation-settings');

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') return res.status(200).json(await getSettingsState());
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const body = parseRequestBody(req);
    if (!body || !body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      return res.status(400).json({ error: 'settings must be an object' });
    }
    if (body.expectedRevision !== undefined && body.expectedRevision !== null && typeof body.expectedRevision !== 'string') {
      return res.status(400).json({ error: 'expectedRevision must be a string or null' });
    }
    return res.status(200).json({ draft: await saveDraft(body.settings, body.expectedRevision ?? null) });
  } catch (error) {
    if (error.code === 'DRAFT_CONFLICT') return res.status(409).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: error.message || 'Accommodation settings storage is unavailable' });
  }
};
