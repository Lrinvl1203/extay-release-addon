const { isAdminRequest, parseRequestBody, setNoStore } = require('../../../lib/chat-control');
const { publishDraft } = require('../../../lib/accommodation-settings');

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = parseRequestBody(req);
  if (!body || (body.expectedRevision !== undefined && body.expectedRevision !== null && typeof body.expectedRevision !== 'string')) {
    return res.status(400).json({ error: 'expectedRevision must be a string or null' });
  }
  try {
    return res.status(200).json({ published: await publishDraft(body.expectedRevision ?? null) });
  } catch (error) {
    if (error.code === 'DRAFT_CONFLICT') return res.status(409).json({ error: error.message, code: error.code });
    if (error.code === 'NO_DRAFT') return res.status(400).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: 'Accommodation settings storage is unavailable' });
  }
};
