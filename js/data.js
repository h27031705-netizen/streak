const PLATFORM_DEFINITIONS = [
  { id: 'leetcode', name: 'LeetCode', icon: '🧠', color: '#F39A35', category: 'coding', unit: 'problems', integration: 'automatic' },
  { id: 'codechef', name: 'CodeChef', icon: '🍲', color: '#A84C3D', category: 'coding', unit: 'problems', integration: 'automatic-total' },
  { id: 'codeforces', name: 'Codeforces', icon: '⚡', color: '#4388D6', category: 'coding', unit: 'problems', integration: 'automatic' },
  { id: 'atcoder', name: 'AtCoder', icon: '🎯', color: '#31465A', category: 'coding', unit: 'problems', integration: 'automatic' },
  { id: 'speakits', name: 'Speakits', icon: '🎙️', color: '#DF6B61', category: 'session', unit: 'sessions', integration: 'manual' },
  { id: 'duolingo', name: 'Duolingo', icon: '🦉', color: '#59B847', category: 'language', unit: 'XP', integration: 'manual' },
  { id: 'dsa-ideas', name: 'DSA Ideas', icon: '💡', color: '#D99A32', category: 'ideas', unit: 'ideas', integration: 'manual' }
];

function createEmptyState() {
  return {
    profile: null,
    platforms: PLATFORM_DEFINITIONS.map(platform => ({ ...platform, username: '', profileUrl: '', activityLog: [], stats: {}, syncStatus: 'never' })),
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

  async authenticate(mode, email, password) {
    const result = await apiRequest(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    this.profile = result.profile;
    await this.hydrate();
    return result.profile;
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

  async syncPlatform(platformId) {
    const result = await apiRequest(`/api/platforms/${encodeURIComponent(platformId)}/sync`, { method: 'POST' });
    const platform = this.getPlatform(platformId);
    if (platform) {
      platform.activityLog = result.activityLog || [];
      platform.stats = result.stats || {};
      platform.lastSyncedAt = new Date().toISOString();
      platform.syncStatus = 'success';
      platform.syncError = null;
    }
    if (activeScreen === 'screen-dashboard') renderDashboardCards();
    return result;
  },

  async saveManualActivity(entry) {
    const saved = await apiRequest('/api/manual-activities', { method: 'POST', body: JSON.stringify(entry) });
    this.state.manualActivities = this.state.manualActivities.filter(item => !(item.platform_id === saved.platformId && item.date === saved.date));
    this.state.manualActivities.push({ platform_id: saved.platformId, date: saved.date, amount: saved.amount, note: saved.note });
    return saved;
  },

  async removeManualActivity(platformId, date) {
    await apiRequest(`/api/manual-activities/${encodeURIComponent(platformId)}/${encodeURIComponent(date)}`, { method: 'DELETE' });
    this.state.manualActivities = this.state.manualActivities.filter(item => !(item.platform_id === platformId && item.date === date));
  },

  async saveSettings(settings) {
    this.state.settings = await apiRequest('/api/settings', { method: 'PUT', body: JSON.stringify(settings) });
    return this.state.settings;
  }
};