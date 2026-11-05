const PLATFORM_DEFINITIONS = [
  { id: 'leetcode', name: 'LeetCode', icon: '🧠', color: '#F39A35', category: 'coding', unit: 'problems', integration: 'automatic' },
  { id: 'codechef', name: 'CodeChef', icon: '🍲', color: '#A84C3D', category: 'coding', unit: 'problems', integration: 'automatic-total' },
  { id: 'codeforces', name: 'Codeforces', icon: '⚡', color: '#4388D6', category: 'coding', unit: 'problems', integration: 'automatic' },
  { id: 'atcoder', name: 'AtCoder', icon: '🎯', color: '#31465A', category: 'coding', unit: 'problems', integration: 'automatic' },
  { id: 'speakits', name: 'Speakits', icon: '🎙️', color: '#DF6B61', category: 'session', unit: 'sessions', integration: 'manual' },
  { id: 'duolingo', name: 'Duolingo', icon: '🦉', color: '#59B847', category: 'language', unit: 'XP', integration: 'manual' },
  { id: 'dsa-ideas', name: 'DSA Ideas', icon: '💡', color: '#D99A32', category: 'ideas', unit: 'ideas', integration: 'manual' }
];
const CATALOG_TYPE_PRESENTATION = {
  client: { icon: '🏢', color: '#638B7A' },
  app: { icon: '▣', color: '#557DA9' },
  platform: { icon: '🧩', color: '#D17D5B' },
  service: { icon: '⚙', color: '#71819B' },
  project: { icon: '◩', color: '#A17B54' },
  integration: { icon: '↗', color: '#728B55' }
};

function toCatalogPlatform(item, frozenPlatforms = []) {
  const id = `custom-${item.id}`;
  const presentation = CATALOG_TYPE_PRESENTATION[item.itemType] || CATALOG_TYPE_PRESENTATION.platform;
  return {
    id,
    customItemId: Number(item.id),
    itemType: item.itemType,
    name: item.name,
    description: item.description || '',
    itemCategory: item.category || '',
    platformApp: item.platformApp || '',
    username: item.username || '',
    url: item.url || '',
    status: item.status,
    icon: presentation.icon,
    color: presentation.color,
    category: 'custom',
    unit: 'activities',
    integration: 'manual',
    profileUrl: item.url || '',
    activityLog: [],
    stats: {},
    syncStatus: 'never',
    frozen: item.status !== 'active' || frozenPlatforms.includes(id)
  };
}

function createEmptyState() {
  return {
    profile: null,
    platforms: PLATFORM_DEFINITIONS.map(platform => ({ ...platform, username: '', profileUrl: '', activityLog: [], stats: {}, syncStatus: 'never', frozen: false })),
    customItems: [],
    customActivities: [],
    projects: [],
    goals: [],
    activityHistory: [],
    intelligence: null,
    intelligenceError: null,
    manualActivities: [],
    settings: {}
  };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const AppData = {
  state: createEmptyState(),
  profile: null,
  serverAvailable: false,
  lastSyncError: null,

  getPlatforms() {
    return this.state.platforms;
  },

  getPlatform(id) {
    return this.state.platforms.find(platform => platform.id === id);
  },

  async checkSession() {
    const result = await apiRequest('/api/auth/session');
    this.profile = result.profile;
    if (this.profile) await this.hydrate();
    return this.profile;
  },

  async authenticate(mode, credentials) {
    const result = await apiRequest(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(credentials)
    });
    this.profile = result.profile;
    await this.hydrate();
    return result.profile;
  },

  async getRecoveryQuestion(identifier) {
    return apiRequest('/api/auth/recovery/question', { method: 'POST', body: JSON.stringify({ identifier }) });
  },

  async verifyRecoveryAnswer(identifier, answer) {
    return apiRequest('/api/auth/recovery/verify', { method: 'POST', body: JSON.stringify({ identifier, answer }) });
  },

  async resetPassword(newPassword) {
    return apiRequest('/api/auth/recovery/reset', { method: 'POST', body: JSON.stringify({ newPassword }) });
  },

  async saveSecurityQuestion(currentPassword, securityQuestion, securityAnswer) {
    return apiRequest('/api/auth/security-question', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, securityQuestion, securityAnswer })
    });
  },

  async loadIntelligence() {
    try {
      const result = await apiRequest(`/api/intelligence?today=${encodeURIComponent(todayISO())}`);
      this.state.intelligence = result;
      this.state.activityHistory = result.activityHistory || [];
      this.state.intelligenceError = null;
      return result;
    } catch (error) {
      this.state.intelligence = null;
      this.state.intelligenceError = error.message;
      return null;
    }
  },

  async logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    this.profile = null;
    this.state = createEmptyState();
  },

  async hydrate() {
    try {
      const remote = await apiRequest('/api/state');
      this.serverAvailable = true;
      this.lastSyncError = null;
      this.profile = remote.profile;
      this.state = createEmptyState();
      this.state.profile = remote.profile;
      this.state.settings = remote.settings || {};
      this.state.manualActivities = remote.manualActivities || [];
      const frozenPlatforms = new Set(this.state.settings.frozenPlatforms || []);
      this.state.platforms.forEach(platform => { platform.frozen = frozenPlatforms.has(platform.id); });
      this.state.customItems = remote.catalogItems || [];
      this.state.customActivities = remote.customActivities || [];
      this.state.projects = remote.projects || [];
      this.state.goals = remote.goals || [];
      this.state.activityHistory = remote.activityHistory || [];
      this.state.platforms.push(...this.state.customItems.filter(item => item.status === 'active').map(item => toCatalogPlatform(item, [...frozenPlatforms])));

      remote.connections.forEach(connection => {
        const platform = this.getPlatform(connection.platform_id);
        if (!platform) return;
        Object.assign(platform, {
          username: connection.username,
          profileUrl: connection.profile_url,
          lastSyncedAt: connection.last_synced_at,
          syncStatus: connection.sync_status,
          syncError: connection.sync_error,
          stats: connection.stats || {}
        });
      });

      const grouped = new Map();
      remote.activities.forEach(row => {
        const key = `${row.platform_id}:${row.activity_date}`;
        let day = grouped.get(key);
        if (!day) {
          day = { date: row.activity_date, problemsSolved: 0, topics: [], contestsJoined: 0, problems: [], submissions: 0, _names: new Set() };
          grouped.set(key, day);
        }
        if (row.problem_name && !day._names.has(row.problem_name)) {
          day._names.add(row.problem_name);
          day.problems.push({ name: row.problem_name, url: row.problem_url, difficulty: row.difficulty, topics: row.topics || [] });
          day.problemsSolved += 1;
        }
        day.submissions += row.submissions || 0;
        day.contestsJoined += row.contests || 0;
        day.topics = [...new Set(day.topics.concat(row.topics || []))];
      });
      grouped.forEach((day, key) => {
        const platform = this.getPlatform(key.slice(0, key.lastIndexOf(':')));
        if (platform) platform.activityLog.push({ ...day, _names: undefined });
      });
      this.state.platforms.forEach(platform => platform.activityLog.sort((a, b) => a.date.localeCompare(b.date)));
      this.loadIntelligence().then(() => {
  if (activeScreen === 'screen-dashboard') {
    renderDashboardInsights();
  }
});

      if (this.state.settings.autoSync) {
        remote.connections.filter(connection => connection.username && ['leetcode', 'codechef', 'codeforces', 'atcoder'].includes(connection.platform_id)).forEach(connection => {
          this.syncPlatform(connection.platform_id).catch(error => {
            const platform = this.getPlatform(connection.platform_id);
            if (platform) { platform.syncStatus = 'error'; platform.syncError = error.message; }
            if (activeScreen === 'screen-dashboard') renderDashboardCards();
          });
        });
      }
      return remote;
    } catch (error) {
      this.serverAvailable = false;
      this.lastSyncError = error.message;
      throw error;
    }
  },

  async connectPlatform(platformId, username, profileUrl) {
    const connection = await apiRequest('/api/platforms', {
      method: 'POST',
      body: JSON.stringify({ platformId, username, profileUrl })
    });
    const platform = this.getPlatform(platformId);
    if (platform) Object.assign(platform, { username: connection.username, profileUrl: connection.profile_url, syncStatus: 'never' });
    return connection;
  },

  async createCatalogItem(itemData) {
    const result = await apiRequest('/api/catalog-items', { method: 'POST', body: JSON.stringify(itemData) });
    this.state.customItems.push(result.item);
    if (result.item.status === 'active') this.state.platforms.push(toCatalogPlatform(result.item, this.state.settings.frozenPlatforms || []));
    return result.item;
  },

  async updateCatalogItem(itemId, itemData) {
    const result = await apiRequest(`/api/catalog-items/${encodeURIComponent(itemId)}`, { method: 'PUT', body: JSON.stringify(itemData) });
    this.state.customItems = this.state.customItems.map(item => item.id === result.item.id ? result.item : item);
    this.state.platforms = this.state.platforms.filter(platform => platform.customItemId !== result.item.id);
    if (result.item.status === 'active') this.state.platforms.push(toCatalogPlatform(result.item, this.state.settings.frozenPlatforms || []));
    return result.item;
  },

  async deleteCatalogItem(itemId) {
    await apiRequest(`/api/catalog-items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    this.state.customItems = this.state.customItems.filter(item => item.id !== Number(itemId));
    this.state.platforms = this.state.platforms.filter(platform => platform.customItemId !== Number(itemId));
  },

  async createCustomActivity(activity) {
    const result = await apiRequest('/api/custom-activities', { method: 'POST', body: JSON.stringify(activity) });
    this.state.customActivities.push(result.activity);
    await this.loadIntelligence();
    return result.activity;
  },

  async updateCustomActivity(activityId, activity) {
    const result = await apiRequest(`/api/custom-activities/${encodeURIComponent(activityId)}`, { method: 'PUT', body: JSON.stringify(activity) });
    this.state.customActivities = this.state.customActivities.map(item => item.id === result.activity.id ? result.activity : item);
    await this.loadIntelligence();
    return result.activity;
  },

  async deleteCustomActivity(activityId) {
    await apiRequest(`/api/custom-activities/${encodeURIComponent(activityId)}`, { method: 'DELETE' });
    this.state.customActivities = this.state.customActivities.filter(item => item.id !== Number(activityId));
    await this.loadIntelligence();
  },

  async logCustomActivity(activityId, entry) {
    const result = await apiRequest(`/api/custom-activities/${encodeURIComponent(activityId)}/logs`, { method: 'POST', body: JSON.stringify(entry) });
    await this.loadIntelligence();
    return result.log;
  },

  async createProject(project) {
    const result = await apiRequest('/api/projects', { method: 'POST', body: JSON.stringify(project) });
    this.state.projects.push(result.project);
    await this.loadIntelligence();
    return result.project;
  },

  async updateProject(projectId, project) {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PUT', body: JSON.stringify(project) });
    this.state.projects = this.state.projects.map(item => item.id === result.project.id ? { ...item, ...result.project } : item);
    await this.loadIntelligence();
    return result.project;
  },

  async deleteProject(projectId) {
    await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    this.state.projects = this.state.projects.filter(item => item.id !== Number(projectId));
    await this.loadIntelligence();
  },

  async createProjectTask(projectId, task) {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/tasks`, { method: 'POST', body: JSON.stringify(task) });
    const project = this.state.projects.find(item => item.id === Number(projectId));
    if (project) project.tasks.push(result.task);
    await this.loadIntelligence();
    return result.task;
  },

  async updateProjectTask(projectId, taskId, task) {
    const result = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PUT', body: JSON.stringify(task) });
    const project = this.state.projects.find(item => item.id === Number(projectId));
    if (project) project.tasks = project.tasks.map(item => item.id === result.task.id ? result.task : item);
    await this.loadIntelligence();
    return result.task;
  },

  async deleteProjectTask(projectId, taskId) {
    await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    const project = this.state.projects.find(item => item.id === Number(projectId));
    if (project) project.tasks = project.tasks.filter(item => item.id !== Number(taskId));
    await this.loadIntelligence();
  },

  async createGoal(goal) {
    const result = await apiRequest('/api/goals', { method: 'POST', body: JSON.stringify(goal) });
    this.state.goals.push(result.goal);
    await this.loadIntelligence();
    return result.goal;
  },

  async updateGoal(goalId, goal) {
    const result = await apiRequest(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'PUT', body: JSON.stringify(goal) });
    this.state.goals = this.state.goals.map(item => item.id === result.goal.id ? result.goal : item);
    await this.loadIntelligence();
    return result.goal;
  },

  async deleteGoal(goalId) {
    await apiRequest(`/api/goals/${encodeURIComponent(goalId)}`, { method: 'DELETE' });
    this.state.goals = this.state.goals.filter(item => item.id !== Number(goalId));
    await this.loadIntelligence();
  },

  async addGoalProgress(goalId, amount, date, note = '') {
    const result = await apiRequest(`/api/goals/${encodeURIComponent(goalId)}/progress`, {
      method: 'POST',
      body: JSON.stringify({ amount, date, note })
    });
    this.state.goals = this.state.goals.map(item => item.id === result.goal.id ? result.goal : item);
    await this.loadIntelligence();
    return result;
  },

  async syncPlatform(platformId) {
    const platform = this.getPlatform(platformId);
    let result;
    try {
      result = await apiRequest(`/api/platforms/${encodeURIComponent(platformId)}/sync`, { method: 'POST' });
    } catch (error) {
      if (platform) { platform.syncStatus = 'error'; platform.syncError = error.message; }
      if (typeof resetSmartNotifications === 'function') resetSmartNotifications().catch(() => {});
      throw error;
    }
    if (platform) {
      platform.activityLog = result.activityLog || [];
      platform.stats = result.stats || {};
      platform.lastSyncedAt = new Date().toISOString();
      platform.syncStatus = 'success';
      platform.syncError = null;
    }
    await this.loadIntelligence();
    if (activeScreen === 'screen-dashboard') renderDashboardCards();
    return result;
  },

  async disconnectPlatform(platformId) {
    await apiRequest(`/api/platforms/${encodeURIComponent(platformId)}`, { method: 'DELETE' });
    const platform = this.getPlatform(platformId);
    if (platform) Object.assign(platform, { username: '', profileUrl: '', lastSyncedAt: null, syncStatus: 'never', syncError: null, stats: {} });
  },

  async saveManualActivity(entry) {
    const saved = await apiRequest('/api/manual-activities', { method: 'POST', body: JSON.stringify(entry) });
    this.state.manualActivities = this.state.manualActivities.filter(item => !(item.platform_id === saved.platformId && item.date === saved.date));
    this.state.manualActivities.push({ platform_id: saved.platformId, date: saved.date, amount: saved.amount, note: saved.note });
    await this.loadIntelligence();
    return saved;
  },

  async removeManualActivity(platformId, date) {
    await apiRequest(`/api/manual-activities/${encodeURIComponent(platformId)}/${encodeURIComponent(date)}`, { method: 'DELETE' });
    this.state.manualActivities = this.state.manualActivities.filter(item => !(item.platform_id === platformId && item.date === date));
    await this.loadIntelligence();
  },

  async saveSettings(settings) {
    this.state.settings = await apiRequest('/api/settings', { method: 'PUT', body: JSON.stringify(settings) });
    const frozenPlatforms = new Set(this.state.settings.frozenPlatforms || []);
    this.state.platforms.forEach(platform => { platform.frozen = frozenPlatforms.has(platform.id); });
    return this.state.settings;
  },

  async saveProfile(name) {
    const result = await apiRequest('/api/profile', { method: 'PUT', body: JSON.stringify({ name }) });
    this.profile = result.profile;
    this.state.profile = result.profile;
    return result.profile;
  },

  async changePassword(currentPassword, newPassword) {
    return apiRequest('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  },

  async setPlatformFrozen(platformId, frozen) {
    const settings = { ...(this.state.settings || {}) };
    const frozenPlatforms = new Set(settings.frozenPlatforms || []);
    const freezeHistory = { ...(settings.platformFreezeHistory || {}) };
    const ranges = [...(freezeHistory[platformId] || [])];
    if (frozen) {
      frozenPlatforms.add(platformId);
      if (!ranges.some(range => !range.to)) ranges.push({ from: todayISO(), to: null });
    } else {
      frozenPlatforms.delete(platformId);
      const openRange = ranges.findLast ? ranges.findLast(range => !range.to) : [...ranges].reverse().find(range => !range.to);
      if (openRange) openRange.to = todayISO();
    }
    settings.frozenPlatforms = [...frozenPlatforms];
    freezeHistory[platformId] = ranges;
    settings.platformFreezeHistory = freezeHistory;
    await this.saveSettings(settings);
  }
};
window.AppData = AppData;