const express = require('express');
const fs = require('fs');
const path = require('path');

// Load .env.local for local development (pulled via `vercel env pull`)
try {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      if (process.env[key]) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
} catch (_) {
  /* ignore */
}

const { getScores, addScore, hasRemoteStore } = require('./lib/scoresStore');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.use(express.json({ limit: '32kb' }));

app.get('/api/scores', async (_req, res) => {
  try {
    const scores = await getScores();
    res.json({ scores, remote: hasRemoteStore() });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.post('/api/scores', async (req, res) => {
  try {
    const result = await addScore(req.body?.name, Number(req.body?.score));
    res.json({ ...result, remote: hasRemoteStore() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pacman running at http://localhost:${PORT}`);
  });
}

module.exports = app;
