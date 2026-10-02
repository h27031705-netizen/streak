function renderDashboardCards() {
  const container = document.getElementById('platform-cards');
  if (!container) return;
  container.innerHTML = '';
  const platforms = AppData.getPlatforms();
  refreshPendingNotifications();
  renderDashboardOverview(platforms);
  renderDashboardFocus();
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
    const valueLabel = platform.id === 'speakits' ? 'sessions' : platform.id === 'duolingo' ? 'XP' : platform.id === 'dsa-ideas' ? 'ideas' : 'problems';
    const logAction = MANUAL_PLATFORM_IDS.includes(platform.id)
      ? `<button type="button" class="platform-log-button" data-log="${platform.id}">+ Log ${platform.id === 'speakits' ? 'session' : 'activity'}</button>`
      : '';
    const card = el('article', 'card platform-card');
    card.style.setProperty('--platform-color', platform.color);
    const todayValue = platformAmount(platform, todayISO());
    const weeklyDays = platformWeeklyDays(platform);
    const monthlyValue = platformPeriodTotal(platform, `${monthKey()}-01`);
    card.innerHTML = `<button class="platform-card-main" type="button" aria-label="Open ${platform.name} details">
      <div class="platform-card-top"><div class="platform-icon">${platform.icon}</div><div class="platform-info"><h3>${platform.name}</h3><span class="platform-connection">${isCoding ? (connected ? `Connected · ${escapeHtml(platform.username)}` : 'Profile not connected') : platform.id === 'speakits' ? 'Session check-ins' : platform.id === 'duolingo' ? 'Manual XP log' : 'Personal progress'}</span></div><span class="platform-state ${platform.frozen ? 'is-frozen' : ''}">${platform.frozen ? '❄ Frozen' : '● Active'}</span><span class="card-arrow">↗</span></div>
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
  const manual = active.filter(platform => MANUAL_TRACKING_IDS.includes(platform.id));
  const connectedTracks = active.filter(platform => !MANUAL_TRACKING_IDS.includes(platform.id));
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

function renderManagePlatforms() {
  const container = document.getElementById('ap-content');
  container.innerHTML = `<p class="manage-intro">Connect public coding profiles where supported. Your manual learning logs stay private to your account.</p>`;
  AppData.getPlatforms().forEach(platform => {
    const card = el('article', 'manage-platform');
    const isCoding = platform.category === 'coding';
    const manualFallback = platform.id === 'codechef';
    const supportsSync = ['leetcode', 'codechef', 'codeforces', 'atcoder'].includes(platform.id);
    const unit = platform.id === 'duolingo' ? 'XP' : platform.id === 'dsa-ideas' ? 'ideas' : platform.id === 'speakits' ? 'sessions' : 'problems';
    const savedPlatformInfo = AppData.state.settings.platformProfiles?.[platform.id] || '';
    card.innerHTML = `<div class="manage-platform-heading"><div class="platform-icon" style="--platform-color:${platform.color}">${platform.icon}</div><div><h3>${platform.name}</h3><p>${isCoding ? (platform.id === 'codechef' ? 'Public lifetime total sync · dated history limited' : supportsSync ? 'Public activity sync' : 'Manual count · no supported public API') : platform.id === 'speakits' ? 'One completed session per date' : platform.id === 'duolingo' ? 'Manual progress · no supported public API' : 'Manual count with optional notes'}</p></div><span class="manage-unit">${unit}</span></div>
      ${isCoding ? `<div class="connection-form"><label for="connect-${platform.id}">Username / profile ID</label><div class="connection-controls"><input id="connect-${platform.id}" type="text" value="${escapeHtml(platform.username || '')}" placeholder="Enter your ${platform.name} username" autocomplete="off"><button type="button" class="btn-connect">${platform.id === 'codechef' ? (platform.username ? 'Update & sync' : 'Connect & sync') : (platform.username ? 'Update' : 'Connect')}</button></div><div class="connection-status" role="status">${platform.lastSyncedAt ? `Last synced ${formatDateLabel(platform.lastSyncedAt)}${platform.stats?.scope ? ` · ${escapeHtml(platform.stats.scope)}` : ''}` : platform.id === 'codechef' ? 'Lifetime total syncs automatically from your public profile; daily history is not publicly available.' : 'Only public profile activity is requested. No platform password is needed.'}</div></div>` : ''}
      ${platform.id === 'speakits' ? `<div class="connection-form"><label for="speak-profile-info">Speak / SpeakIt user ID or profile information</label><div class="connection-controls"><input id="speak-profile-info" type="text" value="${escapeHtml(savedPlatformInfo)}" maxlength="180" placeholder="Optional profile reference"><button type="button" class="btn-connect save-speak-profile">Save</button></div><div class="connection-status">Saved as a reference only. No reliable public progress API is available, so sessions remain manual.</div></div>` : ''}
      <div class="manage-platform-footer"><span class="sync-label ${platform.syncStatus === 'success' ? 'is-synced' : ''}">${supportsSync ? (platform.syncStatus === 'success' ? '● Synced' : platform.syncStatus === 'error' ? '● Sync needs attention' : '○ Not synced') : manualFallback ? 'Manual entry available' : 'Manual tracking'}</span><div class="manage-platform-actions"><button type="button" class="btn-secondary platform-freeze">${platform.frozen ? 'Unfreeze' : 'Freeze'}</button>${platform.id === 'codechef' || !isCoding ? `<button type="button" class="btn-secondary manage-log">+ Log ${platform.id === 'speakits' ? 'session' : 'activity'}</button>` : platform.username ? `<button type="button" class="btn-secondary manage-sync">↻ Sync now</button>` : ''}${isCoding && platform.username ? '<button type="button" class="btn-secondary manage-disconnect">Disconnect</button>' : ''}</div></div>
      ${manualFallback ? '<p class="integration-note">The public profile provides a lifetime total. It does not expose reliable dated submissions, so daily counts are an optional manual fallback and do not replace the synced lifetime total.</p>' : platform.id === 'duolingo' ? '<p class="integration-note">Duolingo has no supported public progress API for this app. Add XP manually; no third-party credentials are requested.</p>' : ''}`;

    const connectButton = card.querySelector('.btn-connect:not(.save-speak-profile)');
    connectButton?.addEventListener('click', async () => {
      const username = card.querySelector('input').value.trim();
      const status = card.querySelector('.connection-status');
      if (!username) { status.textContent = 'Enter a profile username first.'; return; }
      connectButton.disabled = true;
      status.textContent = supportsSync ? 'Connecting and syncing public activity…' : 'Saving profile…';
      try {
        await AppData.connectPlatform(platform.id, username, getProfileUrl(platform.id, username));
        if (supportsSync) {
          const result = await AppData.syncPlatform(platform.id);
          showToast(platform.id === 'codechef' ? `CodeChef synced: ${result.stats.totalSolved.toLocaleString()} lifetime problems.` : `${platform.name} synced. ${result.imported} activity records checked.`);
        } else {
          showToast('CodeChef profile saved.');
        }
        renderManagePlatforms();
        renderDashboardCards();
      } catch (error) {
        status.textContent = error.message;
        showToast(`${platform.name} connection or sync failed: ${error.message}`, 'error');
        platform.syncStatus = 'error';
        platform.syncError = error.message;
        renderDashboardCards();
      } finally {
        connectButton.disabled = false;
      }
    });
    card.querySelector('.manage-sync')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await AppData.syncPlatform(platform.id);
        showToast(platform.id === 'codechef' ? `CodeChef synced: ${result.stats.totalSolved.toLocaleString()} lifetime problems.` : `${platform.name} synced. ${result.imported} activity records checked.`);
        renderManagePlatforms();
        renderDashboardCards();
      } catch (error) {
        platform.syncStatus = 'error';
        platform.syncError = error.message;
        const status = card.querySelector('.connection-status');
        if (status) status.textContent = error.message;
        showToast(`${platform.name} sync failed: ${error.message}`, 'error');
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
    container.appendChild(card);
  });
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