const fs = require('fs');
const path = require('path');

const HS_MAX = 10;
const NAME_LEN = 7;
const BLOB_PATH = 'pacmad/hiscores.json';
const LOCAL_FILE = path.join(__dirname, '..', 'data', 'hiscores.json');

function normalizeEntry(e) {
  if (!e || typeof e.score !== 'number' || typeof e.name !== 'string') return null;
  const name = String(e.name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .padEnd(NAME_LEN)
    .slice(0, NAME_LEN);
  const score = Math.max(0, Math.floor(e.score));
  if (!score) return null;
  return { name, score };
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, HS_MAX);
}

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function getRedis() {
  try {
    const { Redis } = require('@upstash/redis');
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

function readLocalFile() {
  try {
    if (!fs.existsSync(LOCAL_FILE)) return [];
    return normalizeList(JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')));
  } catch {
    return [];
  }
}

function writeLocalFile(scores) {
  const dir = path.dirname(LOCAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(scores, null, 2));
}

async function readBlobScores() {
  const { list, get } = require('@vercel/blob');
  const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
  if (!blobs.length) return [];
  const result = await get(blobs[0].url, { access: 'private' });
  if (!result) return [];
  let text = '';
  if (typeof result === 'string') text = result;
  else if (result.stream) {
    const chunks = [];
    for await (const chunk of result.stream) chunks.push(chunk);
    text = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf8');
  } else if (typeof result.text === 'function') {
    text = await result.text();
  } else if (result.body) {
    text = await new Response(result.body).text();
  }
  if (!text) return [];
  return normalizeList(JSON.parse(text));
}

async function writeBlobScores(scores) {
  const { put } = require('@vercel/blob');
  await put(BLOB_PATH, JSON.stringify(scores), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function getScores() {
  if (hasBlob()) {
    try {
      return await readBlobScores();
    } catch (err) {
      if (err && (err.status === 404 || err.code === 'not_found')) return [];
      // fall through to other stores
    }
  }

  const redis = getRedis();
  if (redis) {
    const raw = await redis.get('pacmad:hiscores');
    return normalizeList(raw || []);
  }

  return readLocalFile();
}

async function setScores(scores) {
  const next = normalizeList(scores);

  if (hasBlob()) {
    await writeBlobScores(next);
    return next;
  }

  const redis = getRedis();
  if (redis) {
    await redis.set('pacmad:hiscores', next);
    return next;
  }

  writeLocalFile(next);
  return next;
}

async function addScore(name, score) {
  const entry = normalizeEntry({ name, score });
  if (!entry) {
    const err = new Error('Invalid score entry');
    err.status = 400;
    throw err;
  }
  const list = await getScores();
  list.push(entry);
  const next = await setScores(list);
  const rank = next.findIndex((e) => e.name === entry.name && e.score === entry.score);
  return { scores: next, rank, entry };
}

function hasRemoteStore() {
  return hasBlob() || Boolean(getRedis());
}

module.exports = {
  HS_MAX,
  NAME_LEN,
  normalizeList,
  normalizeEntry,
  getScores,
  setScores,
  addScore,
  hasRemoteStore,
};
