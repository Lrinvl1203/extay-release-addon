const { get, put } = require('@vercel/blob');

let blobClient = { get, put };

async function readBlobText(blob) {
  return new Response(blob.stream).text();
}

function normalizeEtag(value) {
  return typeof value === 'string' ? value.replace(/^W\//, '').replace(/^"|"$/g, '') : null;
}

async function readPrivateJson(pathname) {
  const result = await blobClient.get(pathname, { access: 'private', useCache: false });
  if (!result) return null;
  return {
    value: JSON.parse(await readBlobText(result)),
    // Private Blob GET returns a weak HTTP ETag (W/"...") while conditional
    // PUT expects the opaque tag without the weak prefix or quotes.
    etag: normalizeEtag(result.blob?.etag || result.etag || null)
  };
}

async function writePrivateJson(pathname, value, { etag = null, createOnly = false } = {}) {
  const options = {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'application/json'
  };
  if (createOnly) options.allowOverwrite = false;
  else if (etag) options.ifMatch = etag;
  else options.allowOverwrite = true;
  return blobClient.put(pathname, JSON.stringify(value), options);
}

function setBlobClientForTests(client) {
  blobClient = client;
}

function resetBlobClientForTests() {
  blobClient = { get, put };
}

module.exports = {
  readPrivateJson,
  writePrivateJson,
  _test: { normalizeEtag, setBlobClientForTests, resetBlobClientForTests }
};
