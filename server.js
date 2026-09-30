const crypto = require('crypto');
const cheerio = require('cheerio');
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 3000);
const db = new Database(path.join(__dirname, 'streakforce.sqlite'));
const SESSION_DAYS = 30;
const SESSION_COOKIE = 'streakforce_session';
const CODING_PLATFORMS = new Set(['leetcode', 'codechef', 'codeforces', 'atcoder']);
const MANUAL_PLATFORMS = new Set(['codechef', 'speakits', 'duolingo', 'dsa-ideas']);
const DEFAULT_SETTINGS = {
  remindersEnabled: true,
  reminderTime: '19:00',
  notificationsEnabled: true,
  animations: true,
  theme: 'system',
  autoSync: true
};

db.pragma('journal_mode = WAL');

const profileTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'profiles'").get();
if (profileTable?.sql.includes('CHECK (id = 1)')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`CREATE TABLE profiles_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_salt TEXT,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO profiles_new (id, created_at, updated_at) SELECT id, created_at, updated_at FROM profiles;
  DROP TABLE profiles;
  ALTER TABLE profiles_new RENAME TO profiles;`);
  db.pragma('foreign_keys = ON');
} else {
  db.exec(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_salt TEXT,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'coding',
    username TEXT NOT NULL,
    profile_url TEXT,
    stats_json TEXT NOT NULL DEFAULT '{}',
    last_synced_at TEXT,
    sync_status TEXT NOT NULL DEFAULT 'never',
    sync_error TEXT,
    UNIQUE(profile_id, platform_id)
  );
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL,
    external_id TEXT,
    activity_date TEXT NOT NULL,
    problem_name TEXT,
    problem_url TEXT,
    difficulty TEXT,
    topics_json TEXT NOT NULL DEFAULT '[]',
    submissions INTEGER NOT NULL DEFAULT 0,
    contests INTEGER NOT NULL DEFAULT 0,
    rating REAL,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_id, platform_id, external_id, activity_date, problem_name)
  );
  CREATE TABLE IF NOT EXISTS manual_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL,
    activity_date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_id, platform_id, activity_date)
  );
  CREATE TABLE IF NOT EXISTS settings (
    profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    data_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

for (const [table, column, definition] of [
  ['platform_connections', 'stats_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['platform_connections', 'category', "TEXT NOT NULL DEFAULT 'coding'"]
]) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); }
  catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
}

db.prepare('INSERT OR IGNORE INTO profiles (id) VALUES (1)').run();

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function createSession(profileId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, profile_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), profileId, expiresAt);
  setSessionCookie(res, token);
}

function currentProfile(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db.prepare(`SELECT profiles.id, profiles.email FROM sessions
    JOIN profiles ON profiles.id = sessions.profile_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), new Date().toISOString());
  return session || null;
}

function requireAuth(req, res, next) {
  const profile = currentProfile(req);
  if (!profile) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.profile = profile;
  next();
}

function validateDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function getActivities(profileId, platformId) {
  const query = platformId
    ? 'SELECT * FROM activities WHERE profile_id = ? AND platform_id = ? ORDER BY activity_date DESC, id DESC'
    : 'SELECT * FROM activities WHERE profile_id = ? ORDER BY activity_date DESC, id DESC';
  return db.prepare(query).all(...(platformId ? [profileId, platformId] : [profileId])).map(row => ({
    ...row,
    topics: parseJson(row.topics_json, []),
    raw: parseJson(row.raw_json, null)
  }));
}

function toActivityLog(profileId, platformId) {
  const grouped = new Map();
  getActivities(profileId, platformId).forEach(row => {
    const current = grouped.get(row.activity_date) || { date: row.activity_date, problemsSolved: 0, topics: [], contestsJoined: 0, problems: [], submissions: 0 };
    if (row.problem_name) {
      current.problems.push({ name: row.problem_name, url: row.problem_url, difficulty: row.difficulty, topics: row.topics });
      current.problemsSolved += 1;
    }
    current.submissions += row.submissions || 0;
    current.contestsJoined += row.contests || 0;
    current.topics = [...new Set(current.topics.concat(row.topics))];
    grouped.set(row.activity_date, current);
  });
  return [...grouped.values()];
}

async function fetchPlatformData(connection) {
  if (connection.platform_id === 'codechef') {
    const response = await fetch(`https://www.codechef.com/users/${encodeURIComponent(connection.username)}`, {
      headers: { Accept: 'text/html', 'User-Agent': 'StreakForce/1.0 (public profile sync)' }
    });
    if (!response.ok) throw new Error(`CodeChef profile returned HTTP ${response.status}`);
    const $ = cheerio.load(await response.text());
    const profileHandle = String($('#user_handle').val() || '').trim();
    const totalLabel = $('h3').filter((_, element) => $(element).text().includes('Total Problems Solved')).first().text();
    const totalMatch = totalLabel.match(/Total Problems Solved:\s*([\d,]+)/);
    if (!profileHandle || !totalMatch) throw new Error('Could not read a public CodeChef solved total. Check the username or try again later.');
    if (profileHandle.toLowerCase() !== connection.username.toLowerCase()) throw new Error('CodeChef returned a different profile than the requested username.');
    return {
      records: [],
      stats: {
        totalSolved: Number(totalMatch[1].replace(/,/g, '')),
        source: 'CodeChef public profile',
        scope: 'Lifetime solved total is automatic. Reliable dated submission history is not exposed; daily rows are optional manual entries.'
      }
    };
  }

  if (connection.platform_id === 'leetcode') {
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com/' },
      body: JSON.stringify({
        query: `query recentAcSubmissionList($username: String!, $limit: Int!) {
          recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
          matchedUser(username: $username) { submitStats { acSubmissionNum { difficulty count } } }
        }`,
        variables: { username: connection.username, limit: 100 }
      })
    });
    if (!response.ok) throw new Error(`LeetCode returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message || 'LeetCode rejected the request');
    const accepted = payload.data?.recentAcSubmissionList || [];
    const totals = payload.data?.matchedUser?.submitStats?.acSubmissionNum || [];
    return {
      records: accepted.map(item => ({
        externalId: String(item.id),
        date: new Date(Number(item.timestamp) * 1000).toISOString().slice(0, 10),
        problemName: item.title || null,
        problemUrl: item.titleSlug ? `https://leetcode.com/problems/${item.titleSlug}/` : null,
        topics: [], submissions: 1, contests: 0, raw: item
      })),
      stats: {
        totalSolved: totals.reduce((sum, item) => sum + (item.difficulty === 'All' ? Number(item.count) : 0), 0),
        source: 'LeetCode public profile',
        scope: 'Lifetime total from the public profile; dated activity is limited to the latest 100 accepted submissions.'
      }
    };
  }

  if (connection.platform_id === 'codeforces') {
    const response = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(connection.username)}`);
    if (!response.ok) throw new Error(`Codeforces returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 'OK') throw new Error(payload.comment || 'Codeforces rejected the request');
    const solved = new Map();
    [...payload.result].reverse().filter(item => item.verdict === 'OK').forEach(item => {
      const key = `${item.problem?.contestId || item.contestId || 'practice'}-${item.problem?.index || ''}`;
      if (!solved.has(key)) solved.set(key, item);
    });
    const records = [...solved.values()].map(item => ({
      externalId: `accepted-${item.problem?.contestId || item.contestId || 'practice'}-${item.problem?.index || item.id}`,
      date: new Date(item.creationTimeSeconds * 1000).toISOString().slice(0, 10),
      problemName: item.problem?.name || null,
      problemUrl: item.problem?.contestId ? `https://codeforces.com/problemset/problem/${item.problem.contestId}/${item.problem.index}` : null,
      difficulty: item.problem?.rating ? String(item.problem.rating) : null,
      topics: item.problem?.tags || [], submissions: 1, contests: item.problem?.contestId ? 1 : 0, raw: item
    }));
    return { records, stats: { totalSolved: solved.size, source: 'Codeforces accepted submissions', scope: 'Distinct accepted problems from the public user-status response.' } };
  }

  if (connection.platform_id === 'atcoder') {
    const records = [];
    const earliest = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
    let fromSecond = earliest;
    for (let page = 0; page < 20; page++) {
      const url = `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(connection.username)}&from_second=${fromSecond}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`AtCoder activity service returned HTTP ${response.status}`);
      const submissions = await response.json();
      if (!Array.isArray(submissions)) throw new Error('AtCoder activity service returned an unexpected response.');
      if (!submissions.length) break;
      records.push(...submissions.filter(item => item.result === 1).map(item => ({
        externalId: `accepted-${item.problem_id}`,
        date: new Date(item.epoch_second * 1000).toISOString().slice(0, 10),
        problemName: item.problem_id,
        problemUrl: `https://atcoder.jp/contests/${item.problem_id.split('_')[0]}/tasks/${item.problem_id}`,
        topics: [], submissions: 1, contests: 0, raw: item
      })));
      const latestTimestamp = Math.max(...submissions.map(item => Number(item.epoch_second) || 0));
      if (submissions.length < 500 || latestTimestamp < fromSecond) break;
      fromSecond = latestTimestamp + 1;
    }
    const unique = new Map();
    records.sort((a, b) => a.date.localeCompare(b.date)).forEach(record => {
      if (!unique.has(record.externalId)) unique.set(record.externalId, record);
    });
    const normalized = [...unique.values()];
    return { records: normalized, stats: { totalSolved: normalized.length, source: 'AtCoder Problems API', scope: 'Accepted problems found in the latest year of public submissions' } };
  }

  throw new Error(`Automatic sync is not configured for ${connection.platform_id}. Your saved history is unchanged.`);
}

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(__dirname));

app.get('/api/auth/session', (req, res) => {
  const profile = currentProfile(req);
  res.json({ authenticated: Boolean(profile), profile: profile ? { id: profile.id, email: profile.email } : null });
});

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  if (db.prepare('SELECT id FROM profiles WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  const legacy = db.prepare('SELECT id FROM profiles WHERE id = 1 AND email IS NULL').get();
  const salt = crypto.randomBytes(16).toString('hex');
  let profileId;
  if (legacy) {
    profileId = legacy.id;
    db.prepare('UPDATE profiles SET email = ?, password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email, salt, hashPassword(password, salt), profileId);
  } else {
    const result = db.prepare('INSERT INTO profiles (email, password_salt, password_hash) VALUES (?, ?, ?)').run(email, salt, hashPassword(password, salt));
    profileId = Number(result.lastInsertRowid);
  }
  db.prepare('INSERT OR IGNORE INTO settings (profile_id, data_json) VALUES (?, ?)').run(profileId, JSON.stringify(DEFAULT_SETTINGS));
  createSession(profileId, res);
  res.status(201).json({ profile: { id: profileId, email } });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const profile = db.prepare('SELECT id, email, password_salt, password_hash FROM profiles WHERE email = ?').get(email);
  if (!profile?.password_hash || !profile.password_salt || !crypto.timingSafeEqual(Buffer.from(hashPassword(password, profile.password_salt), 'hex'), Buffer.from(profile.password_hash, 'hex'))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  createSession(profile.id, res);
  res.json({ profile: { id: profile.id, email: profile.email } });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
  const token = cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, (req, res) => {
  const profileId = req.profile.id;
  const settingsRow = db.prepare('SELECT data_json FROM settings WHERE profile_id = ?').get(profileId);
  const connections = db.prepare('SELECT * FROM platform_connections WHERE profile_id = ? ORDER BY id').all(profileId).map(connection => ({
    ...connection,
    stats: parseJson(connection.stats_json, {})
  }));
  const manualActivities = db.prepare('SELECT platform_id, activity_date AS date, amount, note FROM manual_activities WHERE profile_id = ? ORDER BY activity_date DESC').all(profileId);
  res.json({
    profile: { id: req.profile.id, email: req.profile.email },
    connections,
    activities: getActivities(profileId),
    manualActivities,
    settings: { ...DEFAULT_SETTINGS, ...parseJson(settingsRow?.data_json, {}) }
  });
});

app.put('/api/settings', requireAuth, (req, res) => {
  const next = { ...DEFAULT_SETTINGS, ...(req.body || {}) };
  db.prepare(`INSERT INTO settings (profile_id, data_json) VALUES (?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP`).run(req.profile.id, JSON.stringify(next));
  res.json(next);
});

app.post('/api/manual-activities', requireAuth, (req, res) => {
  const { platformId } = req.body || {};
  const date = String(req.body?.date || '');
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!MANUAL_PLATFORMS.has(platformId)) return res.status(400).json({ error: 'This platform is not available for manual entry.' });
  if (!validateDate(date)) return res.status(400).json({ error: 'Choose a valid activity date.' });
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return res.status(400).json({ error: 'Enter a valid non-negative amount.' });
  if (platformId === 'speakits' && amount !== 1) return res.status(400).json({ error: 'Speakits records one completed session per date.' });
  db.prepare(`INSERT INTO manual_activities (profile_id, platform_id, activity_date, amount, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, platform_id, activity_date) DO UPDATE SET amount = excluded.amount, note = excluded.note, updated_at = CURRENT_TIMESTAMP`)
    .run(req.profile.id, platformId, date, amount, note);
  res.status(201).json({ platformId, date, amount, note });
});

app.delete('/api/manual-activities/:platformId/:date', requireAuth, (req, res) => {
  if (!MANUAL_PLATFORMS.has(req.params.platformId) || !validateDate(req.params.date)) return res.status(400).json({ error: 'Invalid activity entry.' });
  db.prepare('DELETE FROM manual_activities WHERE profile_id = ? AND platform_id = ? AND activity_date = ?').run(req.profile.id, req.params.platformId, req.params.date);
  res.json({ ok: true });
});

app.post('/api/platforms', requireAuth, (req, res) => {
  const platformId = String(req.body?.platformId || '').trim();
  const username = String(req.body?.username || '').trim();
  if (!CODING_PLATFORMS.has(platformId) || !username) return res.status(400).json({ error: 'Choose a supported coding platform and enter its username.' });
  const profileUrl = String(req.body?.profileUrl || '').trim() || null;
  db.prepare(`INSERT INTO platform_connections (profile_id, platform_id, username, profile_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id, platform_id) DO UPDATE SET username = excluded.username, profile_url = excluded.profile_url, sync_status = 'never', sync_error = NULL`)
    .run(req.profile.id, platformId, username, profileUrl);
  res.status(201).json(db.prepare('SELECT * FROM platform_connections WHERE profile_id = ? AND platform_id = ?').get(req.profile.id, platformId));
});

app.delete('/api/platforms/:platformId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM platform_connections WHERE profile_id = ? AND platform_id = ?').run(req.profile.id, req.params.platformId);
  res.json({ ok: true });
});

app.post('/api/platforms/:platformId/sync', requireAuth, async (req, res) => {
  const profileId = req.profile.id;
  const connection = db.prepare('SELECT * FROM platform_connections WHERE profile_id = ? AND platform_id = ?').get(profileId, req.params.platformId);
  if (!connection) return res.status(404).json({ error: 'Connect this platform before syncing.' });
  try {
    const { records, stats } = await fetchPlatformData(connection);
    const insert = db.prepare(`INSERT INTO activities (profile_id, platform_id, external_id, activity_date, problem_name, problem_url, difficulty, topics_json, submissions, contests, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, platform_id, external_id, activity_date, problem_name) DO UPDATE SET topics_json = excluded.topics_json, submissions = excluded.submissions, contests = excluded.contests, raw_json = excluded.raw_json, updated_at = CURRENT_TIMESTAMP`);
    const saveRecords = db.transaction(items => items.forEach(item => insert.run(profileId, connection.platform_id, item.externalId || null, item.date, item.problemName || null, item.problemUrl || null, item.difficulty || null, JSON.stringify(item.topics || []), item.submissions || 0, item.contests || 0, JSON.stringify(item.raw || null))));
    saveRecords(records);
    db.prepare("UPDATE platform_connections SET stats_json = ?, last_synced_at = CURRENT_TIMESTAMP, sync_status = 'success', sync_error = NULL WHERE id = ?")
      .run(JSON.stringify(stats), connection.id);
    res.json({ platformId: connection.platform_id, imported: records.length, stats, activityLog: toActivityLog(profileId, connection.platform_id) });
  } catch (error) {
    db.prepare("UPDATE platform_connections SET sync_status = 'error', sync_error = ? WHERE id = ?").run(error.message, connection.id);
    res.status(502).json({ error: error.message });
  }
});

app.listen(port, () => console.log(`StreakForce running at http://localhost:${port}`));