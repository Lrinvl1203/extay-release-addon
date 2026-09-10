const { getChatControl, setNoStore } = require('../lib/chat-control');

module.exports = async function handler(req, res) {
  setNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const control = await getChatControl();
  return res.status(200).json({ enabled: control.enabled });
};
