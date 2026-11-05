function renderDashboardCards() {
  const container = document.getElementById('platform-cards');
  if (!container) return;
  container.innerHTML = '';
  const platforms = AppData.getPlatforms();
  refreshPendingNotifications();
  renderDashboardOverview(platforms);
  renderDashboardFocus();
  renderDashboardInsights();
  renderMotivation();
  initializeSmartNotifications().catch(error => console.error('Could not initialize reminders:', error));
  renderDashboardSummary();
  renderPeriodSummary();
  renderDateTracker();
  renderDashboardChart();

  let currentGroup = '';
  platforms.forEach(platform => {
    const group = platform.category === 'coding' ? 'Competitive / coding platforms' : 'Learning & manual tracks';
    if (group !== currentGroup) {
      container.appendChild(el('h3', 'platform-group-heading', group));
      currentGroup = group;
    }
    const stats = getPlatformStats(platform);
    const isCoding = platform.category === 'coding';
    const connected = Boolean(platform.username);
    const valueLabel = platform.customItemId ? 'activities' : platform.id === 'speakits' ? 'sessions' : platform.id === 'duolingo' ? 'XP' : platform.id === 'dsa-ideas' ? 'ideas' : 'problems';
    const logAction = isManualActivityPlatform(platform)
      ? `<button type="button" class="platform-log-button" data-log="${escapeHtml(platform.id)}">+ Log ${platform.id === 'speakits' ? 'session' : 'activity'}</button>`
      : '';
    const card = el('article', 'card platform-card');
    card.style.setProperty('--platform-color', platform.color);
    const todayValue = platformAmount(platform, todayISO());
    const weeklyDays = platformWeeklyDays(platform);
    const monthlyValue = platformPeriodTotal(platform, `${monthKey()}-01`);
    card.innerHTML = `<button class="platform-card-main" type="button" aria-label="Open ${escapeHtml(platform.name)} details">
      <div class="platform-card-top"><div class="platform-icon">${platform.icon}</div><div class="platform-info"><h3>${escapeHtml(platform.name)}</h3><span class="platform-connection">${isCoding ? (connected ? `Connected · ${escapeHtml(platform.username)}` : 'Profile not connected') : platform.customItemId ? escapeHtml(platform.itemType) : platform.id === 'speakits' ? 'Session check-ins' : platform.id === 'duolingo' ? 'Manual XP log' : 'Personal progress'}</span></div><span class="platform-state ${platform.frozen ? 'is-frozen' : ''}">${platform.frozen ? '❄ Frozen' : '● Active'}</span><span class="card-arrow">↗</span></div>
      <div class="platform-card-stats"><div><strong>${Number(stats.total).toLocaleString()}</strong><span>Total ${valueLabel}</span></div><div><strong>${todayValue.toLocaleString()}</strong><span>${platform.id === 'duolingo' ? 'XP today' : 'Today'}</span></div><div><strong>${stats.currentStreak}</strong><span>day streak</span></div></div>
      <div class="platform-week"><span>Week · ${weeklyDays}/7 active days</span><strong>Month · ${monthlyValue.toLocaleString()} ${platform.id === 'duolingo' ? 'XP' : valueLabel}</strong></div>
      <div class="progress-track" aria-label="${weeklyDays} active days this week"><span style="width:${Math.round(weeklyDays / 7 * 100)}%;background:${platform.color}"></span></div>
    </button>${logAction}`;
    card.querySelector('.platform-card-main').addEventListener('click', () => openPlatformDetail(platform.id));
    card.querySelector('[data-log]')?.addEventListener('click', event => {
      event.stopPropagation();
      openActivityDialog(platform.id);
    });
    container.appendChild(card);
  });
}

function platformWeeklyDays(platform) {
  const dates = new Set();
  platform.activityLog.forEach(entry => {
    const age = daysBetween(entry.date, todayISO());
    if (age >= 0 && age <= 6 && entry.problemsSolved) dates.add(entry.date);
  });
  AppData.state.manualActivities.filter(entry => entry.platform_id === platform.id).forEach(entry => {
    const age = daysBetween(entry.date, todayISO());
    if (age >= 0 && age <= 6 && Number(entry.amount) > 0) dates.add(entry.date);
  });
  return dates.size;
}

function renderDashboardOverview(platforms) {
  const overview = document.getElementById('dashboard-overview');
  if (!overview) return;
  const today = todayISO();
  const activePlatforms = platforms.filter(platform => !platform.frozen);
  const activeToday = activePlatforms.filter(platform => platformAmount(platform, today) > 0).length;
  const totals = platforms.reduce((summary, platform) => {
    const stats = getPlatformStats(platform);
    summary.problems += platform.category === 'coding' ? stats.total : 0;
    summary.streak = Math.max(summary.streak, stats.currentStreak);
    summary.activeDays = Math.max(summary.activeDays, stats.activeDays);
    return summary;
  }, { problems: 0, streak: 0, activeDays: 0 });
  const greetingDate = new Date(`${today}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  overview.innerHTML = `<div class="overview-copy"><span class="eyebrow">${greetingDate.toUpperCase()}</span><h1>Your practice<br><em>adds up.</em></h1><p>${activeToday ? `${activeToday} of ${activePlatforms.length} active tracks completed today.` : activePlatforms.length ? 'A small session today keeps the rhythm going.' : 'All tracks are frozen. Unfreeze one when you are ready.'}</p></div>
    <div class="overview-orbit"><span>✳</span><strong>${totals.streak}</strong><small>best streak</small></div>
    <div class="overview-stats"><span><strong>${totals.problems.toLocaleString()}</strong> coding problems</span><span><strong>${activeToday}/${activePlatforms.length}</strong> tracks today</span><span><strong>${platforms.filter(platform => platform.frozen).length}</strong> frozen</span></div>`;
}

function renderDashboardFocus() {
  const container = document.getElementById('dashboard-focus');
  if (!container) return;
  const platforms = AppData.getPlatforms();
  const active = platforms.filter(platform => !platform.frozen);
  const frozen = platforms.filter(platform => platform.frozen);
  const manual = active.filter(isManualTrackingPlatform);
  const connectedTracks = active.filter(platform => !isManualTrackingPlatform(platform));
  const doneToday = active.filter(platform => platformAmount(platform, todayISO()) > 0);
  const activeDays = platforms.reduce((sum, platform) => sum + getPlatformStats(platform).activeDays, 0);
  const level = Math.floor(activeDays / 25) + 1;
  const weekCount = platforms.reduce((sum, platform) => sum + platformWeeklyDays(platform), 0);
  const longestStreak = platforms.reduce((best, platform) => Math.max(best, getPlatformStats(platform).longestStreak), 0);
  const codingDone = platforms.some(platform => platform.category === 'coding' && getPlatformStats(platform).activeDays > 0);
  const achievements = [
    { label: 'Daily goal', icon: '✓', earned: active.length > 0 && doneToday.length === active.length },
    { label: '7-day streak', icon: '🔥', earned: longestStreak >= 7 },
    { label: '30-day streak', icon: '💎', earned: longestStreak >= 30 },
    { label: 'Multi-platform', icon: '✳', earned: doneToday.length >= 2 },
    { label: 'Coding rhythm', icon: '⌘', earned: codingDone },
    { label: 'Weekly goal', icon: '🎯', earned: weekCount >= 5 }
  ];
  const statusLine = list => list.length ? list.map(platform => `<span class="focus-platform"><i style="--focus-color:${platform.color}"></i>${escapeHtml(platform.name)}</span>`).join('') : '<span class="focus-empty">None</span>';
  container.innerHTML = `<div class="focus-status card"><div class="focus-status-heading"><div><p class="eyebrow">TODAY'S FOCUS</p><h2>${doneToday.length}/${active.length} completed</h2></div><div class="focus-level"><strong>${level}</strong><small>level</small></div></div><div class="focus-status-group"><span>ACTIVE</span><div>${statusLine(connectedTracks)}</div></div><div class="focus-status-group"><span>MANUAL</span><div>${statusLine(manual)}</div></div><div class="focus-status-group"><span>FROZEN</span><div>${statusLine(frozen)}</div></div><p class="focus-week">${weekCount} platform-days this week · ${activeDays} points</p></div>
    <div class="focus-rewards card"><div class="focus-rewards-heading"><div><p class="eyebrow">CONSISTENCY REWARDS</p><h2>Achievements</h2></div><span>${activeDays} pts</span></div><div class="achievement-list">${achievements.map(item => `<div class="achievement ${item.earned ? 'is-earned' : ''}" title="${item.earned ? 'Achievement earned' : 'Keep practicing to unlock'}"><span>${item.icon}</span><small>${item.label}</small></div>`).join('')}</div></div>`;
}
function renderManagePlatforms
() {
  const container = document.getElementById('ap-content');
  container.innerHTML = `<nav class="manager-tabs" role="tablist" aria-label="Manage StreakForce items">
      <button type="button" role="tab" data-manager-tab="platforms">Platforms</button><button type="button" role="tab" data-manager-tab="activities">Activities</button><button type="button" role="tab" data-manager-tab="projects">Projects</button><button type="button" role="tab" data-manager-tab="goals">Goals</button><button type="button" role="tab" data-manager-tab="history">History</button>
    </nav>
    <section id="manager-panel-platforms" class="manager-panel">
    <p class="manage-intro">Connect public coding profiles where supported. Your manual learning logs stay private to your account.</p>
    <div id="manage-platform-grid" class="manage-platform-grid" aria-label="Managed platforms"></div>
    <section class="catalog-manager" aria-labelledby="catalog-manager-title">
      <div class="catalog-manager-heading"><div><h3 id="catalog-manager-title">Your additional items</h3><p>Clients, apps, platforms, services, projects, and integrations you add here are saved to your account.</p></div><button id="catalog-add-toggle" class="btn-primary" type="button">+ Add item</button></div>
      <form id="catalog-item-form" class="ap-form catalog-form" hidden>
        <strong id="catalog-form-title">Add an item</strong>
        <label for="catalog-item-type">Type</label><select id="catalog-item-type" required><option value="client">Client</option><option value="app">App</option><option value="platform">Platform</option><option value="service">Service</option><option value="project">Project</option><option value="integration">Integration</option></select>
        <label for="catalog-item-name">Name</label><input id="catalog-item-name" type="text" maxlength="80" required>
        <div id="catalog-platform-fields" hidden><label for="catalog-item-username">Username / Profile ID</label><input id="catalog-item-username" type="text" maxlength="180" autocomplete="off" placeholder="Public account name" disabled></div>
        <label for="catalog-item-description">Description</label><textarea id="catalog-item-description" maxlength="1000" rows="2"></textarea>
        <label for="catalog-item-category">Category</label><input id="catalog-item-category" type="text" maxlength="80" placeholder="Optional category">
        <label for="catalog-item-platform-app">Platform / app used</label><input id="catalog-item-platform-app" type="text" maxlength="180" placeholder="Optional, useful for client records">
        <label id="catalog-item-url-label" for="catalog-item-url">URL</label><input id="catalog-item-url" type="url" placeholder="https://example.com">
        <label for="catalog-item-status">Status</label><select id="catalog-item-status"><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <div class="catalog-form-actions"><button class="btn-primary" type="submit">Save item</button><button id="catalog-item-cancel" class="btn-secondary" type="button">Cancel</button></div>
        <p id="catalog-item-status-message" class="connection-status" role="status"></p>
      </form>
      <h3 class="catalog-list-heading">Other saved items</h3>
      <div id="catalog-items-list" class="catalog-items-list"></div>
    </section></section>
    <section id="manager-panel-activities" class="manager-panel" hidden><div id="activities-manager-content"></div></section>
    <section id="manager-panel-projects" class="manager-panel" hidden><div id="projects-manager-content"></div></section>
    <section id="manager-panel-goals" class="manager-panel" hidden><div id="goals-manager-content"></div></section>
    <section id="manager-panel-history" class="manager-panel" hidden><div id="history-manager-content"></div></section>`;

  const form = container.querySelector('#catalog-item-form');
  const addButton = container.querySelector('#catalog-add-toggle');
  const typeSelect = container.querySelector('#catalog-item-type');
  const platformFields = container.querySelector('#catalog-platform-fields');
  const usernameInput = container.querySelector('#catalog-item-username');
  const updateTypeFields = () => {
    const isPlatform = typeSelect.value === 'platform';
    platformFields.hidden = !isPlatform;
    usernameInput.disabled = !isPlatform;
    usernameInput.required = isPlatform;
    container.querySelector('#catalog-item-url-label').textContent = isPlatform ? 'Profile URL' : 'URL';
    container.querySelector('#catalog-item-url').placeholder = isPlatform ? 'Generated for supported platforms, or enter a URL' : 'https://example.com';
  };
  typeSelect.addEventListener('change', updateTypeFields);
  updateTypeFields();
  const finishEditing = () => {
    form.reset();
    delete form.dataset.itemId;
    form.hidden = true;
    container.querySelector('#catalog-form-title').textContent = 'Add an item';
    form.querySelector('[type="submit"]').textContent = 'Save item';
    container.querySelector('#catalog-item-cancel').hidden = true;
    container.querySelector('#catalog-item-status-message').textContent = '';
    addButton.hidden = false;
  };
  addButton.addEventListener('click', () => {
    form.hidden = false;
    addButton.hidden = true;
    container.querySelector('#catalog-item-name').focus();
  });
  container.querySelector('#catalog-item-cancel').addEventListener('click', finishEditing);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const saveButton = form.querySelector('[type="submit"]');
    const status = container.querySelector('#catalog-item-status-message');
    const item = {
      itemType: container.querySelector('#catalog-item-type').value,
      name: container.querySelector('#catalog-item-name').value.trim(),
      username: container.querySelector('#catalog-item-username').value.trim(),
      description: container.querySelector('#catalog-item-description').value.trim(),
      category: container.querySelector('#catalog-item-category').value.trim(),
      platformApp: container.querySelector('#catalog-item-platform-app').value.trim(),
      url: container.querySelector('#catalog-item-url').value.trim(),
      status: container.querySelector('#catalog-item-status').value
    };
    saveButton.disabled = true;
    status.textContent = 'Saving…';
    try {
      const editingId = form.dataset.itemId;
      const saved = editingId ? await AppData.updateCatalogItem(editingId, item) : await AppData.createCatalogItem(item);
      finishEditing();
      renderManagePlatforms();
      renderDashboardCards();
      renderDateTracker();
      renderDashboardChart();
      showToast(`${saved.name} ${editingId ? 'updated' : 'added'}.`);
    } catch (error) {
      status.textContent = error.message;
    } finally { saveButton.disabled = false; }
  });

  AppData.getPlatforms().filter(platform => !platform.customItemId).forEach(platform => {
    const card = el('article', 'manage-platform');
    const isCoding = platform.category === 'coding';
    const manualFallback = platform.id === 'codechef';
    const supportsSync = ['leetcode', 'codechef', 'codeforces', 'atcoder'].includes(platform.id);
    const unit = platform.id === 'duolingo' ? 'XP' : platform.id === 'dsa-ideas' ? 'ideas' : platform.id === 'speakits' ? 'sessions' : 'problems';
    const savedPlatformInfo = AppData.state.settings.platformProfiles?.[platform.id] || '';
    card.innerHTML = `<div class="manage-platform-heading"><div class="platform-icon" style="--platform-color:${platform.color}">${platform.icon}</div><div><h3>${escapeHtml(platform.name)}</h3><p>${isCoding ? (platform.id === 'codechef' ? 'Public profile · lifetime total sync' : 'Public profile · activity sync') : platform.id === 'speakits' ? 'Manual session tracking' : platform.id === 'duolingo' ? 'Manual XP tracking' : 'Manual activity tracking'}</p></div><span class="platform-status-badge ${platform.frozen ? 'is-inactive' : 'is-active'}">${platform.frozen ? 'Inactive' : 'Active'}</span></div>
      ${isCoding ? `<div class="connection-form"><label for="connect-${platform.id}">Username / Profile ID</label><div class="connection-controls"><input id="connect-${platform.id}" type="text" value="${escapeHtml(platform.username || '')}" placeholder="Enter ${platform.name} username" autocomplete="off"><button type="button" class="btn-connect">${platform.username ? (supportsSync ? 'Update & sync' : 'Update') : (supportsSync ? 'Connect & sync' : 'Connect')}</button></div><p class="platform-account-name" ${platform.username ? '' : 'hidden'}>Username: <strong>${escapeHtml(platform.username || '')}</strong></p><div class="connection-status" role="status">${platform.syncStatus === 'error' ? `Unable to sync. Please check the account/profile. ${escapeHtml(platform.syncError || '')}` : platform.lastSyncedAt ? `Connected · Last synced: ${formatDateLabel(platform.lastSyncedAt)}${platform.stats?.scope ? ` · ${escapeHtml(platform.stats.scope)}` : ''}` : platform.username ? 'Connected. Public profile data has not been synced yet.' : 'Only public profile information is used. No platform password is needed.'}</div></div>` : ''}
      ${platform.id === 'speakits' ? `<div class="connection-form"><label for="speak-profile-info">Speak / SpeakIt user ID or profile information</label><div class="connection-controls"><input id="speak-profile-info" type="text" value="${escapeHtml(savedPlatformInfo)}" maxlength="180" placeholder="Optional profile reference"><button type="button" class="btn-connect save-speak-profile">Save</button></div><div class="connection-status">Saved as a reference only. No reliable public progress API is available, so sessions remain manual.</div></div>` : ''}
      <div class="manage-platform-footer"><span class="sync-label ${platform.syncStatus === 'success' ? 'is-synced' : platform.syncStatus === 'error' ? 'is-error' : ''}">${supportsSync ? (platform.syncStatus === 'success' ? `Synced · ${formatDateLabel(platform.lastSyncedAt)}` : platform.syncStatus === 'error' ? 'Unable to sync' : 'Not synced') : manualFallback ? 'Manual entry available' : 'Manual tracking'}</span><div class="manage-platform-actions">${platform.username && (platform.profileUrl || getProfileUrl(platform.id, platform.username)) ? `<a class="btn-secondary" href="${escapeHtml(platform.profileUrl || getProfileUrl(platform.id, platform.username))}" target="_blank" rel="noopener noreferrer">Open Profile</a>` : ''}<button type="button" class="btn-secondary platform-freeze">${platform.frozen ? 'Unfreeze' : 'Freeze'}</button>${platform.id === 'codechef' || !isCoding ? `<button type="button" class="btn-secondary manage-log">+ Log ${platform.id === 'speakits' ? 'session' : 'activity'}</button>` : platform.username ? `<button type="button" class="btn-secondary manage-sync">Sync</button>` : ''}${isCoding && platform.username ? '<button type="button" class="btn-secondary manage-disconnect">Disconnect</button>' : ''}</div></div>
      ${manualFallback ? '<p class="integration-note">The public profile provides a lifetime total. It does not expose reliable dated submissions, so daily counts are an optional manual fallback and do not replace the synced lifetime total.</p>' : platform.id === 'duolingo' ? '<p class="integration-note">Duolingo has no supported public progress API for this app. Add XP manually; no third-party credentials are requested.</p>' : ''}`;

    const connectButton = card.querySelector('.btn-connect:not(.save-speak-profile)');
    connectButton?.addEventListener('click', async () => {
      const username = card.querySelector('input').value.trim();
      const status = card.querySelector('.connection-status');
      if (!username) { status.textContent = 'Enter a profile username first.'; return; }
      connectButton.disabled = true;
      connectButton.textContent = 'Connecting…';
      status.textContent = 'Connecting…';
      try {
        await AppData.connectPlatform(platform.id, username, getProfileUrl(platform.id, username));
        if (supportsSync) {
          connectButton.textContent = 'Syncing…';
          status.textContent = 'Connected. Syncing public profile data…';
          const result = await AppData.syncPlatform(platform.id);
          showToast(platform.id === 'codechef' ? `CodeChef synced: ${result.stats.totalSolved.toLocaleString()} lifetime problems.` : `${platform.name} synced. ${result.imported} activity records checked.`);
        } else {
          showToast(`${platform.name} connected.`);
        }
        renderManagePlatforms();
        renderDashboardCards();
      } catch (error) {
        status.textContent = supportsSync ? `Unable to sync. Please check the account/profile. ${error.message}` : error.message;
        showToast(`${platform.name} could not be connected: ${error.message}`, 'error');
        platform.syncStatus = 'error';
        platform.syncError = error.message;
        renderManagePlatforms();
        renderDashboardCards();
      } finally {
        connectButton.disabled = false;
      }
    });
    card.querySelector('.manage-sync')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Syncing…';
      const status = card.querySelector('.connection-status');
      if (status) status.textContent = 'Syncing…';
      try {
        const result = await AppData.syncPlatform(platform.id);
        showToast(platform.id === 'codechef' ? `CodeChef synced: ${result.stats.totalSolved.toLocaleString()} lifetime problems.` : `${platform.name} synced. ${result.imported} activity records checked.`);
        renderManagePlatforms();
        renderDashboardCards();
      } catch (error) {
        platform.syncStatus = 'error';
        platform.syncError = error.message;
        if (status) status.textContent = `Unable to sync. Please check the account/profile. ${error.message}`;
        showToast(`${platform.name} sync failed: ${error.message}`, 'error');
        renderManagePlatforms();
      } finally { button.disabled = false; }
    });
    card.querySelector('.manage-log')?.addEventListener('click', () => openActivityDialog(platform.id));
    card.querySelector('.save-speak-profile')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const settings = AppData.state.settings || {};
        await AppData.saveSettings({ ...settings, platformProfiles: { ...(settings.platformProfiles || {}), [platform.id]: card.querySelector('#speak-profile-info').value.trim() } });
        showToast('Speak profile information saved. Progress remains manual.');
      } catch (error) { showToast(`Profile information could not be saved: ${error.message}`, 'error'); }
      finally { button.disabled = false; }
    });
    card.querySelector('.platform-freeze')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const nextFrozen = !platform.frozen;
        await AppData.setPlatformFrozen(platform.id, nextFrozen);
        await resetSmartNotifications();
        showToast(`${platform.name} ${nextFrozen ? 'frozen' : 'unfrozen'}.`);
        renderManagePlatforms();
        renderDashboardCards();
      } catch (error) {
        showToast(`Platform status could not be saved: ${error.message}`, 'error');
        button.disabled = false;
      }
    });
    card.querySelector('.manage-disconnect')?.addEventListener('click', async event => {
      if (!window.confirm(`Disconnect ${platform.name}? Your saved activity will remain.`)) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await AppData.disconnectPlatform(platform.id);
        showToast(`${platform.name} disconnected. Saved activity was kept.`);
        renderManagePlatforms();
        renderDashboardCards();
      } catch (error) {
        showToast(`Could not disconnect ${platform.name}: ${error.message}`, 'error');
        button.disabled = false;
      }
    });
    container.querySelector('#manage-platform-grid').appendChild(card);
  });
  renderCatalogItemsList(container);
  selectManagerPanel(container.dataset.activePanel || 'platforms');
}

function renderCatalogItemsList(container) {
  const list = container.querySelector('#catalog-items-list');
  const items = AppData.state.customItems || [];
  const platformGrid = container.querySelector('#manage-platform-grid');
  const platformItems = items.filter(item => item.itemType === 'platform');
  platformGrid.insertAdjacentHTML('beforeend', platformItems.map(item => {
    const platform = AppData.getPlatform(`custom-${item.id}`);
    const icon = '🧩';
    return `<article class="manage-platform custom-platform-card">
      <div class="manage-platform-heading"><div class="platform-icon">${icon}</div><div><h3>${escapeHtml(item.name)}</h3><p>Custom platform · Manual tracking</p></div><span class="platform-status-badge ${item.status === 'active' ? 'is-active' : 'is-inactive'}">${escapeHtml(item.status)}</span></div>
      <div class="custom-platform-account"><span>Username / Profile ID</span><strong>${escapeHtml(catalogPlatformUsername(item) || 'Not set')}</strong></div>
      ${item.description ? `<p class="catalog-item-description">${escapeHtml(item.description)}</p>` : ''}
      <div class="manage-platform-footer"><span class="sync-label">Public sync not configured</span><div class="manage-platform-actions">${item.url ? `<a class="btn-secondary" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open Profile</a>` : ''}${item.status === 'active' && platform ? `<button type="button" class="btn-secondary manage-log" data-log-custom="${Number(item.id)}">+ Log activity</button>` : ''}<button class="btn-secondary" type="button" data-catalog-edit="${Number(item.id)}">Edit</button><button class="btn-secondary catalog-delete" type="button" data-catalog-delete="${Number(item.id)}">Delete</button></div></div>
    </article>`;
  }).join(''));

  const otherItems = items.filter(item => item.itemType !== 'platform');
  container.querySelector('.catalog-list-heading').hidden = !otherItems.length;
  if (!otherItems.length) {
    list.innerHTML = '<p class="catalog-empty">No additional items yet.</p>';
    list.hidden = true;
  } else {
    list.hidden = false;
    list.innerHTML = otherItems.map(item => {
      const icon = ({ client: '🏢', app: '▣', service: '⚙', project: '◩', integration: '↗' })[item.itemType] || '◆';
      const itemDetails = [item.itemType, item.category, item.platformApp && `Uses ${item.platformApp}`, item.status].filter(Boolean).map(escapeHtml).join(' · ');
      return `<article class="manage-platform catalog-item"><div class="manage-platform-heading"><div class="platform-icon">${icon}</div><div><h3>${escapeHtml(item.name)}</h3><p>${itemDetails}</p></div></div>${item.description ? `<p class="catalog-item-description">${escapeHtml(item.description)}</p>` : ''}${item.url ? `<a class="catalog-item-url" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}<div class="catalog-item-actions"><button class="btn-secondary" type="button" data-catalog-edit="${Number(item.id)}">Edit</button><button class="btn-secondary catalog-delete" type="button" data-catalog-delete="${Number(item.id)}">Delete</button></div></article>`;
    }).join('');
  }

  bindCatalogItemActions(container, platformGrid, items);
  bindCatalogItemActions(container, list, items);
  platformGrid.querySelectorAll('[data-log-custom]').forEach(button => button.addEventListener('click', () => openActivityDialog(`custom-${button.dataset.logCustom}`)));
}

function bindCatalogItemActions(container, root, items) {
  root.querySelectorAll('[data-catalog-edit]').forEach(button => button.addEventListener('click', () => {
    const item = items.find(entry => entry.id === Number(button.dataset.catalogEdit));
    if (!item) return;
    const form = container.querySelector('#catalog-item-form');
    form.dataset.itemId = String(item.id);
    container.querySelector('#catalog-item-type').value = item.itemType;
    container.querySelector('#catalog-item-type').dispatchEvent(new Event('change'));
    container.querySelector('#catalog-item-name').value = item.name;
    container.querySelector('#catalog-item-username').value = catalogPlatformUsername(item);
    container.querySelector('#catalog-item-description').value = item.description || '';
    container.querySelector('#catalog-item-category').value = item.category || '';
    container.querySelector('#catalog-item-platform-app').value = item.platformApp || '';
    container.querySelector('#catalog-item-url').value = item.url || '';
    container.querySelector('#catalog-item-status').value = item.status;
    container.querySelector('#catalog-form-title').textContent = 'Edit item';
    form.querySelector('[type="submit"]').textContent = 'Update item';
    container.querySelector('#catalog-item-cancel').hidden = false;
    container.querySelector('#catalog-add-toggle').hidden = true;
    form.hidden = false;
    container.querySelector('#catalog-item-name').focus();
  }));
  root.querySelectorAll('[data-catalog-delete]').forEach(button => button.addEventListener('click', async () => {
    const item = items.find(entry => entry.id === Number(button.dataset.catalogDelete));
    if (!item || !window.confirm(`Delete ${item.name}? Its existing activity history will be kept.`)) return;
    button.disabled = true;
    try {
      await AppData.deleteCatalogItem(item.id);
      renderManagePlatforms();
      renderDashboardCards();
      renderDateTracker();
      renderDashboardChart();
      showToast(`${item.name} deleted.`);
    } catch (error) {
      button.disabled = false;
      showToast(`Could not delete ${item.name}: ${error.message}`, 'error');
    }
  }));
}

function catalogPlatformUsername(item) {
  if (item.username) return item.username;
  if (item.itemType !== 'platform' || !item.url) return '';
  try {
    const segments = new URL(item.url).pathname.split('/').filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] || '');
  } catch { return ''; }
}

function getProfileUrl(platformId, username) {
  const encoded = encodeURIComponent(username);
  if (platformId === 'leetcode') return `https://leetcode.com/u/${encoded}/`;
  if (platformId === 'codeforces') return `https://codeforces.com/profile/${encoded}`;
  if (platformId === 'atcoder') return `https://atcoder.jp/users/${encoded}`;
  if (platformId === 'codechef') return `https://www.codechef.com/users/${encoded}`;
  return '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}