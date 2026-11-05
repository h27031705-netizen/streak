const crypto = require('crypto');
const cheerio = require('cheerio');
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const { analyzeConsistency } = require('./lib/consistency');

const app = express();
const port = Number(process.env.PORT || 3000);
const db = new Database(process.env.STREAKFORCE_DB_PATH || path.join(__dirname, 'streakforce.sqlite'));
const SESSION_DAYS = 30;
const SESSION_COOKIE = 'streakforce_session';
const RECOVERY_COOKIE = 'streakforce_recovery';
const RECOVERY_MINUTES = 10;
const CODING_PLATFORMS = new Set(['leetcode', 'codechef', 'codeforces', 'atcoder']);
const MANUAL_PLATFORMS = new Set(['codechef', 'speakits', 'duolingo', 'dsa-ideas']);
const CATALOG_ITEM_TYPES = new Set(['client', 'app', 'platform', 'service', 'project', 'integration']);
const DEFAULT_SETTINGS = {
  remindersEnabled: true,
  platformRemindersEnabled: true,
  motivationEnabled: true,
  reminderTime: '19:00',
  reminderGapMinutes: 3,
  notificationsEnabled: true,
  browserNotificationsEnabled: false,
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
    name TEXT NOT NULL DEFAULT '',
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
  CREATE TABLE IF NOT EXISTS catalog_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    platform_app TEXT NOT NULL DEFAULT '',
    url TEXT,
    username TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS custom_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    unit TEXT NOT NULL DEFAULT 'sessions',
    frequency_per_week REAL NOT NULL DEFAULT 1,
    target_per_session REAL NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS custom_activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    activity_id INTEGER NOT NULL REFERENCES custom_activities(id),
    activity_date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 1,
    completed INTEGER NOT NULL DEFAULT 1 CHECK (completed IN (0, 1)),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    deadline TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS project_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS project_task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    task_id INTEGER NOT NULL REFERENCES project_tasks(id),
    event_type TEXT NOT NULL CHECK (event_type IN ('completed', 'reopened')),
    project_name TEXT NOT NULL,
    task_title TEXT NOT NULL,
    event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_value REAL NOT NULL,
    current_value REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'items',
    deadline TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS goal_progress_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    goal_id INTEGER NOT NULL REFERENCES goals(id),
    amount REAL NOT NULL,
    progress_date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_custom_activity_logs_profile_date ON custom_activity_logs(profile_id, activity_date);
  CREATE INDEX IF NOT EXISTS idx_project_tasks_profile_project ON project_tasks(profile_id, project_id);
  CREATE INDEX IF NOT EXISTS idx_goal_progress_profile_date ON goal_progress_logs(profile_id, progress_date);
`);

try { db.exec("ALTER TABLE catalog_items ADD COLUMN username TEXT NOT NULL DEFAULT ''"); }
catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }

try { db.exec("ALTER TABLE profiles ADD COLUMN name TEXT NOT NULL DEFAULT ''"); }
catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }

for (const [column, definition] of [
  ['security_question', 'TEXT'],
  ['security_answer_salt', 'TEXT'],
  ['security_answer_hash', 'TEXT']
]) {
  try { db.exec(`ALTER TABLE profiles ADD COLUMN ${column} ${definition}`); }
  catch (error) { if (!String(error.message).includes('duplicate column name')) throw error; }
}

db.exec(`CREATE TABLE IF NOT EXISTS password_recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

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

function normalizeSecurityAnswer(answer) {
  return String(answer || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCookie(req, name) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }));
  return cookies[name];
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(res, token, remember = false) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    ...(remember ? { maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 } : {}),
    path: '/'
  });
}

function createSession(profileId, res, remember = false) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, profile_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), profileId, expiresAt);
  setSessionCookie(res, token, remember);
}

function currentProfile(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = db.prepare(`SELECT profiles.id, profiles.email, profiles.name FROM sessions
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
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function generatedProfileUrl(name, username) {
  const platform = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const user = encodeURIComponent(username);
  if (platform === 'leetcode') return `https://leetcode.com/u/${user}/`;
  if (platform === 'codeforces') return `https://codeforces.com/profile/${user}`;
  if (platform === 'codechef') return `https://www.codechef.com/users/${user}`;
  if (platform === 'atcoder') return `https://atcoder.jp/users/${user}`;
  return '';
}

function normalizeCatalogItem(body = {}) {
  const itemType = String(body.itemType || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || '').trim();
  const platformApp = String(body.platformApp || '').trim();
  const username = itemType === 'platform' ? String(body.username || '').trim() : '';
  const rawUrl = String(body.url || '').trim() || (itemType === 'platform' ? generatedProfileUrl(name, username) : '');
  const status = body.status === 'inactive' ? 'inactive' : 'active';
  if (!CATALOG_ITEM_TYPES.has(itemType)) return { error: 'Choose a supported item type.' };
  if (!name || name.length > 80) return { error: 'Enter a name up to 80 characters.' };
  if (itemType === 'platform' && !username) return { error: 'Enter the platform username or profile ID.' };
  if (username.length > 180) return { error: 'Enter a username or profile ID up to 180 characters.' };
  if (description.length > 1000 || category.length > 80 || platformApp.length > 180) return { error: 'Description, category, or linked app is too long.' };
  let url = null;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid protocol');
      url = parsed.toString();
    } catch { return { error: 'Enter a valid http or https URL.' }; }
  }
  return { value: { itemType, name, description, category, platformApp, username, url, status } };
}

function optionalDate(value) {
  const date = String(value || '').trim();
  return !date || validateDate(date) ? { value: date || null } : { error: 'Choose a valid date.' };
}

function normalizeCustomActivity(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'other').trim().slice(0, 60);
  const unit = String(body.unit || 'sessions').trim().slice(0, 30);
  const frequencyPerWeek = Number(body.frequencyPerWeek ?? 1);
  const targetPerSession = Number(body.targetPerSession ?? 1);
  const status = body.status === 'inactive' ? 'inactive' : 'active';
  if (!name || name.length > 80) return { error: 'Enter an activity name up to 80 characters.' };
  if (description.length > 1000) return { error: 'Description must be 1000 characters or less.' };
  if (!Number.isFinite(frequencyPerWeek) || frequencyPerWeek < 1 || frequencyPerWeek > 14) return { error: 'Frequency must be between 1 and 14 sessions per week.' };
  if (!Number.isFinite(targetPerSession) || targetPerSession <= 0 || targetPerSession > 100000) return { error: 'Enter a valid per-session target.' };
  return { value: { name, description, category, unit, frequencyPerWeek, targetPerSession, status } };
}

function normalizeProject(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium';
  const status = ['active', 'completed', 'paused'].includes(body.status) ? body.status : 'active';
  const deadline = optionalDate(body.deadline);
  if (!name || name.length > 100) return { error: 'Enter a project name up to 100 characters.' };
  if (description.length > 2000) return { error: 'Description must be 2000 characters or less.' };
  if (deadline.error) return deadline;
  return { value: { name, description, priority, status, deadline: deadline.value } };
}

function normalizeGoal(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const unit = String(body.unit || 'items').trim().slice(0, 30);
  const targetValue = Number(body.targetValue);
  const priority = ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium';
  const status = ['active', 'completed', 'paused'].includes(body.status) ? body.status : 'active';
  const deadline = optionalDate(body.deadline);
  if (!name || name.length > 100) return { error: 'Enter a goal name up to 100 characters.' };
  if (description.length > 2000) return { error: 'Description must be 2000 characters or less.' };
  if (!Number.isFinite(targetValue) || targetValue <= 0 || targetValue > 10000000) return { error: 'Enter a target greater than zero.' };
  if (deadline.error) return deadline;
  return { value: { name, description, targetValue, unit, priority, status, deadline: deadline.value } };
}

function customCatalogItem(profileId, platformId, activeOnly = true) {
  const match = /^custom-(\d+)$/.exec(String(platformId));
  if (!match) return null;
  const statusClause = activeOnly ? " AND status = 'active'" : '';
  return db.prepare(`SELECT id FROM catalog_items WHERE id = ? AND profile_id = ? AND deleted_at IS NULL${statusClause}`)
    .get(Number(match[1]), profileId) || null;
}

function canLogManually(profileId, platformId) {
  return MANUAL_PLATFORMS.has(platformId) || Boolean(customCatalogItem(profileId, platformId));
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

function getUnifiedActivity(profileId, limit = 200) {
  const external = db.prepare(`SELECT id, platform_id, activity_date, problem_name, difficulty, contests, submissions
    FROM activities WHERE profile_id = ? ORDER BY activity_date DESC, id DESC LIMIT ?`).all(profileId, limit).map(row => ({
    id: `platform-${row.id}`,
    date: row.activity_date,
    type: 'platform',
    sourceId: row.platform_id,
    title: row.problem_name || `${row.platform_id} activity`,
    amount: row.problem_name ? 1 : Number(row.submissions || 0),
    unit: row.problem_name ? 'problems' : 'submissions',
    detail: row.difficulty || '',
    completed: true
  }));
  const manual = db.prepare(`SELECT id, platform_id, activity_date, amount, note
    FROM manual_activities WHERE profile_id = ? ORDER BY activity_date DESC, id DESC LIMIT ?`).all(profileId, limit).map(row => ({
    id: `manual-${row.id}`,
    date: row.activity_date,
    type: 'manual',
    sourceId: row.platform_id,
    title: `${row.platform_id} activity`,
    amount: Number(row.amount),
    unit: 'activities',
    detail: row.note,
    completed: Number(row.amount) > 0
  }));
  const custom = db.prepare(`SELECT logs.id, logs.activity_date, logs.amount, logs.completed, logs.note, activities.id AS activity_id, activities.name, activities.unit
    FROM custom_activity_logs logs JOIN custom_activities activities ON activities.id = logs.activity_id
    WHERE logs.profile_id = ? ORDER BY logs.activity_date DESC, logs.id DESC LIMIT ?`).all(profileId, limit).map(row => ({
    id: `custom-${row.id}`,
    date: row.activity_date,
    type: 'custom-activity',
    sourceId: `activity-${row.activity_id}`,
    title: row.name,
    amount: Number(row.amount),
    unit: row.unit,
    detail: row.note,
    completed: Boolean(row.completed)
  }));
  const taskEvents = db.prepare(`SELECT id, project_id, task_id, event_type, project_name, task_title, event_at
    FROM project_task_events WHERE profile_id = ? ORDER BY event_at DESC LIMIT ?`).all(profileId, limit).map(row => ({
    id: `task-event-${row.id}`,
    date: String(row.event_at || '').slice(0, 10),
    type: row.event_type === 'completed' ? 'project-task' : 'project-task-reopened',
    sourceId: `project-task-${row.task_id}`,
    title: row.task_title,
    amount: 1,
    unit: 'task',
    detail: row.project_name,
    completed: row.event_type === 'completed'
  })).filter(event => event.date);
  const goals = db.prepare(`SELECT logs.id, logs.goal_id, logs.amount, logs.progress_date, logs.note, goals.name, goals.unit
    FROM goal_progress_logs logs JOIN goals ON goals.id = logs.goal_id
    WHERE logs.profile_id = ? ORDER BY logs.progress_date DESC, logs.id DESC LIMIT ?`).all(profileId, limit).map(row => ({
    id: `goal-${row.id}`,
    date: row.progress_date,
    type: 'goal-progress',
    sourceId: `goal-${row.goal_id}`,
    title: row.name,
    amount: Number(row.amount),
    unit: row.unit,
    detail: row.note,
    completed: true
  }));
  return [...external, ...manual, ...custom, ...taskEvents, ...goals]
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
    .slice(0, limit);
}

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(__dirname));

app.get('/api/auth/session', (req, res) => {
  const profile = currentProfile(req);
  res.json({ authenticated: Boolean(profile), profile: profile ? { id: profile.id, email: profile.email, name: profile.name } : null });
});

app.post('/api/auth/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const password = String(req.body?.password || '');
  const securityQuestion = String(req.body?.securityQuestion || '').trim().slice(0, 200);
  const securityAnswer = normalizeSecurityAnswer(req.body?.securityAnswer);
  const remember = req.body?.remember === true;
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  if (!securityQuestion || securityQuestion.length > 200 || !securityAnswer || securityAnswer.length > 200) return res.status(400).json({ error: 'Add a security question and answer for account recovery.' });
  if (db.prepare('SELECT id FROM profiles WHERE email = ?').get(email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
  const legacy = db.prepare('SELECT id FROM profiles WHERE id = 1 AND email IS NULL').get();
  const salt = crypto.randomBytes(16).toString('hex');
  const answerSalt = crypto.randomBytes(16).toString('hex');
  let profileId;
  if (legacy) {
    profileId = legacy.id;
    db.prepare('UPDATE profiles SET email = ?, name = ?, password_salt = ?, password_hash = ?, security_question = ?, security_answer_salt = ?, security_answer_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(email, name, salt, hashPassword(password, salt), securityQuestion, answerSalt, hashPassword(securityAnswer, answerSalt), profileId);
  } else {
    const result = db.prepare('INSERT INTO profiles (email, name, password_salt, password_hash, security_question, security_answer_salt, security_answer_hash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(email, name, salt, hashPassword(password, salt), securityQuestion, answerSalt, hashPassword(securityAnswer, answerSalt));
    profileId = Number(result.lastInsertRowid);
  }
  db.prepare('INSERT OR IGNORE INTO settings (profile_id, data_json) VALUES (?, ?)').run(profileId, JSON.stringify(DEFAULT_SETTINGS));
  createSession(profileId, res, remember);
  res.status(201).json({ profile: { id: profileId, email, name } });
});

app.post('/api/auth/login', (req, res) => {
  const identifier = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const remember = req.body?.remember === true;
  const profile = /^\d+$/.test(identifier)
    ? db.prepare('SELECT id, email, name, password_salt, password_hash FROM profiles WHERE id = ?').get(Number(identifier))
    : db.prepare('SELECT id, email, name, password_salt, password_hash FROM profiles WHERE email = ?').get(identifier.toLowerCase());
  if (!profile?.password_hash || !profile.password_salt || !crypto.timingSafeEqual(Buffer.from(hashPassword(password, profile.password_salt), 'hex'), Buffer.from(profile.password_hash, 'hex'))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  createSession(profile.id, res, remember);
  res.json({ profile: { id: profile.id, email: profile.email, name: profile.name } });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ ok: true });
});

app.post('/api/auth/recovery/question', (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  const profile = /^\d+$/.test(identifier)
    ? db.prepare('SELECT security_question FROM profiles WHERE id = ?').get(Number(identifier))
    : db.prepare('SELECT security_question FROM profiles WHERE email = ?').get(identifier.toLowerCase());
  if (!profile?.security_question) return res.status(404).json({ error: 'No recovery question is set for this account.' });
  res.json({ securityQuestion: profile.security_question });
});

app.post('/api/auth/recovery/verify', (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  const profile = /^\d+$/.test(identifier)
    ? db.prepare('SELECT id, security_answer_salt, security_answer_hash FROM profiles WHERE id = ?').get(Number(identifier))
    : db.prepare('SELECT id, security_answer_salt, security_answer_hash FROM profiles WHERE email = ?').get(identifier.toLowerCase());
  const answer = normalizeSecurityAnswer(req.body?.answer);
  if (!profile?.security_answer_hash || !answer) return res.status(401).json({ error: 'The security answer is incorrect.' });
  const submittedHash = Buffer.from(hashPassword(answer, profile.security_answer_salt), 'hex');
  const storedHash = Buffer.from(profile.security_answer_hash, 'hex');
  if (!crypto.timingSafeEqual(submittedHash, storedHash)) return res.status(401).json({ error: 'The security answer is incorrect.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RECOVERY_MINUTES * 60 * 1000).toISOString();
  db.prepare('DELETE FROM password_recovery_tokens WHERE expires_at <= ?').run(new Date().toISOString());
  db.prepare('INSERT INTO password_recovery_tokens (token_hash, profile_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), profile.id, expiresAt);
  res.cookie(RECOVERY_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: RECOVERY_MINUTES * 60 * 1000, path: '/' });
  res.json({ ok: true });
});

app.post('/api/auth/recovery/reset', (req, res) => {
  const token = readCookie(req, RECOVERY_COOKIE);
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  const recovery = token && db.prepare('SELECT profile_id FROM password_recovery_tokens WHERE token_hash = ? AND expires_at > ?').get(tokenHash(token), new Date().toISOString());
  if (!recovery) return res.status(401).json({ error: 'The recovery request expired. Start again.' });
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE profiles SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(salt, hashPassword(newPassword, salt), recovery.profile_id);
  db.prepare('DELETE FROM sessions WHERE profile_id = ?').run(recovery.profile_id);
  db.prepare('DELETE FROM password_recovery_tokens WHERE profile_id = ?').run(recovery.profile_id);
  res.clearCookie(RECOVERY_COOKIE, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ ok: true });
});

app.put('/api/profile', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  db.prepare('UPDATE profiles SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, req.profile.id);
  res.json({ profile: { id: req.profile.id, email: req.profile.email, name } });
});

app.post('/api/auth/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  const profile = db.prepare('SELECT password_salt, password_hash FROM profiles WHERE id = ?').get(req.profile.id);
  const submittedHash = Buffer.from(hashPassword(currentPassword, profile.password_salt), 'hex');
  const storedHash = Buffer.from(profile.password_hash, 'hex');
  if (!crypto.timingSafeEqual(submittedHash, storedHash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE profiles SET password_salt = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(salt, hashPassword(newPassword, salt), req.profile.id);
  res.json({ ok: true });
});

app.put('/api/auth/security-question', requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const securityQuestion = String(req.body?.securityQuestion || '').trim().slice(0, 200);
  const securityAnswer = normalizeSecurityAnswer(req.body?.securityAnswer);
  if (!securityQuestion || securityQuestion.length > 200 || !securityAnswer || securityAnswer.length > 200) return res.status(400).json({ error: 'Enter both a security question and answer.' });
  const profile = db.prepare('SELECT password_salt, password_hash FROM profiles WHERE id = ?').get(req.profile.id);
  const submittedHash = Buffer.from(hashPassword(currentPassword, profile.password_salt), 'hex');
  const storedHash = Buffer.from(profile.password_hash, 'hex');
  if (!crypto.timingSafeEqual(submittedHash, storedHash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  const answerSalt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE profiles SET security_question = ?, security_answer_salt = ?, security_answer_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(securityQuestion, answerSalt, hashPassword(securityAnswer, answerSalt), req.profile.id);
  res.json({ ok: true });
});

app.get('/api/intelligence', requireAuth, (req, res) => {
  const profileId = req.profile.id;
  const events = getUnifiedActivity(profileId, 1000);
  const customActivities = db.prepare(`SELECT id, frequency_per_week AS frequencyPerWeek, status FROM custom_activities
    WHERE profile_id = ? AND deleted_at IS NULL`).all(profileId);
  const projects = db.prepare(`SELECT id, name, status FROM projects WHERE profile_id = ? AND deleted_at IS NULL`).all(profileId);
  const goals = db.prepare(`SELECT id, name, target_value AS targetValue, current_value AS currentValue, deadline, priority, status
    FROM goals WHERE profile_id = ? AND deleted_at IS NULL`).all(profileId);
  const requestedToday = String(req.query.today || '');
  const today = validateDate(requestedToday) ? requestedToday : new Date().toISOString().slice(0, 10);
  const analysis = analyzeConsistency({ events, activities: customActivities, projects, goals, today });
  res.json({ ...analysis, activityHistory: events.slice(0, 100) });
});

app.get('/api/state', requireAuth, (req, res) => {
  const profileId = req.profile.id;
  const settingsRow = db.prepare('SELECT data_json FROM settings WHERE profile_id = ?').get(profileId);
  const connections = db.prepare('SELECT * FROM platform_connections WHERE profile_id = ? ORDER BY id').all(profileId).map(connection => ({
    ...connection,
    stats: parseJson(connection.stats_json, {})
  }));
  const manualActivities = db.prepare('SELECT platform_id, activity_date AS date, amount, note FROM manual_activities WHERE profile_id = ? ORDER BY activity_date DESC').all(profileId);
  const catalogItems = db.prepare('SELECT id, item_type AS itemType, name, description, category, platform_app AS platformApp, username, url, status FROM catalog_items WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id').all(profileId);
  const customActivities = db.prepare(`SELECT id, name, description, category, unit, frequency_per_week AS frequencyPerWeek,
    target_per_session AS targetPerSession, status FROM custom_activities WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id`).all(profileId);
  const projects = db.prepare(`SELECT id, name, description, deadline, priority, status FROM projects
    WHERE profile_id = ? AND deleted_at IS NULL ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, deadline`).all(profileId);
  const projectTasks = db.prepare(`SELECT id, project_id AS projectId, title, description, deadline, status, completed_at AS completedAt
    FROM project_tasks WHERE profile_id = ? AND deleted_at IS NULL ORDER BY id`).all(profileId);
  projects.forEach(project => { project.tasks = projectTasks.filter(task => task.projectId === project.id); });
  const goals = db.prepare(`SELECT id, name, description, target_value AS targetValue, current_value AS currentValue, unit, deadline, priority, status
    FROM goals WHERE profile_id = ? AND deleted_at IS NULL ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, deadline`).all(profileId);
  res.json({
    profile: { id: req.profile.id, email: req.profile.email, name: req.profile.name },
    connections,
    catalogItems,
    customActivities,
    projects,
    goals,
    activityHistory: getUnifiedActivity(profileId, 200),
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

app.post('/api/custom-activities', requireAuth, (req, res) => {
  const normalized = normalizeCustomActivity(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const { name, description, category, unit, frequencyPerWeek, targetPerSession, status } = normalized.value;
  const result = db.prepare(`INSERT INTO custom_activities (profile_id, name, description, category, unit, frequency_per_week, target_per_session, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.profile.id, name, description, category, unit, frequencyPerWeek, targetPerSession, status);
  const activity = db.prepare(`SELECT id, name, description, category, unit, frequency_per_week AS frequencyPerWeek,
    target_per_session AS targetPerSession, status FROM custom_activities WHERE id = ? AND profile_id = ?`).get(result.lastInsertRowid, req.profile.id);
  res.status(201).json({ activity });
});

app.put('/api/custom-activities/:id', requireAuth, (req, res) => {
  const activityId = Number(req.params.id);
  if (!Number.isSafeInteger(activityId) || activityId < 1) return res.status(400).json({ error: 'Invalid activity.' });
  const normalized = normalizeCustomActivity(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const existing = db.prepare('SELECT id FROM custom_activities WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').get(activityId, req.profile.id);
  if (!existing) return res.status(404).json({ error: 'Activity not found.' });
  const { name, description, category, unit, frequencyPerWeek, targetPerSession, status } = normalized.value;
  db.prepare(`UPDATE custom_activities SET name = ?, description = ?, category = ?, unit = ?, frequency_per_week = ?, target_per_session = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND profile_id = ?`).run(name, description, category, unit, frequencyPerWeek, targetPerSession, status, activityId, req.profile.id);
  const activity = db.prepare(`SELECT id, name, description, category, unit, frequency_per_week AS frequencyPerWeek,
    target_per_session AS targetPerSession, status FROM custom_activities WHERE id = ? AND profile_id = ?`).get(activityId, req.profile.id);
  res.json({ activity });
});

app.delete('/api/custom-activities/:id', requireAuth, (req, res) => {
  const activityId = Number(req.params.id);
  if (!Number.isSafeInteger(activityId) || activityId < 1) return res.status(400).json({ error: 'Invalid activity.' });
  const result = db.prepare(`UPDATE custom_activities SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`).run(activityId, req.profile.id);
  if (!result.changes) return res.status(404).json({ error: 'Activity not found.' });
  res.json({ ok: true });
});

app.post('/api/custom-activities/:id/logs', requireAuth, (req, res) => {
  const activityId = Number(req.params.id);
  const activity = db.prepare(`SELECT id FROM custom_activities WHERE id = ? AND profile_id = ? AND status = 'active' AND deleted_at IS NULL`).get(activityId, req.profile.id);
  if (!activity) return res.status(404).json({ error: 'Active activity not found.' });
  const date = String(req.body?.date || '');
  const amount = Number(req.body?.amount ?? 1);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!validateDate(date)) return res.status(400).json({ error: 'Choose a valid activity date.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  const completed = req.body?.completed === false ? 0 : 1;
  const result = db.prepare(`INSERT INTO custom_activity_logs (profile_id, activity_id, activity_date, amount, completed, note)
    VALUES (?, ?, ?, ?, ?, ?)`).run(req.profile.id, activityId, date, amount, completed, note);
  res.status(201).json({ log: { id: Number(result.lastInsertRowid), activityId, date, amount, completed: Boolean(completed), note } });
});

app.delete('/api/custom-activity-logs/:id', requireAuth, (req, res) => {
  const logId = Number(req.params.id);
  if (!Number.isSafeInteger(logId) || logId < 1) return res.status(400).json({ error: 'Invalid activity log.' });
  const result = db.prepare('DELETE FROM custom_activity_logs WHERE id = ? AND profile_id = ?').run(logId, req.profile.id);
  if (!result.changes) return res.status(404).json({ error: 'Activity log not found.' });
  res.json({ ok: true });
});

app.post('/api/projects', requireAuth, (req, res) => {
  const normalized = normalizeProject(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const { name, description, deadline, priority, status } = normalized.value;
  const result = db.prepare('INSERT INTO projects (profile_id, name, description, deadline, priority, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.profile.id, name, description, deadline, priority, status);
  const project = db.prepare('SELECT id, name, description, deadline, priority, status FROM projects WHERE id = ? AND profile_id = ?').get(result.lastInsertRowid, req.profile.id);
  res.status(201).json({ project: { ...project, tasks: [] } });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isSafeInteger(projectId) || projectId < 1) return res.status(400).json({ error: 'Invalid project.' });
  const normalized = normalizeProject(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const existing = db.prepare('SELECT id FROM projects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').get(projectId, req.profile.id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });
  const { name, description, deadline, priority, status } = normalized.value;
  db.prepare('UPDATE projects SET name = ?, description = ?, deadline = ?, priority = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND profile_id = ?')
    .run(name, description, deadline, priority, status, projectId, req.profile.id);
  const project = db.prepare('SELECT id, name, description, deadline, priority, status FROM projects WHERE id = ? AND profile_id = ?').get(projectId, req.profile.id);
  res.json({ project });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isSafeInteger(projectId) || projectId < 1) return res.status(400).json({ error: 'Invalid project.' });
  const result = db.prepare('UPDATE projects SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').run(projectId, req.profile.id);
  if (!result.changes) return res.status(404).json({ error: 'Project not found.' });
  res.json({ ok: true });
});

app.post('/api/projects/:id/tasks', requireAuth, (req, res) => {
  const projectId = Number(req.params.id);
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').get(projectId, req.profile.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const deadline = optionalDate(req.body?.deadline);
  if (!title || title.length > 160) return res.status(400).json({ error: 'Enter a task title up to 160 characters.' });
  if (description.length > 1000) return res.status(400).json({ error: 'Task description must be 1000 characters or less.' });
  if (deadline.error) return res.status(400).json({ error: deadline.error });
  const result = db.prepare(`INSERT INTO project_tasks (profile_id, project_id, title, description, deadline)
    VALUES (?, ?, ?, ?, ?)`).run(req.profile.id, projectId, title, description, deadline.value);
  const task = db.prepare('SELECT id, project_id AS projectId, title, description, deadline, status, completed_at AS completedAt FROM project_tasks WHERE id = ? AND profile_id = ?').get(result.lastInsertRowid, req.profile.id);
  res.status(201).json({ task });
});

app.put('/api/projects/:projectId/tasks/:taskId', requireAuth, (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);
  const task = db.prepare(`SELECT tasks.id, tasks.status, tasks.completed_at, projects.name AS project_name
    FROM project_tasks tasks JOIN projects ON projects.id = tasks.project_id
    WHERE tasks.id = ? AND tasks.project_id = ? AND tasks.profile_id = ? AND projects.profile_id = ? AND tasks.deleted_at IS NULL`).get(taskId, projectId, req.profile.id, req.profile.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const status = req.body?.status === 'completed' ? 'completed' : 'pending';
  const deadline = optionalDate(req.body?.deadline);
  if (!title || title.length > 160) return res.status(400).json({ error: 'Enter a task title up to 160 characters.' });
  if (description.length > 1000) return res.status(400).json({ error: 'Task description must be 1000 characters or less.' });
  if (deadline.error) return res.status(400).json({ error: deadline.error });
  const completedAt = status === 'completed' ? task.completed_at || new Date().toISOString() : null;
  const saveTask = db.transaction(() => {
    db.prepare(`UPDATE project_tasks SET title = ?, description = ?, deadline = ?, status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND profile_id = ?`).run(title, description, deadline.value, status, completedAt, taskId, projectId, req.profile.id);
    if (status !== task.status) {
      db.prepare(`INSERT INTO project_task_events (profile_id, project_id, task_id, event_type, project_name, task_title)
        VALUES (?, ?, ?, ?, ?, ?)`).run(req.profile.id, projectId, taskId, status === 'completed' ? 'completed' : 'reopened', task.project_name, title);
    }
  });
  saveTask();
  res.json({ task: { id: taskId, projectId, title, description, deadline: deadline.value, status, completedAt } });
});

app.delete('/api/projects/:projectId/tasks/:taskId', requireAuth, (req, res) => {
  const result = db.prepare(`UPDATE project_tasks SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND project_id = ? AND profile_id = ? AND deleted_at IS NULL`).run(Number(req.params.taskId), Number(req.params.projectId), req.profile.id);
  if (!result.changes) return res.status(404).json({ error: 'Task not found.' });
  res.json({ ok: true });
});

app.post('/api/goals', requireAuth, (req, res) => {
  const normalized = normalizeGoal(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const { name, description, targetValue, unit, deadline, priority, status } = normalized.value;
  const result = db.prepare(`INSERT INTO goals (profile_id, name, description, target_value, unit, deadline, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.profile.id, name, description, targetValue, unit, deadline, priority, status);
  const goal = db.prepare(`SELECT id, name, description, target_value AS targetValue, current_value AS currentValue, unit, deadline, priority, status
    FROM goals WHERE id = ? AND profile_id = ?`).get(result.lastInsertRowid, req.profile.id);
  res.status(201).json({ goal });
});

app.put('/api/goals/:id', requireAuth, (req, res) => {
  const goalId = Number(req.params.id);
  if (!Number.isSafeInteger(goalId) || goalId < 1) return res.status(400).json({ error: 'Invalid goal.' });
  const normalized = normalizeGoal(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const existing = db.prepare('SELECT id, current_value AS currentValue FROM goals WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').get(goalId, req.profile.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found.' });
  const { name, description, targetValue, unit, deadline, priority } = normalized.value;
  const status = existing.currentValue >= targetValue ? 'completed' : normalized.value.status;
  db.prepare(`UPDATE goals SET name = ?, description = ?, target_value = ?, unit = ?, deadline = ?, priority = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND profile_id = ?`).run(name, description, targetValue, unit, deadline, priority, status, goalId, req.profile.id);
  const goal = db.prepare(`SELECT id, name, description, target_value AS targetValue, current_value AS currentValue, unit, deadline, priority, status
    FROM goals WHERE id = ? AND profile_id = ?`).get(goalId, req.profile.id);
  res.json({ goal });
});

app.delete('/api/goals/:id', requireAuth, (req, res) => {
  const goalId = Number(req.params.id);
  if (!Number.isSafeInteger(goalId) || goalId < 1) return res.status(400).json({ error: 'Invalid goal.' });
  const result = db.prepare('UPDATE goals SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').run(goalId, req.profile.id);
  if (!result.changes) return res.status(404).json({ error: 'Goal not found.' });
  res.json({ ok: true });
});

app.post('/api/goals/:id/progress', requireAuth, (req, res) => {
  const goalId = Number(req.params.id);
  const goal = db.prepare(`SELECT id, target_value AS targetValue, current_value AS currentValue, status
    FROM goals WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`).get(goalId, req.profile.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found.' });
  if (goal.status !== 'active') return res.status(409).json({ error: 'Resume this goal before recording progress.' });
  const amount = Number(req.body?.amount);
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) return res.status(400).json({ error: 'Enter a progress amount greater than zero.' });
  if (!validateDate(date)) return res.status(400).json({ error: 'Choose a valid progress date.' });
  const currentValue = Math.min(goal.targetValue, goal.currentValue + amount);
  const status = currentValue >= goal.targetValue ? 'completed' : 'active';
  const saveProgress = db.transaction(() => {
    const result = db.prepare('INSERT INTO goal_progress_logs (profile_id, goal_id, amount, progress_date, note) VALUES (?, ?, ?, ?, ?)')
      .run(req.profile.id, goalId, amount, date, note);
    db.prepare('UPDATE goals SET current_value = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND profile_id = ?')
      .run(currentValue, status, goalId, req.profile.id);
    return Number(result.lastInsertRowid);
  });
  const logId = saveProgress();
  res.status(201).json({ goal: { ...goal, currentValue, status }, progress: { id: logId, amount, date, note } });
});

app.post('/api/catalog-items', requireAuth, (req, res) => {
  const normalized = normalizeCatalogItem(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const { itemType, name, description, category, platformApp, username, url, status } = normalized.value;
  const result = db.prepare(`INSERT INTO catalog_items (profile_id, item_type, name, description, category, platform_app, username, url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.profile.id, itemType, name, description, category, platformApp, username, url, status);
  const item = db.prepare('SELECT id, item_type AS itemType, name, description, category, platform_app AS platformApp, username, url, status FROM catalog_items WHERE id = ? AND profile_id = ?').get(result.lastInsertRowid, req.profile.id);
  res.status(201).json({ item });
});

app.put('/api/catalog-items/:id', requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isSafeInteger(itemId) || itemId < 1) return res.status(400).json({ error: 'Invalid catalog item.' });
  const normalized = normalizeCatalogItem(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const existing = db.prepare('SELECT id FROM catalog_items WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').get(itemId, req.profile.id);
  if (!existing) return res.status(404).json({ error: 'Catalog item not found.' });
  const { itemType, name, description, category, platformApp, username, url, status } = normalized.value;
  db.prepare(`UPDATE catalog_items SET item_type = ?, name = ?, description = ?, category = ?, platform_app = ?, username = ?, url = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND profile_id = ?`).run(itemType, name, description, category, platformApp, username, url, status, itemId, req.profile.id);
  const item = db.prepare('SELECT id, item_type AS itemType, name, description, category, platform_app AS platformApp, username, url, status FROM catalog_items WHERE id = ? AND profile_id = ?').get(itemId, req.profile.id);
  res.json({ item });
});

app.delete('/api/catalog-items/:id', requireAuth, (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isSafeInteger(itemId) || itemId < 1) return res.status(400).json({ error: 'Invalid catalog item.' });
  const result = db.prepare('UPDATE catalog_items SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND profile_id = ? AND deleted_at IS NULL').run(itemId, req.profile.id);
  if (!result.changes) return res.status(404).json({ error: 'Catalog item not found.' });
  res.json({ ok: true });
});

app.post('/api/manual-activities', requireAuth, (req, res) => {
  const { platformId } = req.body || {};
  const date = String(req.body?.date || '');
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!canLogManually(req.profile.id, platformId)) return res.status(400).json({ error: 'This platform is not available for manual entry.' });
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
  if ((!MANUAL_PLATFORMS.has(req.params.platformId) && !customCatalogItem(req.profile.id, req.params.platformId, false)) || !validateDate(req.params.date)) return res.status(400).json({ error: 'Invalid activity entry.' });
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