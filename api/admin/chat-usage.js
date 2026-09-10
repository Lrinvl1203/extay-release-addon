const { isAdminRequest, parseRequestBody, setNoStore } = require('../../lib/chat-control');
const { getUsageSnapshot, setChatLimits } = require('../../lib/chat-usage');

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (req.method === 'GET') return res.status(200).json(await getUsageSnapshot());
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const body = parseRequestBody(req);
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'dailyLimit') || !Object.prototype.hasOwnProperty.call(body, 'monthlyLimit')) {
      return res.status(400).json({ error: 'dailyLimit and monthlyLimit are required' });
    }
    return res.status(200).json({ limits: await setChatLimits(body) });
  } catch (error) {
    if (error.code === 'INVALID_LIMIT') return res.status(400).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: 'Chat usage storage is unavailable' });
  }
};
