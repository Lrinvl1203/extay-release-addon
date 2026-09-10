const { getPublishedSettings } = require('../lib/accommodation-settings');
const { setNoStore } = require('../lib/chat-control');

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const published = await getPublishedSettings();
  return res.status(200).json({ published });
};
