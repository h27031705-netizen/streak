function renderDashboardCards() {
  const container = document.getElementById('platform-cards');
  if (!container) return;
  container.innerHTML = '';
  const platforms = AppData.getPlatforms();
  renderDashboardOverview(platforms);
  renderMotivation();
  renderDashboardSummary();
  renderPeriodSummary();
  renderDateTracker();
  renderDashboardChart();

  platforms.forEach(platform => {
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
      <div class="platform-card-top"><div class="platform-icon">${platform.icon}</div><div class="platform-info"><h3>${platform.name}</h3><span class="platform-connection">${isCoding ? (connected ? `Connected · ${escapeHtml(platform.username)}` : 'Profile not connected') : platform.id === 'speakits' ? 'Session check-ins' : platform.id === 'duolingo' ? 'Manual XP log' : 'Personal progress'}</span></div><span class="card-arrow">↗</span></div>
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
  const activeToday = platforms.filter(platform => platformAmount(platform, today) > 0).length;
  const totals = platforms.reduce((summary, platform) => {
    const stats = getPlatformStats(platform);
    summary.problems += platform.category === 'coding' ? stats.total : 0;
    summary.streak = Math.max(summary.streak, stats.currentStreak);
    summary.activeDays = Math.max(summary.activeDays, stats.activeDays);
    return summary;
  }, { problems: 0, streak: 0, activeDays: 0 });
  const greetingDate = new Date(`${today}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  overview.innerHTML = `<div class="overview-copy"><span class="eyebrow">${greetingDate.toUpperCase()}</span><h1>Your practice<br><em>adds up.</em></h1><p>${activeToday ? `${activeToday} of 7 tracks active today.` : 'A small session today keeps the rhythm going.'}</p></div>
    <div class="overview-orbit"><span>✳</span><strong>${totals.streak}</strong><small>best streak</small></div>
    <div class="overview-stats"><span><strong>${totals.problems.toLocaleString()}</strong> coding problems</span><span><strong>${activeToday}</strong> tracks today</span><span><strong>${totals.activeDays}</strong> active days</span></div>`;
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
    card.innerHTML = `<div class="manage-platform-heading"><div class="platform-icon" style="--platform-color:${platform.color}">${platform.icon}</div><div><h3>${platform.name}</h3><p>${isCoding ? (platform.id === 'codechef' ? 'Public lifetime total sync · dated history limited' : supportsSync ? 'Public activity sync' : 'Manual count · no supported public API') : platform.id === 'speakits' ? 'One completed session per date' : platform.id === 'duolingo' ? 'Manual progress · no supported public API' : 'Manual count with optional notes'}</p></div><span class="manage-unit">${unit}</span></div>
      ${isCoding ? `<div class="connection-form"><label for="connect-${platform.id}">Username / profile ID</label><div class="connection-controls"><input id="connect-${platform.id}" type="text" value="${escapeHtml(platform.username || '')}" placeholder="Enter your ${platform.name} username" autocomplete="off"><button type="button" class="btn-connect">${platform.id === 'codechef' ? (platform.username ? 'Update & sync' : 'Connect & sync') : (platform.username ? 'Update' : 'Connect')}</button></div><div class="connection-status" role="status">${platform.lastSyncedAt ? `Last synced ${formatDateLabel(platform.lastSyncedAt)}${platform.stats?.scope ? ` · ${escapeHtml(platform.stats.scope)}` : ''}` : platform.id === 'codechef' ? 'Lifetime total syncs automatically from your public profile; daily history is not publicly available.' : 'Only public profile activity is requested. No platform password is needed.'}</div></div>` : ''}
      <div class="manage-platform-footer"><span class="sync-label ${platform.syncStatus === 'success' ? 'is-synced' : ''}">${supportsSync ? (platform.syncStatus === 'success' ? '● Synced' : platform.syncStatus === 'error' ? '● Sync needs attention' : '○ Not synced') : manualFallback ? 'Manual entry available' : 'Manual tracking'}</span>${platform.id === 'codechef' || !isCoding ? `<button type="button" class="btn-secondary manage-log">+ Log ${platform.id === 'speakits' ? 'session' : 'activity'}</button>` : platform.username ? `<button type="button" class="btn-secondary manage-sync">↻ Sync now</button>` : ''}</div>
      ${manualFallback ? '<p class="integration-note">The public profile provides a lifetime total. It does not expose reliable dated submissions, so daily counts are an optional manual fallback and do not replace the synced lifetime total.</p>' : platform.id === 'duolingo' ? '<p class="integration-note">Duolingo has no supported public progress API for this app. Add XP manually; no third-party credentials are requested.</p>' : ''}`;

    const connectButton = card.querySelector('.btn-connect');
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