let platformDetailChart;

function openPlatformDetail(platformId) {
  const platform = AppData.getPlatform(platformId);
  if (!platform) return;
  const title = document.getElementById('pd-platform-name');
  title.textContent = `${platform.icon} ${platform.name}`;
  title.dataset.platformId = platform.id;
  renderPlatformDetailContent(platform);
  navigateTo('screen-platform-detail');
}

function renderPlatformDetailContent(platform) {
  const container = document.getElementById('pd-content');
  container.innerHTML = '';
  const stats = getPlatformStats(platform);
  const labels = {
    coding: 'Problems solved',
    session: 'Sessions completed',
    language: 'XP recorded',
    ideas: 'Ideas worked on'
  };
  const connected = Boolean(platform.username);
  const integration = platform.id === 'codechef'
    ? 'Lifetime solved total syncs from your public CodeChef profile. Reliable dated submission history is unavailable; manual daily rows are separate.'
    : platform.id === 'duolingo'
      ? 'Duolingo does not offer a supported public progress API here. XP is recorded manually.'
      : platform.category === 'coding'
        ? connected ? `Public profile connected as ${escapeHtml(platform.username)}.` : 'Connect a public username to import available accepted submissions.'
        : platform.id === 'speakits'
          ? 'Each check-in represents one completed Speakits session.'
          : 'Record your personal progress by date; add an optional note to keep context.';
  const syncScope = platform.stats?.scope ? ` ${platform.stats.scope}` : '';

  const hero = el('section', 'card detail-summary');
  hero.style.setProperty('--platform-color', platform.color);
  hero.innerHTML = `<div class="detail-summary-top"><div class="platform-icon">${platform.icon}</div><div><p class="eyebrow">${platform.category === 'coding' ? (connected ? 'PUBLIC PROFILE' : 'PROFILE NOT CONNECTED') : 'PERSONAL TRACKING'}</p><h3>${labels[platform.category]}</h3></div></div><strong class="detail-total">${Number(stats.total).toLocaleString()}</strong><p class="integration-note">${integration}${escapeHtml(syncScope)}</p>`;
  container.appendChild(hero);

  const grid = el('div', 'pd-stats-grid');
  [
    [stats.activeDays, 'Active days'],
    [stats.currentStreak, 'Current streak'],
    [stats.longestStreak, 'Longest streak'],
    [stats.lastActivity ? formatDateLabel(stats.lastActivity) : '—', 'Last activity']
  ].forEach(([value, label]) => {
    const box = el('div', 'card pd-stat-box');
    box.innerHTML = `<div class="value">${value}</div><div class="label">${label}</div>`;
    grid.appendChild(box);
  });
  container.appendChild(grid);

  const actions = el('div', 'detail-actions');
  if (MANUAL_PLATFORM_IDS.includes(platform.id)) {
    const logButton = el('button', 'btn-primary', `+ Log ${platform.id === 'speakits' ? 'session' : 'activity'}`);
    logButton.addEventListener('click', () => openActivityDialog(platform.id));
    actions.appendChild(logButton);
  }
  if (['leetcode', 'codeforces', 'atcoder'].includes(platform.id)) {
    const integrationButton = el('button', 'btn-secondary', connected ? '↻ Sync profile' : 'Connect profile');
    integrationButton.addEventListener('click', async () => {
      if (!connected) { navigateTo('screen-add-platform'); return; }
      integrationButton.disabled = true;
      integrationButton.textContent = 'Syncing…';
      try {
        const result = await AppData.syncPlatform(platform.id);
        showToast(`${platform.name} synced. ${result.imported} activity records checked.`);
        renderPlatformDetailContent(platform);
        renderDashboardCards();
      } catch (error) {
        const status = container.querySelector('.detail-sync-status');
        if (status) status.textContent = error.message;
        showToast(`${platform.name} sync failed: ${error.message}`, 'error');
      } finally { integrationButton.disabled = false; }
    });
    actions.appendChild(integrationButton);
  }
  if (actions.childNodes.length) container.appendChild(actions);
  const syncStatus = el('p', 'detail-sync-status', platform.syncError || (platform.lastSyncedAt ? `Last synced ${formatDateLabel(platform.lastSyncedAt)}.` : ''));
  container.appendChild(syncStatus);

  const chartCard = el('div', 'card pd-chart-box');
  chartCard.innerHTML = `<div class="pd-section-title">Activity over time</div><p class="pd-helper">Daily ${platform.category === 'coding' ? 'problems solved' : platform.id === 'speakits' ? 'sessions' : platform.id === 'duolingo' ? 'XP earned' : 'ideas worked on'} · last 30 days</p><div class="chart-canvas-wrap"><canvas id="pd-chart"></canvas></div>`;
  container.appendChild(chartCard);

  const logHeading = el('div', 'pd-section-title', 'Recent activity');
  container.appendChild(logHeading);
  const entries = platform.category === 'coding'
    ? platform.activityLog.map(entry => ({ date: entry.date, amount: entry.problemsSolved || 0, note: '' }))
    : AppData.state.manualActivities.filter(entry => entry.platform_id === platform.id).map(entry => ({ date: entry.date, amount: Number(entry.amount), note: entry.note }));
  entries.sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length) {
    container.appendChild(el('div', 'empty-state', '<span class="emoji">◷</span><p>No activity in this account yet.</p>'));
  } else {
    const list = el('div', 'pd-activity-log');
    entries.slice(0, 30).forEach(entry => {
      const row = el('article', 'card pd-activity-row');
      const amount = platform.id === 'speakits' ? 'Session completed' : `${entry.amount.toLocaleString()} ${platform.id === 'duolingo' ? 'XP' : platform.id === 'dsa-ideas' ? (entry.amount === 1 ? 'idea' : 'ideas') : 'problems solved'}`;
      row.innerHTML = `<span class="dot green"></span><div class="details"><div class="desc">${amount}</div><div class="date">${formatDateLabel(entry.date)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</div></div>`;
      list.appendChild(row);
    });
    container.appendChild(list);
  }
  renderPlatformDetailChart(platform);
}

function renderPlatformDetailChart(platform) {
  const canvas = document.getElementById('pd-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (platformDetailChart) platformDetailChart.destroy();
  const labels = [];
  const values = [];
  for (let offset = 29; offset >= 0; offset--) {
    const date = daysAgoISO(offset);
    labels.push(new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    values.push(platformAmount(platform, date));
  }
  platformDetailChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: platform.id === 'duolingo' ? 'XP' : platform.id === 'speakits' ? 'Sessions' : platform.id === 'dsa-ideas' ? 'Ideas' : 'Problems', data: values, backgroundColor: `${platform.color}B8`, borderRadius: 4, maxBarThickness: 18 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: animationsEnabled() ? 500 : 0 },
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } }, y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}