const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'leaderboard.db');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json({ limit: '20kb' }));

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Try again in a minute.' },
});

const db = new sqlite3.Database(DB_PATH);

function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

function sanitizeNickname(input) {
  const stripped = String(input)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();

  // Escape dangerous HTML chars for safe rendering if inserted into DOM.
  return stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fetchTop10() {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT device_id as deviceId, nickname, score, updated_at as updatedAt FROM leaderboard ORDER BY score DESC, updated_at ASC LIMIT 10',
      [],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

function fetchTotalPlayers() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as total FROM leaderboard', [], (err, row) =>
      err ? reject(err) : resolve(row.total || 0)
    );
  });
}

function getByDevice(deviceId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT device_id as deviceId, score FROM leaderboard WHERE device_id = ?', [deviceId], (err, row) =>
      err ? reject(err) : resolve(row || null)
    );
  });
}

function upsertScore({ deviceId, nickname, score, updatedAt }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO leaderboard (device_id, nickname, score, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id)
       DO UPDATE SET nickname = excluded.nickname, score = excluded.score, updated_at = excluded.updated_at`,
      [deviceId, nickname, score, updatedAt],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function validDeviceId(v) {
  return typeof v === 'string' && v.length >= 6 && v.length <= 128;
}

function validScore(v) {
  return Number.isInteger(v) && v > 0 && v <= 1_000_000;
}

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const [top, totalPlayers] = await Promise.all([fetchTop10(), fetchTotalPlayers()]);
    res.json({ top, totalPlayers });
  } catch (err) {
    console.error('GET /api/leaderboard failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/score', submitLimiter, async (req, res) => {
  try {
    const { deviceId, nickname, score } = req.body || {};

    if (!validDeviceId(deviceId)) {
      return res.status(400).json({ error: 'Invalid deviceId' });
    }

    const cleanNickname = sanitizeNickname(nickname);
    if (cleanNickname.length < 2 || cleanNickname.length > 18) {
      return res.status(400).json({ error: 'Nickname must be 2-18 characters' });
    }

    if (!validScore(score)) {
      return res.status(400).json({ error: 'Score must be a positive integer <= 1000000' });
    }

    const existing = await getByDevice(deviceId);

    if (!existing || score > existing.score) {
      await upsertScore({
        deviceId,
        nickname: cleanNickname,
        score,
        updatedAt: Date.now(),
      });
    }

    const top = await fetchTop10();
    return res.json({ top });
  } catch (err) {
    console.error('POST /api/score failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Optional: serve the existing frontend for one-command local run.
app.use(express.static(__dirname));

initDb();
app.listen(PORT, () => {
  console.log(`Help the Heart API listening on http://localhost:${PORT}`);
});
