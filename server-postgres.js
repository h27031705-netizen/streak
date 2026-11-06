'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const express = require('express');
const { Pool, types } = require('pg');
const { analyzeConsistency } = require('./lib/consistency');

types.setTypeParser(20, value => Number(value));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const port = Number(process.env.PORT || 3002);

app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (!process.env.PRODUCTION_DATABASE_URL) {
  throw new Error('PRODUCTION_DATABASE_URL is missing.');
}


const db = new Pool({
  connectionString: process.env.PRODUCTION_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000
});
db.options.onConnect = async client => {
  await client.query('SET search_path TO streakforce_test');
};
const SESSION_DAYS = 30;
const SESSION_COOKIE = 'streakforce_session';
const RECOVERY_COOKIE = 'streakforce_recovery';
const RECOVERY_MINUTES = 10;




const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function normalizeSecurityAnswer(answer) {
  return String(answer || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCookie(req, name) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(part => {
      const separator = part.indexOf('=');
      if (separator < 0) return ['', ''];

      return [
        part.slice(0, separator).trim(),
        decodeURIComponent(part.slice(separator + 1).trim())
      ];
    })
  );

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
    ...(remember
      ? { maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 }
      : {}),
    path: '/'
  });
}

async function createSession(profileId, res, remember = false) {
  const token = crypto.randomBytes(32).toString('base64url');

  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await db.query(
    `INSERT INTO sessions (token_hash, profile_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash(token), profileId, expiresAt]
  );

  setSessionCookie(res, token, remember);
}

async function currentProfile(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const result = await db.query(
    `SELECT profiles.id, profiles.email, profiles.name
     FROM sessions
     JOIN profiles ON profiles.id = sessions.profile_id
     WHERE sessions.token_hash = $1
       AND sessions.expires_at > $2`,
    [tokenHash(token), new Date().toISOString()]
  );

  return result.rows[0] || null;
}

const requireAuth = asyncHandler(async (req, res, next) => {
  const profile = await currentProfile(req);

  if (!profile) {
    return res.status(401).json({
      error: 'Please sign in to continue.'
    });
  }

  req.profile = profile;
  next();
});

function validateDate(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const timestamp = Date.parse(`${value}T00:00:00Z`);

  return !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value;
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
  const username = itemType === 'platform'
    ? String(body.username || '').trim()
    : '';

  const rawUrl = String(body.url || '').trim() ||
    (itemType === 'platform' ? generatedProfileUrl(name, username) : '');

  const status = body.status === 'inactive' ? 'inactive' : 'active';

  if (!CATALOG_ITEM_TYPES.has(itemType)) {
    return { error: 'Choose a supported item type.' };
  }

  if (!name || name.length > 80) {
    return { error: 'Enter a name up to 80 characters.' };
  }

  if (itemType === 'platform' && !username) {
    return { error: 'Enter the platform username or profile ID.' };
  }

  if (username.length > 180) {
    return { error: 'Enter a username or profile ID up to 180 characters.' };
  }

  if (description.length > 1000 ||
      category.length > 80 ||
      platformApp.length > 180) {
    return { error: 'Description, category, or linked app is too long.' };
  }

  let url = null;

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);

      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }

      url = parsed.toString();
    } catch {
      return { error: 'Enter a valid http or https URL.' };
    }
  }

  return {
    value: {
      itemType, name, description, category,
      platformApp, username, url, status
    }
  };
}

function optionalDate(value) {
  const date = String(value || '').trim();

  return !date || validateDate(date)
    ? { value: date || null }
    : { error: 'Choose a valid date.' };
}

function normalizeCustomActivity(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'other').trim().slice(0, 60);
  const unit = String(body.unit || 'sessions').trim().slice(0, 30);
  const frequencyPerWeek = Number(body.frequencyPerWeek ?? 1);
  const targetPerSession = Number(body.targetPerSession ?? 1);
  const status = body.status === 'inactive' ? 'inactive' : 'active';

  if (!name || name.length > 80) {
    return { error: 'Enter an activity name up to 80 characters.' };
  }

  if (description.length > 1000) {
    return { error: 'Description must be 1000 characters or less.' };
  }

  if (!Number.isFinite(frequencyPerWeek) ||
      frequencyPerWeek < 1 || frequencyPerWeek > 14) {
    return { error: 'Frequency must be between 1 and 14 sessions per week.' };
  }

  if (!Number.isFinite(targetPerSession) ||
      targetPerSession <= 0 || targetPerSession > 100000) {
    return { error: 'Enter a valid per-session target.' };
  }

  return {
    value: {
      name, description, category, unit,
      frequencyPerWeek, targetPerSession, status
    }
  };
}

function normalizeProject(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const priority = ['low', 'medium', 'high'].includes(body.priority)
    ? body.priority : 'medium';
  const status = ['active', 'completed', 'paused'].includes(body.status)
    ? body.status : 'active';
  const deadline = optionalDate(body.deadline);

  if (!name || name.length > 100) {
    return { error: 'Enter a project name up to 100 characters.' };
  }

  if (description.length > 2000) {
    return { error: 'Description must be 2000 characters or less.' };
  }

  if (deadline.error) return deadline;

  return {
    value: { name, description, priority, status, deadline: deadline.value }
  };
}

function normalizeGoal(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const unit = String(body.unit || 'items').trim().slice(0, 30);
  const targetValue = Number(body.targetValue);
  const priority = ['low', 'medium', 'high'].includes(body.priority)
    ? body.priority : 'medium';
  const status = ['active', 'completed', 'paused'].includes(body.status)
    ? body.status : 'active';
  const deadline = optionalDate(body.deadline);

  if (!name || name.length > 100) {
    return { error: 'Enter a goal name up to 100 characters.' };
  }

  if (description.length > 2000) {
    return { error: 'Description must be 2000 characters or less.' };
  }

  if (!Number.isFinite(targetValue) ||
      targetValue <= 0 || targetValue > 10000000) {
    return { error: 'Enter a target greater than zero.' };
  }

  if (deadline.error) return deadline;

  return {
    value: {
      name, description, targetValue, unit,
      priority, status, deadline: deadline.value
    }
  };
}

async function customCatalogItem(profileId, platformId, activeOnly = true) {
  const match = /^custom-(\d+)$/.exec(String(platformId));
  if (!match) return null;

  const statusClause = activeOnly ? " AND status = 'active'" : '';

  const result = await db.query(
    `SELECT id FROM catalog_items
     WHERE id = $1 AND profile_id = $2
       AND deleted_at IS NULL${statusClause}`,
    [Number(match[1]), profileId]
  );

  return result.rows[0] || null;
}

async function canLogManually(profileId, platformId) {
  return MANUAL_PLATFORMS.has(platformId) ||
    Boolean(await customCatalogItem(profileId, platformId));
}

async function getActivities(profileId, platformId) {
  const result = platformId
    ? await db.query(
        `SELECT * FROM activities
         WHERE profile_id = $1 AND platform_id = $2
         ORDER BY activity_date DESC, id DESC`,
        [profileId, platformId]
      )
    : await db.query(
        `SELECT * FROM activities
         WHERE profile_id = $1
         ORDER BY activity_date DESC, id DESC`,
        [profileId]
      );

  return result.rows.map(row => ({
    ...row,
    topics: parseJson(row.topics_json, []),
    raw: parseJson(row.raw_json, null)
  }));
}

async function toActivityLog(profileId, platformId) {
  const grouped = new Map();
  const activities = await getActivities(profileId, platformId);

  activities.forEach(row => {
    const current = grouped.get(row.activity_date) || {
      date: row.activity_date,
      problemsSolved: 0,
      topics: [],
      contestsJoined: 0,
      problems: [],
      submissions: 0
    };

    if (row.problem_name) {
      current.problems.push({
        name: row.problem_name,
        url: row.problem_url,
        difficulty: row.difficulty,
        topics: row.topics
      });
      current.problemsSolved += 1;
    }

    current.submissions += row.submissions || 0;
    current.contestsJoined += row.contests || 0;
    current.topics = [...new Set(current.topics.concat(row.topics))];

    grouped.set(row.activity_date, current);
  });

  return [...grouped.values()];
}

const CODING_PLATFORMS = new Set([
  'leetcode', 'codechef', 'codeforces', 'atcoder'
]);

const MANUAL_PLATFORMS = new Set([
  'codechef', 'speakits', 'duolingo', 'dsa-ideas'
]);

const CATALOG_ITEM_TYPES = new Set([
  'client', 'app', 'platform', 'service', 'project', 'integration'
]);

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

function setSessionCookie(res, token, remember = false) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    ...(remember
      ? { maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 }
      : {}),
    path: '/'
  });
}

async function createSession(profileId, res, remember = false) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  await db.query(
    `INSERT INTO sessions (token_hash, profile_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash(token), profileId, expiresAt]
  );

  setSessionCookie(res, token, remember);
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
  const username = itemType === 'platform'
    ? String(body.username || '').trim()
    : '';

  const rawUrl = String(body.url || '').trim() ||
    (itemType === 'platform' ? generatedProfileUrl(name, username) : '');

  const status = body.status === 'inactive' ? 'inactive' : 'active';

  if (!CATALOG_ITEM_TYPES.has(itemType)) {
    return { error: 'Choose a supported item type.' };
  }

  if (!name || name.length > 80) {
    return { error: 'Enter a name up to 80 characters.' };
  }

  if (itemType === 'platform' && !username) {
    return { error: 'Enter the platform username or profile ID.' };
  }

  if (username.length > 180) {
    return { error: 'Enter a username or profile ID up to 180 characters.' };
  }

  if (description.length > 1000 ||
      category.length > 80 ||
      platformApp.length > 180) {
    return { error: 'Description, category, or linked app is too long.' };
  }

  let url = null;

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
      url = parsed.toString();
    } catch {
      return { error: 'Enter a valid http or https URL.' };
    }
  }

  return {
    value: {
      itemType, name, description, category,
      platformApp, username, url, status
    }
  };
}

function optionalDate(value) {
  const date = String(value || '').trim();

  return !date || validateDate(date)
    ? { value: date || null }
    : { error: 'Choose a valid date.' };
}

function normalizeCustomActivity(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || 'other').trim().slice(0, 60);
  const unit = String(body.unit || 'sessions').trim().slice(0, 30);
  const frequencyPerWeek = Number(body.frequencyPerWeek ?? 1);
  const targetPerSession = Number(body.targetPerSession ?? 1);
  const status = body.status === 'inactive' ? 'inactive' : 'active';

  if (!name || name.length > 80) {
    return { error: 'Enter an activity name up to 80 characters.' };
  }

  if (description.length > 1000) {
    return { error: 'Description must be 1000 characters or less.' };
  }

  if (!Number.isFinite(frequencyPerWeek) ||
      frequencyPerWeek < 1 || frequencyPerWeek > 14) {
    return { error: 'Frequency must be between 1 and 14 sessions per week.' };
  }

  if (!Number.isFinite(targetPerSession) ||
      targetPerSession <= 0 || targetPerSession > 100000) {
    return { error: 'Enter a valid per-session target.' };
  }

  return {
    value: {
      name, description, category, unit,
      frequencyPerWeek, targetPerSession, status
    }
  };
}

function normalizeProject(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const priority = ['low', 'medium', 'high'].includes(body.priority)
    ? body.priority : 'medium';
  const status = ['active', 'completed', 'paused'].includes(body.status)
    ? body.status : 'active';
  const deadline = optionalDate(body.deadline);

  if (!name || name.length > 100) {
    return { error: 'Enter a project name up to 100 characters.' };
  }

  if (description.length > 2000) {
    return { error: 'Description must be 2000 characters or less.' };
  }

  if (deadline.error) return deadline;

  return {
    value: { name, description, priority, status, deadline: deadline.value }
  };
}

function normalizeGoal(body = {}) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const unit = String(body.unit || 'items').trim().slice(0, 30);
  const targetValue = Number(body.targetValue);
  const priority = ['low', 'medium', 'high'].includes(body.priority)
    ? body.priority : 'medium';
  const status = ['active', 'completed', 'paused'].includes(body.status)
    ? body.status : 'active';
  const deadline = optionalDate(body.deadline);

  if (!name || name.length > 100) {
    return { error: 'Enter a goal name up to 100 characters.' };
  }

  if (description.length > 2000) {
    return { error: 'Description must be 2000 characters or less.' };
  }

  if (!Number.isFinite(targetValue) ||
      targetValue <= 0 || targetValue > 10000000) {
    return { error: 'Enter a target greater than zero.' };
  }

  if (deadline.error) return deadline;

  return {
    value: {
      name, description, targetValue, unit,
      priority, status, deadline: deadline.value
    }
  };
}

async function customCatalogItem(profileId, platformId, activeOnly = true) {
  const match = /^custom-(\d+)$/.exec(String(platformId));
  if (!match) return null;

  const statusClause = activeOnly
    ? " AND status = 'active'"
    : '';

  const result = await db.query(
    `SELECT id FROM catalog_items
     WHERE id = $1 AND profile_id = $2
     AND deleted_at IS NULL${statusClause}`,
    [Number(match[1]), profileId]
  );

  return result.rows[0] || null;
}

async function canLogManually(profileId, platformId) {
  return MANUAL_PLATFORMS.has(platformId) ||
    Boolean(await customCatalogItem(profileId, platformId));
}

async function getActivities(profileId, platformId) {
  const params = platformId
    ? [profileId, platformId]
    : [profileId];

  const query = platformId
    ? `SELECT * FROM activities
       WHERE profile_id = $1 AND platform_id = $2
       ORDER BY activity_date DESC, id DESC`
    : `SELECT * FROM activities
       WHERE profile_id = $1
       ORDER BY activity_date DESC, id DESC`;

  const result = await db.query(query, params);

  return result.rows.map(row => ({
    ...row,
    topics: parseJson(row.topics_json, []),
    raw: parseJson(row.raw_json, null)
  }));
}

async function toActivityLog(profileId, platformId) {
  const activities = await getActivities(profileId, platformId);
  const grouped = new Map();

  activities.forEach(row => {
    const current = grouped.get(row.activity_date) || {
      date: row.activity_date,
      problemsSolved: 0,
      topics: [],
      contestsJoined: 0,
      problems: [],
      submissions: 0
    };

    if (row.problem_name) {
      current.problems.push({
        name: row.problem_name,
        url: row.problem_url,
        difficulty: row.difficulty,
        topics: row.topics
      });
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
    const response = await fetch(
      `https://www.codechef.com/users/${encodeURIComponent(connection.username)}`,
      {
        headers: {
          Accept: 'text/html',
          'User-Agent': 'StreakForce/1.0 (public profile sync)'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`CodeChef profile returned HTTP ${response.status}`);
    }

    const $ = cheerio.load(await response.text());
    const profileHandle = String($('#user_handle').val() || '').trim();
    const totalLabel = $('h3')
      .filter((_, element) => $(element).text().includes('Total Problems Solved'))
      .first()
      .text();

    const totalMatch = totalLabel.match(/Total Problems Solved:\s*([\d,]+)/);

    if (!profileHandle || !totalMatch) {
      throw new Error('Could not read a public CodeChef solved total. Check the username or try again later.');
    }

    if (profileHandle.toLowerCase() !== connection.username.toLowerCase()) {
      throw new Error('CodeChef returned a different profile than the requested username.');
    }

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
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://leetcode.com/'
      },
      body: JSON.stringify({
        query: `query recentAcSubmissionList($username: String!, $limit: Int!) {
          recentAcSubmissionList(username: $username, limit: $limit) { id title titleSlug timestamp }
          matchedUser(username: $username) { submitStats { acSubmissionNum { difficulty count } } }
        }`,
        variables: {
          username: connection.username,
          limit: 100
        }
      })
    });

    if (!response.ok) {
      throw new Error(`LeetCode returned HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload.errors?.length) {
      throw new Error(payload.errors[0].message || 'LeetCode rejected the request');
    }

    const accepted = payload.data?.recentAcSubmissionList || [];
    const totals = payload.data?.matchedUser?.submitStats?.acSubmissionNum || [];

    return {
      records: accepted.map(item => ({
        externalId: String(item.id),
        date: new Date(Number(item.timestamp) * 1000).toISOString().slice(0, 10),
        problemName: item.title || null,
        problemUrl: item.titleSlug
          ? `https://leetcode.com/problems/${item.titleSlug}/`
          : null,
        topics: [],
        submissions: 1,
        contests: 0,
        raw: item
      })),
      stats: {
        totalSolved: totals.reduce(
          (sum, item) => sum + (item.difficulty === 'All' ? Number(item.count) : 0),
          0
        ),
        source: 'LeetCode public profile',
        scope: 'Lifetime total from the public profile; dated activity is limited to the latest 100 accepted submissions.'
      }
    };
  }

  if (connection.platform_id === 'codeforces') {
    const response = await fetch(
      `https://codeforces.com/api/user.status?handle=${encodeURIComponent(connection.username)}`
    );

    if (!response.ok) {
      throw new Error(`Codeforces returned HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload.status !== 'OK') {
      throw new Error(payload.comment || 'Codeforces rejected the request');
    }

    const solved = new Map();

    [...payload.result]
      .reverse()
      .filter(item => item.verdict === 'OK')
      .forEach(item => {
        const key = `${item.problem?.contestId || item.contestId || 'practice'}-${item.problem?.index || ''}`;
        if (!solved.has(key)) solved.set(key, item);
      });

    const records = [...solved.values()].map(item => ({
      externalId: `accepted-${item.problem?.contestId || item.contestId || 'practice'}-${item.problem?.index || item.id}`,
      date: new Date(item.creationTimeSeconds * 1000).toISOString().slice(0, 10),
      problemName: item.problem?.name || null,
      problemUrl: item.problem?.contestId
        ? `https://codeforces.com/problemset/problem/${item.problem.contestId}/${item.problem.index}`
        : null,
      difficulty: item.problem?.rating ? String(item.problem.rating) : null,
      topics: item.problem?.tags || [],
      submissions: 1,
      contests: item.problem?.contestId ? 1 : 0,
      raw: item
    }));

    return {
      records,
      stats: {
        totalSolved: solved.size,
        source: 'Codeforces accepted submissions',
        scope: 'Distinct accepted problems from the public user-status response.'
      }
    };
  }

  if (connection.platform_id === 'atcoder') {
    const records = [];
    const earliest = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
    let fromSecond = earliest;

    for (let page = 0; page < 20; page++) {
      const url = `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(connection.username)}&from_second=${fromSecond}`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`AtCoder activity service returned HTTP ${response.status}`);
      }

      const submissions = await response.json();

      if (!Array.isArray(submissions)) {
        throw new Error('AtCoder activity service returned an unexpected response.');
      }

      if (!submissions.length) break;

      records.push(
        ...submissions.filter(item => item.result === 1).map(item => ({
          externalId: `accepted-${item.problem_id}`,
          date: new Date(item.epoch_second * 1000).toISOString().slice(0, 10),
          problemName: item.problem_id,
          problemUrl: `https://atcoder.jp/contests/${item.problem_id.split('_')[0]}/tasks/${item.problem_id}`,
          topics: [],
          submissions: 1,
          contests: 0,
          raw: item
        }))
      );

      const latestTimestamp = Math.max(
        ...submissions.map(item => Number(item.epoch_second) || 0)
      );

      if (submissions.length < 500 || latestTimestamp < fromSecond) break;

      fromSecond = latestTimestamp + 1;
    }

    const unique = new Map();

    records
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(record => {
        if (!unique.has(record.externalId)) {
          unique.set(record.externalId, record);
        }
      });

    const normalized = [...unique.values()];

    return {
      records: normalized,
      stats: {
        totalSolved: normalized.length,
        source: 'AtCoder Problems API',
        scope: 'Accepted problems found in the latest year of public submissions'
      }
    };
  }

  throw new Error(
    `Automatic sync is not configured for ${connection.platform_id}. Your saved history is unchanged.`
  );
}

async function getUnifiedActivity(profileId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));

  const [externalResult, manualResult, customResult, taskResult, goalResult] =
    await Promise.all([
      db.query(
        `SELECT id, platform_id, activity_date, problem_name, difficulty, contests, submissions
         FROM activities
         WHERE profile_id = $1
         ORDER BY activity_date DESC, id DESC
         LIMIT $2`,
        [profileId, safeLimit]
      ),

      db.query(
        `SELECT id, platform_id, activity_date, amount, note
         FROM manual_activities
         WHERE profile_id = $1
         ORDER BY activity_date DESC, id DESC
         LIMIT $2`,
        [profileId, safeLimit]
      ),

      db.query(
        `SELECT logs.id, logs.activity_date, logs.amount, logs.completed,
                logs.note, activities.id AS activity_id,
                activities.name, activities.unit
         FROM custom_activity_logs logs
         JOIN custom_activities activities
           ON activities.id = logs.activity_id
         WHERE logs.profile_id = $1
         ORDER BY logs.activity_date DESC, logs.id DESC
         LIMIT $2`,
        [profileId, safeLimit]
      ),

      db.query(
        `SELECT id, project_id, task_id, event_type,
                project_name, task_title, event_at
         FROM project_task_events
         WHERE profile_id = $1
         ORDER BY event_at DESC
         LIMIT $2`,
        [profileId, safeLimit]
      ),

      db.query(
        `SELECT logs.id, logs.goal_id, logs.amount,
                logs.progress_date, logs.note,
                goals.name, goals.unit
         FROM goal_progress_logs logs
         JOIN goals ON goals.id = logs.goal_id
         WHERE logs.profile_id = $1
         ORDER BY logs.progress_date DESC, logs.id DESC
         LIMIT $2`,
        [profileId, safeLimit]
      )
    ]);

  const external = externalResult.rows.map(row => ({
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

  const manual = manualResult.rows.map(row => ({
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

  const custom = customResult.rows.map(row => ({
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

  const taskEvents = taskResult.rows.map(row => ({
    id: `task-event-${row.id}`,
    date: String(row.event_at || '').slice(0, 10),
    type: row.event_type === 'completed'
      ? 'project-task'
      : 'project-task-reopened',
    sourceId: `project-task-${row.task_id}`,
    title: row.task_title,
    amount: 1,
    unit: 'task',
    detail: row.project_name,
    completed: row.event_type === 'completed'
  })).filter(event => event.date);

  const goals = goalResult.rows.map(row => ({
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
    .sort((left, right) =>
      right.date.localeCompare(left.date) ||
      right.id.localeCompare(left.id)
    )
    .slice(0, safeLimit);
}

function passwordMatches(password, salt, storedHash) {
  if (!salt || !storedHash) return false;

  const submitted = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(storedHash, 'hex');

  return submitted.length === stored.length &&
    crypto.timingSafeEqual(submitted, stored);
}

// AUTH SESSION
app.get('/api/auth/session', asyncHandler(async (req, res) => {
  const profile = await currentProfile(req);

  res.json({
    authenticated: Boolean(profile),
    profile: profile
      ? { id: profile.id, email: profile.email, name: profile.name }
      : null
  });
}));

// REGISTER
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 80);
  const password = String(req.body?.password || '');
  const securityQuestion = String(req.body?.securityQuestion || '').trim().slice(0, 200);
  const securityAnswer = normalizeSecurityAnswer(req.body?.securityAnswer);
  const remember = req.body?.remember === true;

  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 10) {
    return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
  }
  if (!securityQuestion || !securityAnswer) {
    return res.status(400).json({ error: 'Add a security question and answer for account recovery.' });
  }

  const existing = await db.query(
    'SELECT id FROM profiles WHERE email = $1',
    [email]
  );

  if (existing.rows.length) {
    return res.status(409).json({
      error: 'An account with this email already exists. Sign in instead.'
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const answerSalt = crypto.randomBytes(16).toString('hex');

  const legacy = await db.query(
    'SELECT id FROM profiles WHERE id = 1 AND email IS NULL'
  );

  let profileId;

  if (legacy.rows[0]) {
    profileId = legacy.rows[0].id;

    await db.query(
      `UPDATE profiles
       SET email = $1, name = $2, password_salt = $3,
           password_hash = $4, security_question = $5,
           security_answer_salt = $6, security_answer_hash = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8`,
      [
        email, name, salt, hashPassword(password, salt),
        securityQuestion, answerSalt,
        hashPassword(securityAnswer, answerSalt), profileId
      ]
    );
  } else {
    const result = await db.query(
      `INSERT INTO profiles
       (email, name, password_salt, password_hash,
        security_question, security_answer_salt, security_answer_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        email, name, salt, hashPassword(password, salt),
        securityQuestion, answerSalt,
        hashPassword(securityAnswer, answerSalt)
      ]
    );

    profileId = result.rows[0].id;
  }

  await db.query(
    `INSERT INTO settings (profile_id, data_json)
     VALUES ($1, $2)
     ON CONFLICT (profile_id) DO NOTHING`,
    [profileId, JSON.stringify(DEFAULT_SETTINGS)]
  );

  await createSession(profileId, res, remember);

  res.status(201).json({
    profile: { id: profileId, email, name }
  });
}));

// LOGIN
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const identifier = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const remember = req.body?.remember === true;

  const result = /^\d+$/.test(identifier)
    ? await db.query(
        `SELECT id, email, name, password_salt, password_hash
         FROM profiles WHERE id = $1`,
        [Number(identifier)]
      )
    : await db.query(
        `SELECT id, email, name, password_salt, password_hash
         FROM profiles WHERE email = $1`,
        [identifier.toLowerCase()]
      );

  const profile = result.rows[0];

  if (!profile || !passwordMatches(password, profile.password_salt, profile.password_hash)) {
    return res.status(401).json({
      error: 'Email or password is incorrect.'
    });
  }

  await createSession(profile.id, res, remember);

  res.json({
    profile: {
      id: profile.id,
      email: profile.email,
      name: profile.name
    }
  });
}));

// LOGOUT
app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);

  if (token) {
    await db.query(
      'DELETE FROM sessions WHERE token_hash = $1',
      [tokenHash(token)]
    );
  }

  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });

  res.json({ ok: true });
}));

// RECOVERY QUESTION
app.post('/api/auth/recovery/question', asyncHandler(async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();

  const result = /^\d+$/.test(identifier)
    ? await db.query(
        'SELECT security_question FROM profiles WHERE id = $1',
        [Number(identifier)]
      )
    : await db.query(
        'SELECT security_question FROM profiles WHERE email = $1',
        [identifier.toLowerCase()]
      );

  const profile = result.rows[0];

  if (!profile?.security_question) {
    return res.status(404).json({
      error: 'No recovery question is set for this account.'
    });
  }

  res.json({ securityQuestion: profile.security_question });
}));

// VERIFY RECOVERY ANSWER
app.post('/api/auth/recovery/verify', asyncHandler(async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();

  const result = /^\d+$/.test(identifier)
    ? await db.query(
        `SELECT id, security_answer_salt, security_answer_hash
         FROM profiles WHERE id = $1`,
        [Number(identifier)]
      )
    : await db.query(
        `SELECT id, security_answer_salt, security_answer_hash
         FROM profiles WHERE email = $1`,
        [identifier.toLowerCase()]
      );

  const profile = result.rows[0];
  const answer = normalizeSecurityAnswer(req.body?.answer);

  if (!profile?.security_answer_hash || !answer ||
      !passwordMatches(answer, profile.security_answer_salt, profile.security_answer_hash)) {
    return res.status(401).json({
      error: 'The security answer is incorrect.'
    });
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + RECOVERY_MINUTES * 60 * 1000
  ).toISOString();

  await db.query(
    'DELETE FROM password_recovery_tokens WHERE expires_at <= $1',
    [new Date().toISOString()]
  );

  await db.query(
    `INSERT INTO password_recovery_tokens
     (token_hash, profile_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash(token), profile.id, expiresAt]
  );

  res.cookie(RECOVERY_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: RECOVERY_MINUTES * 60 * 1000,
    path: '/'
  });

  res.json({ ok: true });
}));

// RESET PASSWORD
app.post('/api/auth/recovery/reset', asyncHandler(async (req, res) => {
  const token = readCookie(req, RECOVERY_COOKIE);
  const newPassword = String(req.body?.newPassword || '');

  if (newPassword.length < 10) {
    return res.status(400).json({
      error: 'Use a password with at least 10 characters.'
    });
  }

  const result = token
    ? await db.query(
        `SELECT profile_id FROM password_recovery_tokens
         WHERE token_hash = $1 AND expires_at > $2`,
        [tokenHash(token), new Date().toISOString()]
      )
    : { rows: [] };

  const recovery = result.rows[0];

  if (!recovery) {
    return res.status(401).json({
      error: 'The recovery request expired. Start again.'
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');

  await withTransaction(async client => {
    await client.query(
      `UPDATE profiles
       SET password_salt = $1, password_hash = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [salt, hashPassword(newPassword, salt), recovery.profile_id]
    );

    await client.query(
      'DELETE FROM sessions WHERE profile_id = $1',
      [recovery.profile_id]
    );

    await client.query(
      'DELETE FROM password_recovery_tokens WHERE profile_id = $1',
      [recovery.profile_id]
    );
  });

  res.clearCookie(RECOVERY_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  });

  res.json({ ok: true });
}));

// UPDATE PROFILE
app.put('/api/profile', requireAuth, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);

  if (!name) {
    return res.status(400).json({ error: 'Enter your name.' });
  }

  await db.query(
    `UPDATE profiles
     SET name = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [name, req.profile.id]
  );

  res.json({
    profile: {
      id: req.profile.id,
      email: req.profile.email,
      name
    }
  });
}));

// CHANGE PASSWORD
app.post('/api/auth/password', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');

  if (newPassword.length < 10) {
    return res.status(400).json({
      error: 'Use a password with at least 10 characters.'
    });
  }

  const result = await db.query(
    'SELECT password_salt, password_hash FROM profiles WHERE id = $1',
    [req.profile.id]
  );

  const profile = result.rows[0];

  if (!profile || !passwordMatches(currentPassword, profile.password_salt, profile.password_hash)) {
    return res.status(401).json({
      error: 'Current password is incorrect.'
    });
  }

  const salt = crypto.randomBytes(16).toString('hex');

  await db.query(
    `UPDATE profiles
     SET password_salt = $1, password_hash = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [salt, hashPassword(newPassword, salt), req.profile.id]
  );

  res.json({ ok: true });
}));

// UPDATE SECURITY QUESTION
app.put('/api/auth/security-question', requireAuth, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const securityQuestion = String(req.body?.securityQuestion || '').trim().slice(0, 200);
  const securityAnswer = normalizeSecurityAnswer(req.body?.securityAnswer);

  if (!securityQuestion || !securityAnswer) {
    return res.status(400).json({
      error: 'Enter both a security question and answer.'
    });
  }

  const result = await db.query(
    'SELECT password_salt, password_hash FROM profiles WHERE id = $1',
    [req.profile.id]
  );

  const profile = result.rows[0];

  if (!profile || !passwordMatches(currentPassword, profile.password_salt, profile.password_hash)) {
    return res.status(401).json({
      error: 'Current password is incorrect.'
    });
  }

  const answerSalt = crypto.randomBytes(16).toString('hex');

  await db.query(
    `UPDATE profiles
     SET security_question = $1,
         security_answer_salt = $2,
         security_answer_hash = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [
      securityQuestion,
      answerSalt,
      hashPassword(securityAnswer, answerSalt),
      req.profile.id
    ]
  );

  res.json({ ok: true });
}));


app.get('/api/intelligence', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const events = await getUnifiedActivity(profileId, 1000);

  const [customResult, projectResult, goalResult] = await Promise.all([
    db.query(
      `SELECT id, frequency_per_week AS "frequencyPerWeek", status
       FROM custom_activities
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, status
       FROM projects
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, target_value AS "targetValue",
              current_value AS "currentValue", deadline, priority, status
       FROM goals
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    )
  ]);

  const requestedToday = String(req.query.today || '');
  const today = validateDate(requestedToday)
    ? requestedToday
    : new Date().toISOString().slice(0, 10);

  const analysis = analyzeConsistency({
    events,
    activities: customResult.rows,
    projects: projectResult.rows,
    goals: goalResult.rows,
    today
  });

  res.json({
    ...analysis,
    activityHistory: events.slice(0, 100)
  });
}));

app.get('/api/state', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const [
    settingsResult,
    connectionsResult,
    manualResult,
    catalogResult,
    customResult,
    projectsResult,
    tasksResult,
    goalsResult,
    activityHistory,
    activities
  ] = await Promise.all([
    db.query(
      'SELECT data_json FROM settings WHERE profile_id = $1',
      [profileId]
    ),
    db.query(
      'SELECT * FROM platform_connections WHERE profile_id = $1 ORDER BY id',
      [profileId]
    ),
    db.query(
      `SELECT platform_id, activity_date AS date, amount, note
       FROM manual_activities
       WHERE profile_id = $1
       ORDER BY activity_date DESC`,
      [profileId]
    ),
    db.query(
      `SELECT id, item_type AS "itemType", name, description, category,
              platform_app AS "platformApp", username, url, status
       FROM catalog_items
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, description, category, unit,
              frequency_per_week AS "frequencyPerWeek",
              target_per_session AS "targetPerSession", status
       FROM custom_activities
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, description, deadline, priority, status
       FROM projects
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY CASE priority
         WHEN 'high' THEN 0
         WHEN 'medium' THEN 1
         ELSE 2
       END, deadline NULLS LAST`,
      [profileId]
    ),
    db.query(
      `SELECT id, project_id AS "projectId", title, description,
              deadline, status, completed_at AS "completedAt"
       FROM project_tasks
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, description,
              target_value AS "targetValue",
              current_value AS "currentValue",
              unit, deadline, priority, status
       FROM goals
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY CASE priority
         WHEN 'high' THEN 0
         WHEN 'medium' THEN 1
         ELSE 2
       END, deadline NULLS LAST`,
      [profileId]
    ),
    getUnifiedActivity(profileId, 200),
    getActivities(profileId)
  ]);

  const connections = connectionsResult.rows.map(connection => ({
    ...connection,
    stats: parseJson(connection.stats_json, {})
  }));

  const projects = projectsResult.rows;
  const projectTasks = tasksResult.rows;

  projects.forEach(project => {
    project.tasks = projectTasks.filter(
      task => task.projectId === project.id
    );
  });

  const settingsRow = settingsResult.rows[0];

  res.json({
    profile: {
      id: req.profile.id,
      email: req.profile.email,
      name: req.profile.name
    },
    connections,
    catalogItems: catalogResult.rows,
    customActivities: customResult.rows,
    projects,
    goals: goalsResult.rows,
    activityHistory,
    activities,
    manualActivities: manualResult.rows,
    settings: {
      ...DEFAULT_SETTINGS,
      ...parseJson(settingsRow?.data_json, {})
    }
  });
}));

app.put('/api/settings', requireAuth, asyncHandler(async (req, res) => {
  const next = {
    ...DEFAULT_SETTINGS,
    ...(req.body || {})
  };

  await db.query(
    `INSERT INTO settings (profile_id, data_json)
     VALUES ($1, $2)
     ON CONFLICT (profile_id)
     DO UPDATE SET
       data_json = EXCLUDED.data_json,
       updated_at = CURRENT_TIMESTAMP`,
    [req.profile.id, JSON.stringify(next)]
  );

  res.json(next);
}));

app.post('/api/custom-activities', requireAuth, asyncHandler(async (req, res) => {
  const normalized = normalizeCustomActivity(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const {
    name,
    description,
    category,
    unit,
    frequencyPerWeek,
    targetPerSession,
    status
  } = normalized.value;

  const result = await db.query(
    `INSERT INTO custom_activities
      (profile_id, name, description, category, unit,
       frequency_per_week, target_per_session, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, description, category, unit,
       frequency_per_week AS "frequencyPerWeek",
       target_per_session AS "targetPerSession", status`,
    [
      req.profile.id,
      name,
      description,
      category,
      unit,
      frequencyPerWeek,
      targetPerSession,
      status
    ]
  );

  res.status(201).json({
    activity: result.rows[0]
  });
}));

app.put('/api/custom-activities/:id', requireAuth, asyncHandler(async (req, res) => {
  const activityId = Number(req.params.id);

  if (!Number.isSafeInteger(activityId) || activityId < 1) {
    return res.status(400).json({ error: 'Invalid activity.' });
  }

  const normalized = normalizeCustomActivity(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const {
    name,
    description,
    category,
    unit,
    frequencyPerWeek,
    targetPerSession,
    status
  } = normalized.value;

  const result = await db.query(
    `UPDATE custom_activities
     SET name = $1,
         description = $2,
         category = $3,
         unit = $4,
         frequency_per_week = $5,
         target_per_session = $6,
         status = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $8
       AND profile_id = $9
       AND deleted_at IS NULL
     RETURNING id, name, description, category, unit,
       frequency_per_week AS "frequencyPerWeek",
       target_per_session AS "targetPerSession", status`,
    [
      name,
      description,
      category,
      unit,
      frequencyPerWeek,
      targetPerSession,
      status,
      activityId,
      req.profile.id
    ]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Activity not found.' });
  }

  res.json({
    activity: result.rows[0]
  });
}));

app.delete('/api/custom-activities/:id', requireAuth, asyncHandler(async (req, res) => {
  const activityId = Number(req.params.id);

  if (!Number.isSafeInteger(activityId) || activityId < 1) {
    return res.status(400).json({ error: 'Invalid activity.' });
  }

  const result = await db.query(
    `UPDATE custom_activities
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND profile_id = $2
       AND deleted_at IS NULL`,
    [activityId, req.profile.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Activity not found.' });
  }

  res.json({ ok: true });
}));

app.post('/api/custom-activities/:id/logs', requireAuth, asyncHandler(async (req, res) => {
  const activityId = Number(req.params.id);

  if (!Number.isSafeInteger(activityId) || activityId < 1) {
    return res.status(400).json({ error: 'Invalid activity.' });
  }

  const activityResult = await db.query(
    `SELECT id
     FROM custom_activities
     WHERE id = $1
       AND profile_id = $2
       AND status = 'active'
       AND deleted_at IS NULL`,
    [activityId, req.profile.id]
  );

  if (!activityResult.rowCount) {
    return res.status(404).json({ error: 'Active activity not found.' });
  }

  const date = String(req.body?.date || '');
  const amount = Number(req.body?.amount ?? 1);
  const note = String(req.body?.note || '').trim().slice(0, 1000);

  if (!validateDate(date)) {
    return res.status(400).json({ error: 'Choose a valid activity date.' });
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  }

  const completed = req.body?.completed === false ? 0 : 1;

  const result = await db.query(
    `INSERT INTO custom_activity_logs
      (profile_id, activity_id, activity_date, amount, completed, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [req.profile.id, activityId, date, amount, completed, note]
  );

  res.status(201).json({
    log: {
      id: result.rows[0].id,
      activityId,
      date,
      amount,
      completed: Boolean(completed),
      note
    }
  });
}));

app.delete('/api/custom-activity-logs/:id', requireAuth, asyncHandler(async (req, res) => {
  const logId = Number(req.params.id);

  if (!Number.isSafeInteger(logId) || logId < 1) {
    return res.status(400).json({ error: 'Invalid activity log.' });
  }

  const result = await db.query(
    `DELETE FROM custom_activity_logs
     WHERE id = $1 AND profile_id = $2`,
    [logId, req.profile.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Activity log not found.' });
  }

  res.json({ ok: true });
}));

// ===============================
// PART 5: INTELLIGENCE, STATE & SETTINGS
// ===============================

app.get('/api/intelligence', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const events = await getUnifiedActivity(profileId, 1000);

  const [customActivities, projects, goals] = await Promise.all([
    db.query(
      `SELECT id,
              frequency_per_week AS "frequencyPerWeek",
              status
       FROM custom_activities
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, status
       FROM projects
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    ),
    db.query(
      `SELECT id, name,
              target_value AS "targetValue",
              current_value AS "currentValue",
              deadline, priority, status
       FROM goals
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    )
  ]);

  const requestedToday = String(req.query.today || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requestedToday)
    ? requestedToday
    : new Date().toISOString().slice(0, 10);

  const analysis = analyzeConsistency({
    events,
    activities: customActivities.rows,
    projects: projects.rows,
    goals: goals.rows,
    today
  });

  res.json({
    ...analysis,
    activityHistory: events.slice(0, 100)
  });
}));


// ===============================
// PART 5: APPLICATION STATE
// ===============================

app.get('/api/state', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const [
    connections,
    catalogItems,
    customActivities,
    projects,
    goals,
    activityHistory,
    manualActivities,
    settingsResult
  ] = await Promise.all([
    db.query(
      `SELECT id, platform_id AS "platformId",
              username, stats_json AS "statsJson",
              last_synced_at AS "lastSyncedAt"
       FROM platform_connections
       WHERE profile_id = $1
       ORDER BY id`,
      [profileId]
    ),

    db.query(
      `SELECT *
       FROM catalog_items
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY name`,
      [profileId]
    ),

    db.query(
      `SELECT id, name, description, category, unit,
              frequency_per_week AS "frequencyPerWeek",
              target_per_session AS "targetPerSession",
              status
       FROM custom_activities
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id DESC`,
      [profileId]
    ),

    db.query(
      `SELECT *
       FROM projects
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY priority DESC, id DESC`,
      [profileId]
    ),

    db.query(
      `SELECT id, name, description,
              target_value AS "targetValue",
              current_value AS "currentValue",
              deadline, priority, status
       FROM goals
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id DESC`,
      [profileId]
    ),

    getUnifiedActivity(profileId, 200),

    db.query(
      `SELECT id, platform_id AS "platformId",
              activity_date AS "activityDate",
              amount, note
       FROM manual_activities
       WHERE profile_id = $1
       ORDER BY activity_date DESC, id DESC`,
      [profileId]
    ),

    db.query(
      `SELECT data_json
       FROM settings
       WHERE profile_id = $1`,
      [profileId]
    )
  ]);

  const projectIds = projects.rows.map(project => project.id);

  let projectTasks = [];

  if (projectIds.length > 0) {
    const taskResult = await db.query(
      `SELECT *
       FROM project_tasks
       WHERE project_id = ANY($1::bigint[])
       ORDER BY id`,
      [projectIds]
    );

    projectTasks = taskResult.rows;
  }

  const projectsWithTasks = projects.rows.map(project => ({
    ...project,
    tasks: projectTasks.filter(task => task.project_id === project.id)
  }));

  const parsedConnections = connections.rows.map(connection => ({
    ...connection,
    stats: parseJson(connection.statsJson, {})
  }));

  const savedSettings = settingsResult.rows[0]
    ? parseJson(settingsResult.rows[0].data_json, {})
    : {};

  const settings = {
    ...DEFAULT_SETTINGS,
    ...savedSettings
  };

  res.json({
    profile: req.profile,
    connections: parsedConnections,
    catalogItems: catalogItems.rows,
    customActivities: customActivities.rows,
    projects: projectsWithTasks,
    goals: goals.rows,
    activityHistory,
    activities: activityHistory,
    manualActivities: manualActivities.rows,
    settings
  });
}));


// ===============================
// PART 5: SETTINGS UPDATE
// ===============================

app.put('/api/settings', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const existing = await db.query(
    `SELECT data_json
     FROM settings
     WHERE profile_id = $1`,
    [profileId]
  );

  const currentSettings = existing.rows[0]
    ? parseJson(existing.rows[0].data_json, {})
    : {};

  const updatedSettings = {
    ...DEFAULT_SETTINGS,
    ...currentSettings,
    ...(req.body || {})
  };

  await db.query(
    `INSERT INTO settings (profile_id, data_json, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (profile_id)
     DO UPDATE SET
       data_json = EXCLUDED.data_json,
       updated_at = CURRENT_TIMESTAMP`,
    [profileId, JSON.stringify(updatedSettings)]
  );

  res.json({ settings: updatedSettings });
}));


// ===============================
// PART 5: CUSTOM ACTIVITIES
// ===============================

app.post('/api/custom-activities', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;
  const body = req.body || {};

  const name = String(body.name || '').trim().slice(0, 100);
  const description = String(body.description || '').trim().slice(0, 500);
  const category = String(body.category || 'other').trim().slice(0, 50) || 'other';
  const unit = String(body.unit || 'sessions').trim().slice(0, 30) || 'sessions';
  const frequencyPerWeek = Math.min(14, Math.max(1, Number(body.frequencyPerWeek) || 1));
  const targetPerSession = Number(body.targetPerSession) || 1;

  if (!name) {
    return res.status(400).json({ error: 'Enter an activity name.' });
  }

  if (!Number.isFinite(targetPerSession) || targetPerSession <= 0) {
    return res.status(400).json({ error: 'Enter a valid target per session.' });
  }

  const result = await db.query(
    `INSERT INTO custom_activities
      (profile_id, name, description, category, unit,
       frequency_per_week, target_per_session, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     RETURNING id`,
    [
      profileId,
      name,
      description,
      category,
      unit,
      frequencyPerWeek,
      targetPerSession
    ]
  );

  const activity = await customCatalogItem(result.rows[0].id, profileId);

  res.status(201).json({ activity });
}));


app.put('/api/custom-activities/:id', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;
  const activityId = Number(req.params.id);
  const body = req.body || {};

  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ error: 'Invalid activity ID.' });
  }

  const existing = await customCatalogItem(activityId, profileId);

  if (!existing) {
    return res.status(404).json({ error: 'Activity not found.' });
  }

  const name = String(body.name ?? existing.name).trim().slice(0, 100);
  const description = String(body.description ?? existing.description ?? '').trim().slice(0, 500);
  const category = String(body.category ?? existing.category ?? 'other').trim().slice(0, 50) || 'other';
  const unit = String(body.unit ?? existing.unit ?? 'sessions').trim().slice(0, 30) || 'sessions';
  const frequencyPerWeek = Math.min(
    14,
    Math.max(1, Number(body.frequencyPerWeek ?? existing.frequencyPerWeek) || 1)
  );
  const targetPerSession = Number(body.targetPerSession ?? existing.targetPerSession);
  const status = String(body.status ?? existing.status ?? 'active');

  if (!name) {
    return res.status(400).json({ error: 'Enter an activity name.' });
  }

  if (!Number.isFinite(targetPerSession) || targetPerSession <= 0) {
    return res.status(400).json({ error: 'Enter a valid target per session.' });
  }

  await db.query(
    `UPDATE custom_activities
     SET name = $1,
         description = $2,
         category = $3,
         unit = $4,
         frequency_per_week = $5,
         target_per_session = $6,
         status = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $8 AND profile_id = $9 AND deleted_at IS NULL`,
    [
      name,
      description,
      category,
      unit,
      frequencyPerWeek,
      targetPerSession,
      status,
      activityId,
      profileId
    ]
  );

  const activity = await customCatalogItem(activityId, profileId);

  res.json({ activity });
}));


app.delete('/api/custom-activities/:id', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;
  const activityId = Number(req.params.id);

  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ error: 'Invalid activity ID.' });
  }

  const result = await db.query(
    `UPDATE custom_activities
     SET deleted_at = CURRENT_TIMESTAMP,
         status = 'deleted',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [activityId, profileId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Activity not found.' });
  }

  res.json({ success: true });
}));


app.post('/api/custom-activities/:id/logs', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;
  const activityId = Number(req.params.id);
  const body = req.body || {};

  if (!Number.isInteger(activityId) || activityId <= 0) {
    return res.status(400).json({ error: 'Invalid activity ID.' });
  }

  const activity = await customCatalogItem(activityId, profileId);

  if (!activity || activity.status !== 'active') {
    return res.status(404).json({ error: 'Active activity not found.' });
  }

  const activityDate = String(body.activityDate || body.date || '')
    .trim();

  const amount = Number(body.amount ?? 1);
  const completed = body.completed === false || body.completed === 0 ? 0 : 1;
  const note = String(body.note || '').trim().slice(0, 500);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) {
    return res.status(400).json({ error: 'Enter a valid activity date.' });
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Enter a valid activity amount.' });
  }

  const result = await db.query(
    `INSERT INTO custom_activity_logs
      (profile_id, custom_activity_id, activity_date,
       amount, completed, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [profileId, activityId, activityDate, amount, completed, note]
  );

  res.status(201).json({
    success: true,
    id: result.rows[0].id
  });
}));


app.delete('/api/custom-activities/:id/logs/:logId', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;
  const activityId = Number(req.params.id);
  const logId = Number(req.params.logId);

  if (
    !Number.isInteger(activityId) || activityId <= 0 ||
    !Number.isInteger(logId) || logId <= 0
  ) {
    return res.status(400).json({ error: 'Invalid activity or log ID.' });
  }

  const result = await db.query(
    `DELETE FROM custom_activity_logs
     WHERE id = $1
       AND profile_id = $2
       AND custom_activity_id = $3`,
    [logId, profileId, activityId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Activity log not found.' });
  }

  res.json({ success: true });
}));

// ===============================
// PART 5: INTELLIGENCE
// ===============================

app.get('/api/intelligence', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const events = await getUnifiedActivity(profileId, 1000);

  const [customResult, projectResult, goalResult] = await Promise.all([
    db.query(
      `SELECT id, frequency_per_week AS "frequencyPerWeek", status
       FROM custom_activities
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, status
       FROM projects
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, target_value AS "targetValue",
              current_value AS "currentValue", deadline, priority, status
       FROM goals
       WHERE profile_id = $1 AND deleted_at IS NULL`,
      [profileId]
    )
  ]);

  const requestedToday = String(req.query.today || '');
  const today = validateDate(requestedToday)
    ? requestedToday
    : new Date().toISOString().slice(0, 10);

  const analysis = analyzeConsistency({
    events,
    activities: customResult.rows,
    projects: projectResult.rows,
    goals: goalResult.rows,
    today
  });

  res.json({
    ...analysis,
    activityHistory: events.slice(0, 100)
  });
}));


// ===============================
// PART 5: APPLICATION STATE
// ===============================

app.get('/api/state', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;

  const [
    settingsResult,
    connectionsResult,
    manualResult,
    catalogResult,
    customResult,
    projectsResult,
    tasksResult,
    goalsResult,
    activityHistory,
    activities
  ] = await Promise.all([
    db.query(
      `SELECT data_json FROM settings WHERE profile_id = $1`,
      [profileId]
    ),
    db.query(
      `SELECT * FROM platform_connections
       WHERE profile_id = $1 ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT platform_id, activity_date AS date, amount, note
       FROM manual_activities
       WHERE profile_id = $1
       ORDER BY activity_date DESC`,
      [profileId]
    ),
    db.query(
      `SELECT id, item_type AS "itemType", name, description,
              category, platform_app AS "platformApp",
              username, url, status
       FROM catalog_items
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, description, category, unit,
              frequency_per_week AS "frequencyPerWeek",
              target_per_session AS "targetPerSession", status
       FROM custom_activities
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, description, deadline, priority, status
       FROM projects
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY
         CASE priority
           WHEN 'high' THEN 0
           WHEN 'medium' THEN 1
           ELSE 2
         END,
         deadline NULLS LAST`,
      [profileId]
    ),
    db.query(
      `SELECT id, project_id AS "projectId", title, description,
              deadline, status, completed_at AS "completedAt"
       FROM project_tasks
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY id`,
      [profileId]
    ),
    db.query(
      `SELECT id, name, description,
              target_value AS "targetValue",
              current_value AS "currentValue",
              unit, deadline, priority, status
       FROM goals
       WHERE profile_id = $1 AND deleted_at IS NULL
       ORDER BY
         CASE priority
           WHEN 'high' THEN 0
           WHEN 'medium' THEN 1
           ELSE 2
         END,
         deadline NULLS LAST`,
      [profileId]
    ),
    getUnifiedActivity(profileId, 200),
    getActivities(profileId)
  ]);

  const connections = connectionsResult.rows.map(connection => ({
    ...connection,
    stats: parseJson(connection.stats_json, {})
  }));

  const projects = projectsResult.rows.map(project => ({
    ...project,
    tasks: tasksResult.rows.filter(task => task.projectId === project.id)
  }));

  const settingsRow = settingsResult.rows[0];

  res.json({
    profile: {
      id: req.profile.id,
      email: req.profile.email,
      name: req.profile.name
    },
    connections,
    catalogItems: catalogResult.rows,
    customActivities: customResult.rows,
    projects,
    goals: goalsResult.rows,
    activityHistory,
    activities,
    manualActivities: manualResult.rows,
    settings: {
      ...DEFAULT_SETTINGS,
      ...parseJson(settingsRow?.data_json, {})
    }
  });
}));


// ===============================
// PART 5: SETTINGS UPDATE
// ===============================

app.put('/api/settings', requireAuth, asyncHandler(async (req, res) => {
  const next = {
    ...DEFAULT_SETTINGS,
    ...(req.body || {})
  };

  await db.query(
    `INSERT INTO settings (profile_id, data_json)
     VALUES ($1, $2)
     ON CONFLICT (profile_id)
     DO UPDATE SET
       data_json = EXCLUDED.data_json,
       updated_at = CURRENT_TIMESTAMP`,
    [req.profile.id, JSON.stringify(next)]
  );

  res.json(next);
}));


// ===============================
// PART 5: CUSTOM ACTIVITIES
// ===============================

app.post('/api/custom-activities', requireAuth, asyncHandler(async (req, res) => {
  const normalized = normalizeCustomActivity(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const {
    name, description, category, unit,
    frequencyPerWeek, targetPerSession, status
  } = normalized.value;

  const result = await db.query(
    `INSERT INTO custom_activities
      (profile_id, name, description, category, unit,
       frequency_per_week, target_per_session, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      req.profile.id, name, description, category, unit,
      frequencyPerWeek, targetPerSession, status
    ]
  );

  const activityResult = await db.query(
    `SELECT id, name, description, category, unit,
            frequency_per_week AS "frequencyPerWeek",
            target_per_session AS "targetPerSession", status
     FROM custom_activities
     WHERE id = $1 AND profile_id = $2`,
    [result.rows[0].id, req.profile.id]
  );

  res.status(201).json({ activity: activityResult.rows[0] });
}));


app.put('/api/custom-activities/:id', requireAuth, asyncHandler(async (req, res) => {
  const activityId = Number(req.params.id);

  if (!Number.isSafeInteger(activityId) || activityId < 1) {
    return res.status(400).json({ error: 'Invalid activity.' });
  }

  const normalized = normalizeCustomActivity(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const existing = await db.query(
    `SELECT id FROM custom_activities
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [activityId, req.profile.id]
  );

  if (existing.rowCount === 0) {
    return res.status(404).json({ error: 'Activity not found.' });
  }

  const {
    name, description, category, unit,
    frequencyPerWeek, targetPerSession, status
  } = normalized.value;

  await db.query(
    `UPDATE custom_activities
     SET name = $1,
         description = $2,
         category = $3,
         unit = $4,
         frequency_per_week = $5,
         target_per_session = $6,
         status = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $8 AND profile_id = $9`,
    [
      name, description, category, unit,
      frequencyPerWeek, targetPerSession, status,
      activityId, req.profile.id
    ]
  );

  const activityResult = await db.query(
    `SELECT id, name, description, category, unit,
            frequency_per_week AS "frequencyPerWeek",
            target_per_session AS "targetPerSession", status
     FROM custom_activities
     WHERE id = $1 AND profile_id = $2`,
    [activityId, req.profile.id]
  );

  res.json({ activity: activityResult.rows[0] });
}));


app.delete('/api/custom-activities/:id', requireAuth, asyncHandler(async (req, res) => {
  const activityId = Number(req.params.id);

  if (!Number.isSafeInteger(activityId) || activityId < 1) {
    return res.status(400).json({ error: 'Invalid activity.' });
  }

  const result = await db.query(
    `UPDATE custom_activities
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [activityId, req.profile.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Activity not found.' });
  }

  res.json({ ok: true });
}));


app.post('/api/custom-activities/:id/logs', requireAuth, asyncHandler(async (req, res) => {
  const activityId = Number(req.params.id);

  const activityResult = await db.query(
    `SELECT id FROM custom_activities
     WHERE id = $1 AND profile_id = $2
       AND status = 'active' AND deleted_at IS NULL`,
    [activityId, req.profile.id]
  );

  if (activityResult.rowCount === 0) {
    return res.status(404).json({ error: 'Active activity not found.' });
  }

  const date = String(req.body?.date || '');
  const amount = Number(req.body?.amount ?? 1);
  const note = String(req.body?.note || '').trim().slice(0, 1000);

  if (!validateDate(date)) {
    return res.status(400).json({ error: 'Choose a valid activity date.' });
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: 'Enter an amount greater than zero.' });
  }

  const completed = req.body?.completed === false ? 0 : 1;

  const result = await db.query(
    `INSERT INTO custom_activity_logs
      (profile_id, activity_id, activity_date, amount, completed, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [req.profile.id, activityId, date, amount, completed, note]
  );

  res.status(201).json({
    log: {
      id: result.rows[0].id,
      activityId,
      date,
      amount,
      completed: Boolean(completed),
      note
    }
  });
}));


app.delete('/api/custom-activity-logs/:id', requireAuth, asyncHandler(async (req, res) => {
  const logId = Number(req.params.id);

  if (!Number.isSafeInteger(logId) || logId < 1) {
    return res.status(400).json({ error: 'Invalid activity log.' });
  }

  const result = await db.query(
    `DELETE FROM custom_activity_logs
     WHERE id = $1 AND profile_id = $2`,
    [logId, req.profile.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Activity log not found.' });
  }

  res.json({ ok: true });
}));


// ===============================
// PART 6: PROJECTS
// ===============================

app.post('/api/projects', requireAuth, asyncHandler(async (req, res) => {
  const normalized = normalizeProject(req.body);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const { name, description, deadline, priority, status } = normalized.value;

  const result = await db.query(
    `INSERT INTO projects
      (profile_id, name, description, deadline, priority, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, description, deadline, priority, status`,
    [req.profile.id, name, description, deadline, priority, status]
  );

  res.status(201).json({
    project: { ...result.rows[0], tasks: [] }
  });
}));


app.put('/api/projects/:id', requireAuth, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);

  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    return res.status(400).json({ error: 'Invalid project.' });
  }

  const normalized = normalizeProject(req.body);
  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const existing = await db.query(
    `SELECT id FROM projects
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [projectId, req.profile.id]
  );

  if (existing.rowCount === 0) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  const { name, description, deadline, priority, status } = normalized.value;

  const result = await db.query(
    `UPDATE projects
     SET name = $1,
         description = $2,
         deadline = $3,
         priority = $4,
         status = $5,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $6 AND profile_id = $7
     RETURNING id, name, description, deadline, priority, status`,
    [name, description, deadline, priority, status, projectId, req.profile.id]
  );

  res.json({ project: result.rows[0] });
}));


app.delete('/api/projects/:id', requireAuth, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);

  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    return res.status(400).json({ error: 'Invalid project.' });
  }

  const result = await db.query(
    `UPDATE projects
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [projectId, req.profile.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  res.json({ ok: true });
}));


// ===============================
// PART 6: PROJECT TASKS
// ===============================

app.post('/api/projects/:id/tasks', requireAuth, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.id);

  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    return res.status(400).json({ error: 'Invalid project.' });
  }

  const project = await db.query(
    `SELECT id FROM projects
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [projectId, req.profile.id]
  );

  if (project.rowCount === 0) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const deadline = optionalDate(req.body?.deadline);

  if (!title || title.length > 160) {
    return res.status(400).json({
      error: 'Enter a task title up to 160 characters.'
    });
  }

  if (description.length > 1000) {
    return res.status(400).json({
      error: 'Task description must be 1000 characters or less.'
    });
  }

  if (deadline.error) {
    return res.status(400).json({ error: deadline.error });
  }

  const result = await db.query(
    `INSERT INTO project_tasks
      (profile_id, project_id, title, description, deadline)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, project_id AS "projectId",
               title, description, deadline, status,
               completed_at AS "completedAt"`,
    [req.profile.id, projectId, title, description, deadline.value]
  );

  res.status(201).json({ task: result.rows[0] });
}));


app.put('/api/projects/:projectId/tasks/:taskId', requireAuth, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isSafeInteger(projectId) || projectId < 1 ||
    !Number.isSafeInteger(taskId) || taskId < 1
  ) {
    return res.status(400).json({ error: 'Invalid project or task.' });
  }

  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim();
  const status = req.body?.status === 'completed' ? 'completed' : 'pending';
  const deadline = optionalDate(req.body?.deadline);

  if (!title || title.length > 160) {
    return res.status(400).json({
      error: 'Enter a task title up to 160 characters.'
    });
  }

  if (description.length > 1000) {
    return res.status(400).json({
      error: 'Task description must be 1000 characters or less.'
    });
  }

  if (deadline.error) {
    return res.status(400).json({ error: deadline.error });
  }

  const taskResponse = await withTransaction(async client => {
    const taskResult = await client.query(
      `SELECT tasks.id, tasks.status, tasks.completed_at,
              projects.name AS project_name
       FROM project_tasks tasks
       JOIN projects ON projects.id = tasks.project_id
       WHERE tasks.id = $1
         AND tasks.project_id = $2
         AND tasks.profile_id = $3
         AND projects.profile_id = $3
         AND tasks.deleted_at IS NULL
       FOR UPDATE OF tasks`,
      [taskId, projectId, req.profile.id]
    );

    if (taskResult.rowCount === 0) {
      return null;
    }

    const task = taskResult.rows[0];

    const completedAt = status === 'completed'
      ? task.completed_at || new Date().toISOString()
      : null;

    await client.query(
      `UPDATE project_tasks
       SET title = $1,
           description = $2,
           deadline = $3,
           status = $4,
           completed_at = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND project_id = $7 AND profile_id = $8`,
      [
        title, description, deadline.value, status,
        completedAt, taskId, projectId, req.profile.id
      ]
    );

    if (status !== task.status) {
      await client.query(
        `INSERT INTO project_task_events
          (profile_id, project_id, task_id, event_type,
           project_name, task_title)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          req.profile.id,
          projectId,
          taskId,
          status === 'completed' ? 'completed' : 'reopened',
          task.project_name,
          title
        ]
      );
    }

    return {
      id: taskId,
      projectId,
      title,
      description,
      deadline: deadline.value,
      status,
      completedAt
    };
  });

  if (!taskResponse) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  res.json({ task: taskResponse });
}));


app.delete('/api/projects/:projectId/tasks/:taskId', requireAuth, asyncHandler(async (req, res) => {
  const projectId = Number(req.params.projectId);
  const taskId = Number(req.params.taskId);

  if (
    !Number.isSafeInteger(projectId) || projectId < 1 ||
    !Number.isSafeInteger(taskId) || taskId < 1
  ) {
    return res.status(400).json({ error: 'Invalid project or task.' });
  }

  const result = await db.query(
    `UPDATE project_tasks
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND project_id = $2
       AND profile_id = $3
       AND deleted_at IS NULL`,
    [taskId, projectId, req.profile.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  res.json({ ok: true });
}));


// ===============================
// PART 6: GOALS
// ===============================

app.post('/api/goals', requireAuth, asyncHandler(async (req, res) => {
  const normalized = normalizeGoal(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const {
    name, description, targetValue, unit,
    deadline, priority, status
  } = normalized.value;

  const result = await db.query(
    `INSERT INTO goals
      (profile_id, name, description, target_value,
       unit, deadline, priority, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, name, description,
               target_value AS "targetValue",
               current_value AS "currentValue",
               unit, deadline, priority, status`,
    [
      req.profile.id, name, description, targetValue,
      unit, deadline, priority, status
    ]
  );

  res.status(201).json({ goal: result.rows[0] });
}));


app.put('/api/goals/:id', requireAuth, asyncHandler(async (req, res) => {
  const goalId = Number(req.params.id);

  if (!Number.isSafeInteger(goalId) || goalId < 1) {
    return res.status(400).json({ error: 'Invalid goal.' });
  }

  const normalized = normalizeGoal(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const existing = await db.query(
    `SELECT id, current_value AS "currentValue"
     FROM goals
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [goalId, req.profile.id]
  );

  if (existing.rowCount === 0) {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  const {
    name, description, targetValue,
    unit, deadline, priority
  } = normalized.value;

  const status = Number(existing.rows[0].currentValue) >= targetValue
    ? 'completed'
    : normalized.value.status;

  const result = await db.query(
    `UPDATE goals
     SET name = $1,
         description = $2,
         target_value = $3,
         unit = $4,
         deadline = $5,
         priority = $6,
         status = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $8 AND profile_id = $9
     RETURNING id, name, description,
               target_value AS "targetValue",
               current_value AS "currentValue",
               unit, deadline, priority, status`,
    [
      name, description, targetValue, unit,
      deadline, priority, status, goalId, req.profile.id
    ]
  );

  res.json({ goal: result.rows[0] });
}));


app.delete('/api/goals/:id', requireAuth, asyncHandler(async (req, res) => {
  const goalId = Number(req.params.id);

  if (!Number.isSafeInteger(goalId) || goalId < 1) {
    return res.status(400).json({ error: 'Invalid goal.' });
  }

  const result = await db.query(
    `UPDATE goals
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [goalId, req.profile.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  res.json({ ok: true });
}));


app.post('/api/goals/:id/progress', requireAuth, asyncHandler(async (req, res) => {
  const goalId = Number(req.params.id);

  if (!Number.isSafeInteger(goalId) || goalId < 1) {
    return res.status(400).json({ error: 'Invalid goal.' });
  }

  const amount = Number(req.body?.amount);
  const date = String(
    req.body?.date || new Date().toISOString().slice(0, 10)
  );
  const note = String(req.body?.note || '').trim().slice(0, 1000);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    return res.status(400).json({
      error: 'Enter a progress amount greater than zero.'
    });
  }

  if (!validateDate(date)) {
    return res.status(400).json({ error: 'Choose a valid progress date.' });
  }

  const saved = await withTransaction(async client => {
    const goalResult = await client.query(
      `SELECT id,
              target_value AS "targetValue",
              current_value AS "currentValue",
              status
       FROM goals
       WHERE id = $1
         AND profile_id = $2
         AND deleted_at IS NULL
       FOR UPDATE`,
      [goalId, req.profile.id]
    );

    if (goalResult.rowCount === 0) {
      return { error: 'not-found' };
    }

    const goal = goalResult.rows[0];

    if (goal.status !== 'active') {
      return { error: 'not-active' };
    }

    const currentValue = Math.min(
      Number(goal.targetValue),
      Number(goal.currentValue) + amount
    );

    const status = currentValue >= Number(goal.targetValue)
      ? 'completed'
      : 'active';

    const logResult = await client.query(
      `INSERT INTO goal_progress_logs
        (profile_id, goal_id, amount, progress_date, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.profile.id, goalId, amount, date, note]
    );

    await client.query(
      `UPDATE goals
       SET current_value = $1,
           status = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND profile_id = $4`,
      [currentValue, status, goalId, req.profile.id]
    );

    return {
      goal: { ...goal, currentValue, status },
      progress: {
        id: logResult.rows[0].id,
        amount,
        date,
        note
      }
    };
  });

  if (saved.error === 'not-found') {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  if (saved.error === 'not-active') {
    return res.status(409).json({
      error: 'Resume this goal before recording progress.'
    });
  }

  res.status(201).json(saved);
}));
// ===============================
// PART 7: CATALOG ITEMS
// ===============================

app.post('/api/catalog-items', requireAuth, asyncHandler(async (req, res) => {
  const normalized = normalizeCatalogItem(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const {
    itemType, name, description, category,
    platformApp, username, url, status
  } = normalized.value;

  const result = await db.query(
    `INSERT INTO catalog_items
      (profile_id, item_type, name, description, category,
       platform_app, username, url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      req.profile.id, itemType, name, description, category,
      platformApp, username, url, status
    ]
  );

  const itemResult = await db.query(
    `SELECT id, item_type AS "itemType",
            name, description, category,
            platform_app AS "platformApp",
            username, url, status
     FROM catalog_items
     WHERE id = $1 AND profile_id = $2`,
    [result.rows[0].id, req.profile.id]
  );

  res.status(201).json({ item: itemResult.rows[0] });
}));


app.put('/api/catalog-items/:id', requireAuth, asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);

  if (!Number.isSafeInteger(itemId) || itemId < 1) {
    return res.status(400).json({ error: 'Invalid catalog item.' });
  }

  const normalized = normalizeCatalogItem(req.body);

  if (normalized.error) {
    return res.status(400).json({ error: normalized.error });
  }

  const existing = await db.query(
    `SELECT id FROM catalog_items
     WHERE id = $1 AND profile_id = $2 AND deleted_at IS NULL`,
    [itemId, req.profile.id]
  );

  if (existing.rowCount === 0) {
    return res.status(404).json({ error: 'Catalog item not found.' });
  }

  const {
    itemType, name, description, category,
    platformApp, username, url, status
  } = normalized.value;

  await db.query(
    `UPDATE catalog_items
     SET item_type = $1,
         name = $2,
         description = $3,
         category = $4,
         platform_app = $5,
         username = $6,
         url = $7,
         status = $8,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $9 AND profile_id = $10`,
    [
      itemType, name, description, category,
      platformApp, username, url, status,
      itemId, req.profile.id
    ]
  );

  const itemResult = await db.query(
    `SELECT id, item_type AS "itemType",
            name, description, category,
            platform_app AS "platformApp",
            username, url, status
     FROM catalog_items
     WHERE id = $1 AND profile_id = $2`,
    [itemId, req.profile.id]
  );

  res.json({ item: itemResult.rows[0] });
}));


app.delete('/api/catalog-items/:id', requireAuth, asyncHandler(async (req, res) => {
  const itemId = Number(req.params.id);

  if (!Number.isSafeInteger(itemId) || itemId < 1) {
    return res.status(400).json({ error: 'Invalid catalog item.' });
  }

  const result = await db.query(
    `UPDATE catalog_items
     SET deleted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND profile_id = $2
       AND deleted_at IS NULL`,
    [itemId, req.profile.id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Catalog item not found.' });
  }

  res.json({ ok: true });
}));


// ===============================
// PART 7: MANUAL ACTIVITIES
// ===============================

app.post('/api/manual-activities', requireAuth, asyncHandler(async (req, res) => {
  const { platformId } = req.body || {};
  const date = String(req.body?.date || '');
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim().slice(0, 1000);

  if (!await canLogManually(req.profile.id, platformId)) {
    return res.status(400).json({
      error: 'This platform is not available for manual entry.'
    });
  }

  if (!validateDate(date)) {
    return res.status(400).json({
      error: 'Choose a valid activity date.'
    });
  }

  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) {
    return res.status(400).json({
      error: 'Enter a valid non-negative amount.'
    });
  }

  if (platformId === 'speakits' && amount !== 1) {
    return res.status(400).json({
      error: 'Speakits records one completed session per date.'
    });
  }

  await db.query(
    `INSERT INTO manual_activities
      (profile_id, platform_id, activity_date, amount, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (profile_id, platform_id, activity_date)
     DO UPDATE SET
       amount = EXCLUDED.amount,
       note = EXCLUDED.note,
       updated_at = CURRENT_TIMESTAMP`,
    [req.profile.id, platformId, date, amount, note]
  );

  res.status(201).json({ platformId, date, amount, note });
}));


app.delete('/api/manual-activities/:platformId/:date', requireAuth, asyncHandler(async (req, res) => {
  const { platformId, date } = req.params;

  const isManualPlatform = MANUAL_PLATFORMS.has(platformId);
  const customItem = isManualPlatform
    ? null
    : await customCatalogItem(req.profile.id, platformId, false);

  if ((!isManualPlatform && !customItem) || !validateDate(date)) {
    return res.status(400).json({ error: 'Invalid activity entry.' });
  }

  await db.query(
    `DELETE FROM manual_activities
     WHERE profile_id = $1
       AND platform_id = $2
       AND activity_date = $3`,
    [req.profile.id, platformId, date]
  );

  res.json({ ok: true });
}));


// ===============================
// PART 8: PLATFORM CONNECTIONS
// ===============================

app.post('/api/platforms', requireAuth, asyncHandler(async (req, res) => {
  const platformId = String(req.body?.platformId || '').trim();
  const username = String(req.body?.username || '').trim();

  if (!CODING_PLATFORMS.has(platformId) || !username) {
    return res.status(400).json({
      error: 'Choose a supported coding platform and enter its username.'
    });
  }

  const profileUrl = String(req.body?.profileUrl || '').trim() || null;

  const result = await db.query(
    `INSERT INTO platform_connections
      (profile_id, platform_id, username, profile_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (profile_id, platform_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       profile_url = EXCLUDED.profile_url,
       sync_status = 'never',
       sync_error = NULL
     RETURNING *`,
    [req.profile.id, platformId, username, profileUrl]
  );

  res.status(201).json(result.rows[0]);
}));


app.delete('/api/platforms/:platformId', requireAuth, asyncHandler(async (req, res) => {
  await db.query(
    `DELETE FROM platform_connections
     WHERE profile_id = $1 AND platform_id = $2`,
    [req.profile.id, req.params.platformId]
  );

  res.json({ ok: true });
}));


// ===============================
// PART 8: PLATFORM SYNC
// ===============================

app.post('/api/platforms/:platformId/sync', requireAuth, asyncHandler(async (req, res) => {
  const profileId = req.profile.id;
  const platformId = req.params.platformId;

  const connectionResult = await db.query(
    `SELECT *
     FROM platform_connections
     WHERE profile_id = $1 AND platform_id = $2`,
    [profileId, platformId]
  );

  if (connectionResult.rowCount === 0) {
    return res.status(404).json({
      error: 'Connect this platform before syncing.'
    });
  }

  const connection = connectionResult.rows[0];

  try {
    const { records, stats } = await fetchPlatformData(connection);

    await withTransaction(async client => {
      for (const item of records) {
        await client.query(
          `INSERT INTO activities
            (profile_id, platform_id, external_id, activity_date,
             problem_name, problem_url, difficulty, topics_json,
             submissions, contests, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT
             (profile_id, platform_id, external_id, activity_date, problem_name)
           DO UPDATE SET
             topics_json = EXCLUDED.topics_json,
             submissions = EXCLUDED.submissions,
             contests = EXCLUDED.contests,
             raw_json = EXCLUDED.raw_json,
             updated_at = CURRENT_TIMESTAMP`,
          [
            profileId,
            connection.platform_id,
            item.externalId || null,
            item.date,
            item.problemName || null,
            item.problemUrl || null,
            item.difficulty || null,
            JSON.stringify(item.topics || []),
            item.submissions || 0,
            item.contests || 0,
            JSON.stringify(item.raw || null)
          ]
        );
      }

      await client.query(
        `UPDATE platform_connections
         SET stats_json = $1,
             last_synced_at = CURRENT_TIMESTAMP,
             sync_status = 'success',
             sync_error = NULL
         WHERE id = $2 AND profile_id = $3`,
        [JSON.stringify(stats), connection.id, profileId]
      );
    });

    const activityLog = await toActivityLog(profileId, connection.platform_id);

    res.json({
      platformId: connection.platform_id,
      imported: records.length,
      stats,
      activityLog
    });

  } catch (error) {
    await db.query(
      `UPDATE platform_connections
       SET sync_status = 'error',
           sync_error = $1
       WHERE id = $2 AND profile_id = $3`,
      [
        String(error.message || 'Platform sync failed').slice(0, 1000),
        connection.id,
        profileId
      ]
    );

    res.status(502).json({
      error: error.message || 'Platform sync failed.'
    });
  }
}));


// ===============================
// FINAL SERVER SETUP
// ===============================

app.use((error, req, res, next) => {
  console.error('StreakForce API error:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: 'Something went wrong. Please try again.'
  });
});

db.on('error', error => {
  console.error('PostgreSQL pool error:', error);
});

app.listen(port, () => {
  console.log(`StreakForce running at http://localhost:${port}`);
});
