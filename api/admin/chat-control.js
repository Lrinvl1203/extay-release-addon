const {
  getChatControl,
  isAdminRequest,
  parseRequestBody,
  setChatControl,
  setNoStore
} = require('../../lib/chat-control');

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') return res.status(200).json(await getChatControl());
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const body = parseRequestBody(req);
  if (!body || typeof body.enabled !== 'boolean' || (body.reason !== undefined && typeof body.reason !== 'string')) {
    return res.status(400).json({ error: 'enabled must be a boolean and reason must be a string when provided' });
  }

  try {
    return res.status(200).json(await setChatControl(body.enabled, body.reason));
  } catch (_) {
    return res.status(503).json({ error: 'Chat control storage is unavailable' });
  }
};
