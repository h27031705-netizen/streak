'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const workspaceRoot = path.join(__dirname, '..');

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function waitForServer(child, port) {
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const deadline = Date.now() + 10000;
  let lastProbeError = 'no response';

  return (async () => {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}: ${output}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/auth/session`);
        if (response.ok) return;
        lastProbeError = `HTTP ${response.status}`;
      } catch (error) {
        lastProbeError = error.message;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Server did not start (${lastProbeError}): ${output}`);
  })();
}

async function request(base, route, method = 'GET', body, cookie) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return {
    response,
    data: await response.json().catch(() => ({})),
    cookie: (response.headers.get('set-cookie') || '').split(';')[0],
    setCookie: response.headers.get('set-cookie') || ''
  };
}

test('workspace APIs persist activities, projects, goals, insights, and isolate profiles', async t => {
  const databasePath = path.join(os.tmpdir(), `streakforce-test-${process.pid}-${Date.now()}.sqlite`);
  const legacyDatabase = new Database(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_salt TEXT,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO profiles (id) VALUES (1);
    CREATE TABLE catalog_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      platform_app TEXT NOT NULL DEFAULT '',
      url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);
  legacyDatabase.prepare(`INSERT INTO catalog_items (profile_id, item_type, name, url)
    VALUES (1, 'platform', 'HackerRank', 'https://www.hackerrank.com/profile/legacy-user')`).run();
  legacyDatabase.close();
  const port = await reservePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: workspaceRoot,
    env: { ...process.env, PORT: String(port), STREAKFORCE_DB_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await new Promise(resolve => server.once('exit', resolve));
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`${databasePath}${suffix}`); } catch {}
    }
  });
  await waitForServer(server, port);

  const unauthenticated = await request(base, '/api/state');
  assert.equal(unauthenticated.response.status, 401);

  const first = await request(base, '/api/auth/register', 'POST', {
    name: 'Workspace Test A',
    email: 'workspace-a@example.test',
    password: 'Workspace Test A secure 123',
    securityQuestion: 'Test question A?',
    securityAnswer: 'answer-a'
  });
  const second = await request(base, '/api/auth/register', 'POST', {
    name: 'Workspace Test B',
    email: 'workspace-b@example.test',
    password: 'Workspace Test B secure 123',
    securityQuestion: 'Test question B?',
    securityAnswer: 'answer-b'
  });
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  const firstCookie = first.cookie;
  const secondCookie = second.cookie;

  const activity = await request(base, '/api/custom-activities', 'POST', {
    name: 'AI Study', description: 'Practice session', category: 'study', unit: 'minutes',
    frequencyPerWeek: 4, targetPerSession: 30, status: 'active'
  }, firstCookie);
  assert.equal(activity.response.status, 201);
  const activityId = activity.data.activity.id;
  const activityLog = await request(base, `/api/custom-activities/${activityId}/logs`, 'POST', {
    date: '2026-10-06', amount: 35, completed: true, note: 'Feature review'
  }, firstCookie);
  assert.equal(activityLog.response.status, 201);
  const updatedActivity = await request(base, `/api/custom-activities/${activityId}`, 'PUT', {
    name: 'AI Study Sessions', description: 'Focused practice', category: 'study', unit: 'minutes',
    frequencyPerWeek: 5, targetPerSession: 40, status: 'active'
  }, firstCookie);
  assert.equal(updatedActivity.data.activity.name, 'AI Study Sessions');

  const project = await request(base, '/api/projects', 'POST', {
    name: 'NL2SQL', description: 'Course project', deadline: '2026-12-01', priority: 'high'
  }, firstCookie);
  assert.equal(project.response.status, 201);
  const projectId = project.data.project.id;
  const task = await request(base, `/api/projects/${projectId}/tasks`, 'POST', {
    title: 'Embedding implementation', description: 'Build the retrieval step', deadline: '2026-11-01'
  }, firstCookie);
  assert.equal(task.response.status, 201);
  const updatedTask = await request(base, `/api/projects/${projectId}/tasks/${task.data.task.id}`, 'PUT', {
    ...task.data.task, title: 'Embeddings and retrieval', status: 'pending'
  }, firstCookie);
  assert.equal(updatedTask.data.task.title, 'Embeddings and retrieval');
  const completedTask = await request(base, `/api/projects/${projectId}/tasks/${task.data.task.id}`, 'PUT', {
    ...updatedTask.data.task, status: 'completed'
  }, firstCookie);
  assert.equal(completedTask.data.task.status, 'completed');
  assert.ok(completedTask.data.task.completedAt);
  const reopenedTask = await request(base, `/api/projects/${projectId}/tasks/${task.data.task.id}`, 'PUT', {
    ...completedTask.data.task, status: 'pending'
  }, firstCookie);
  assert.equal(reopenedTask.data.task.status, 'pending');
  const completedAgain = await request(base, `/api/projects/${projectId}/tasks/${task.data.task.id}`, 'PUT', {
    ...reopenedTask.data.task, status: 'completed'
  }, firstCookie);
  assert.equal(completedAgain.data.task.status, 'completed');

  const goal = await request(base, '/api/goals', 'POST', {
    name: 'Complete 100 problems', targetValue: 2, unit: 'problems', deadline: '2026-12-01', priority: 'medium'
  }, firstCookie);
  assert.equal(goal.response.status, 201);
  const goalId = goal.data.goal.id;
  const progressOne = await request(base, `/api/goals/${goalId}/progress`, 'POST', { amount: 1, date: '2026-10-06' }, firstCookie);
  const progressTwo = await request(base, `/api/goals/${goalId}/progress`, 'POST', { amount: 1, date: '2026-10-06' }, firstCookie);
  assert.equal(progressOne.data.goal.status, 'active');
  assert.equal(progressTwo.data.goal.status, 'completed');
  assert.equal(progressTwo.data.goal.currentValue, 2);

  const stateA = await request(base, '/api/state', 'GET', undefined, firstCookie);
  assert.equal(stateA.data.customActivities.length, 1);
  assert.equal(stateA.data.projects[0].tasks[0].status, 'completed');
  assert.equal(stateA.data.goals[0].status, 'completed');
  const legacyPlatform = stateA.data.catalogItems.find(item => item.name === 'HackerRank');
  assert.equal(legacyPlatform.url, 'https://www.hackerrank.com/profile/legacy-user');
  assert.equal(legacyPlatform.username, '');
  const insight = await request(base, '/api/intelligence', 'GET', undefined, firstCookie);
  assert.equal(insight.response.status, 200);
  assert.equal(insight.data.scoreBreakdown.weights.activity, 0.35);
  assert.equal(insight.data.classifier.coldStart, true);
  assert.ok(insight.data.activityHistory.some(event => event.type === 'custom-activity'));
  assert.ok(insight.data.activityHistory.some(event => event.type === 'project-task'));
  assert.ok(insight.data.activityHistory.some(event => event.type === 'goal-progress'));

  const stateB = await request(base, '/api/state', 'GET', undefined, secondCookie);
  assert.equal(stateB.data.customActivities.length, 0);
  assert.equal(stateB.data.projects.length, 0);
  assert.equal(stateB.data.goals.length, 0);
  assert.equal((await request(base, `/api/projects/${projectId}`, 'DELETE', undefined, secondCookie)).response.status, 404);
  assert.equal((await request(base, `/api/custom-activities/${activityId}`, 'PUT', {
    name: 'Unauthorized update', category: 'study', unit: 'minutes', frequencyPerWeek: 3, targetPerSession: 1, status: 'active'
  }, secondCookie)).response.status, 404);

  const platform = await request(base, '/api/catalog-items', 'POST', {
    itemType: 'platform', name: 'LeetCode', username: 'workspace-user', status: 'active'
  }, firstCookie);
  assert.equal(platform.response.status, 201);
  assert.equal(platform.data.item.url, 'https://leetcode.com/u/workspace-user/');
  const platformId = platform.data.item.id;
  const updatedPlatform = await request(base, `/api/catalog-items/${platformId}`, 'PUT', {
    itemType: 'platform', name: 'LeetCode', username: 'workspace-user-2', url: 'https://leetcode.com/u/workspace-user-2/', status: 'active'
  }, firstCookie);
  assert.equal(updatedPlatform.data.item.username, 'workspace-user-2');
  const platformLog = await request(base, '/api/manual-activities', 'POST', {
    platformId: `custom-${platformId}`, date: '2026-10-06', amount: 2, note: 'manual sync unavailable'
  }, firstCookie);
  assert.equal(platformLog.response.status, 201);
  assert.equal((await request(base, '/api/state', 'GET', undefined, secondCookie)).data.catalogItems.length, 0);

  const updatedGoal = await request(base, `/api/goals/${goalId}`, 'PUT', {
    ...progressTwo.data.goal, name: 'Complete coding problems', targetValue: 2, unit: 'problems', deadline: '2026-12-01', priority: 'high', status: 'completed'
  }, firstCookie);
  assert.equal(updatedGoal.data.goal.name, 'Complete coding problems');

  await request(base, `/api/custom-activities/${activityId}`, 'DELETE', undefined, firstCookie);
  const archivedState = await request(base, '/api/state', 'GET', undefined, firstCookie);
  assert.equal(archivedState.data.customActivities.length, 0);
  const archivedHistory = await request(base, '/api/intelligence', 'GET', undefined, firstCookie);
  assert.ok(archivedHistory.data.activityHistory.some(event => event.type === 'custom-activity'));
  await request(base, `/api/projects/${projectId}`, 'DELETE', undefined, firstCookie);
  await request(base, `/api/goals/${goalId}`, 'DELETE', undefined, firstCookie);
  const retainedHistory = await request(base, '/api/intelligence', 'GET', undefined, firstCookie);
  assert.ok(retainedHistory.data.activityHistory.some(event => event.type === 'project-task'));
  assert.ok(retainedHistory.data.activityHistory.some(event => event.type === 'project-task-reopened'));
  assert.ok(retainedHistory.data.activityHistory.some(event => event.type === 'goal-progress'));
  await request(base, `/api/catalog-items/${platformId}`, 'DELETE', undefined, firstCookie);
  const platformHistory = await request(base, '/api/intelligence', 'GET', undefined, firstCookie);
  assert.ok(platformHistory.data.activityHistory.some(event => event.type === 'manual' && event.sourceId === `custom-${platformId}`));

  const rememberedLogin = await request(base, '/api/auth/login', 'POST', {
    email: 'workspace-a@example.test', password: 'Workspace Test A secure 123', remember: true
  });
  assert.equal(rememberedLogin.response.status, 200);
  assert.match(rememberedLogin.setCookie, /Max-Age=2592000/);
  const recoveryQuestion = await request(base, '/api/auth/recovery/question', 'POST', { identifier: 'workspace-a@example.test' });
  assert.equal(recoveryQuestion.data.securityQuestion, 'Test question A?');
  const verifiedAnswer = await request(base, '/api/auth/recovery/verify', 'POST', { identifier: 'workspace-a@example.test', answer: 'answer-a' });
  assert.equal(verifiedAnswer.response.status, 200);
  const reset = await request(base, '/api/auth/recovery/reset', 'POST', { newPassword: 'Workspace Test A replacement 456' }, verifiedAnswer.cookie);
  assert.equal(reset.response.status, 200);
  const newLogin = await request(base, '/api/auth/login', 'POST', { email: 'workspace-a@example.test', password: 'Workspace Test A replacement 456' });
  assert.equal(newLogin.response.status, 200);
});
