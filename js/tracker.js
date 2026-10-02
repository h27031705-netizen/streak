const MANUAL_PLATFORM_IDS = ['codechef', 'speakits', 'duolingo', 'dsa-ideas'];
let dashboardChart;
let notificationInitKey = '';
let notificationInitPromise = null;
let notificationTimer = null;
let notificationProcessing = false;
let pendingRefreshPromise = null;
const MANUAL_TRACKING_IDS = ['speakits', 'duolingo', 'dsa-ideas'];
const MOTIVATION_QUOTES = [
  'One good book can change your thinking today.',
  'Small, steady practice makes difficult things familiar.',
  'A solved problem is proof that patience works.',
  'Consistency is a quiet way to make progress visible.',
  'Every new word opens a small window into another world.',
  'Curiosity is a skill. Give it a little time today.',
  'You do not need a perfect session; you need a beginning.',
  'Learning compounds when you return to it.',
  'A clear idea written down is already a useful step.',
  'Progress grows from the work you choose to repeat.',
  'Make room for one focused thing at a time.',
  'Today can be small and still count.'
];
const PLATFORM_REMINDERS = {
  leetcode: 'One focused problem is enough to keep your coding rhythm moving.',
  codechef: 'Ready for the code crack',
  codeforces: 'A little practice keeps your contest instincts sharp.',
  atcoder: 'Take on one small challenge today.',
  speakits: 'A few minutes of listening and speaking.',
  duolingo: 'New language, new people. Keep your lesson going.',
  'dsa-ideas': 'Give one DSA topic a little focused time.'
};

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function localDateForMonth(month, day) {
  return `${month}-${String(day).padStart(2, '0')}`;
}

function renderDashboardSummary() {
  const summary = document.getElementById('dashboard-summary');
  if (!summary) return;
  summary.innerHTML = '';
  AppData.getPlatforms().forEach(platform => {
    const stats = getPlatformStats(platform);
    const value = stats.total;
    const detail = platform.id === 'speakits'
      ? 'sessions completed'
      : platform.id === 'duolingo'
        ? 'XP recorded'
        : platform.id === 'dsa-ideas'
          ? 'ideas captured'
          : 'problems solved';
    const tile = el('article', 'summary-tile');
    tile.style.setProperty('--tile-color', platform.color);
    tile.innerHTML = `<span class="summary-icon">${platform.icon}</span><span class="summary-name">${platform.name}</span><strong>${animationsEnabled() ? '0' : value.toLocaleString()}</strong><small>${detail}</small>`;
    if (animationsEnabled()) animateCounter(tile.querySelector('strong'), value);
    tile.addEventListener('click', () => openPlatformDetail(platform.id));
    summary.appendChild(tile);
  });
}

function animateCounter(element, target) {
  const end = Number(target) || 0;
  if (!animationsEnabled() || end === 0) { element.textContent = end.toLocaleString(); return; }
  const start = performance.now();
  const duration = 520;
  const frame = now => {
    if (!element.isConnected) return;
    const progress = Math.min(1, (now - start) / duration);
    element.textContent = Math.round(end * (1 - Math.pow(1 - progress, 3))).toLocaleString();
    if (progress < 1 && animationsEnabled()) requestAnimationFrame(frame);
    else element.textContent = end.toLocaleString();
  };
  requestAnimationFrame(frame);
}

function renderMotivation() {
  const banner = document.getElementById('motivation-banner');
  if (!banner) return;
  const settings = AppData.state.settings || {};
  if (settings.notificationsEnabled === false || sessionStorage.getItem('streakforce-motivation-dismissed') === todayISO()) {
    banner.hidden = true;
    return;
  }
  const candidates = [
    { id: 'duolingo', days: 2, message: 'A few minutes of language practice can keep familiar words close.' },
    { id: 'dsa-ideas', days: 5, message: 'A small idea captured today is easier to build on tomorrow.' },
    { id: 'leetcode', days: 2, message: 'One focused problem is enough to keep your coding rhythm moving.' }
  ];
  const suggestion = candidates.find(candidate => {
    const platform = AppData.getPlatform(candidate.id);
    const lastActivity = getPlatformStats(platform).lastActivity;
    return !platform.frozen && lastActivity && daysBetween(lastActivity, todayISO()) >= candidate.days;
  });
  if (!suggestion) { banner.hidden = true; return; }
  const platform = AppData.getPlatform(suggestion.id);
  banner.innerHTML = `<span class="motivation-icon">${platform.icon}</span><p>${suggestion.message}</p><button type="button" aria-label="Dismiss motivation">×</button>`;
  banner.hidden = false;
  banner.querySelector('button').addEventListener('click', () => {
    sessionStorage.setItem('streakforce-motivation-dismissed', todayISO());
    banner.hidden = true;
  });
}

async function initializeSmartNotifications() {
  const profileId = AppData.profile?.id || 'local';
  const key = `${profileId}:${todayISO()}`;
  if (notificationInitKey === key || notificationInitPromise) return notificationInitPromise;
  notificationInitPromise = (async () => {
    const settings = { ...(AppData.state.settings || {}) };
    const items = [...(settings.notificationHistory || [])];
    const today = todayISO();
    let changed = false;
    const quoteAlreadyAdded = items.some(item => item.kind === 'motivation' && item.date === today);
    if (settings.motivationEnabled !== false && settings.notificationsEnabled !== false && !quoteAlreadyAdded) {
      let history = [...(settings.quoteHistory || [])];
      let used = new Set(history.map(item => item.quote));
      if (used.size >= MOTIVATION_QUOTES.length) {
        used = new Set(history.length ? [history[history.length - 1].quote] : []);
        history = history.slice(-1);
      }
      const available = MOTIVATION_QUOTES.filter(quote => !used.has(quote));
      const quote = available[Math.floor(Math.random() * available.length)] || MOTIVATION_QUOTES[0];
      history.push({ date: today, quote });
      settings.quoteHistory = history.slice(-100);
      items.push({ id: `${today}:motivation`, kind: 'motivation', title: 'A thought for today', message: quote, date: today, createdAt: new Date().toISOString(), read: false, status: 'delivered' });
      changed = true;
    }

    const platforms = AppData.getPlatforms();
    if (!items.some(item => item.kind === 'streak' && item.date === today)) {
      const atRisk = platforms.find(platform => !platform.frozen && getPlatformStats(platform).activeDays > 0 && ['yellow', 'red'].includes(getPlatformStats(platform).status));
      if (atRisk) {
        const status = getPlatformStats(atRisk).status;
        items.push({ id: `${today}:streak:${atRisk.id}`, kind: 'streak', platformId: atRisk.id, title: `${atRisk.name} streak ${status === 'yellow' ? 'at risk' : 'needs a restart'}`, message: status === 'yellow' ? `A short ${atRisk.name} session today can protect your rhythm.` : `Return to ${atRisk.name} when you are ready to build a new streak.`, date: today, createdAt: new Date().toISOString(), read: false, status: 'delivered' });
        changed = true;
      }
    }
    platforms.filter(platform => platform.username && platform.syncStatus === 'error').forEach(platform => {
      if (items.some(item => item.kind === 'update' && item.platformId === platform.id && item.date === today)) return;
      items.push({ id: `${today}:sync:${platform.id}`, kind: 'update', platformId: platform.id, title: `${platform.name} sync needs attention`, message: platform.syncError || 'The latest public profile sync did not complete.', date: today, createdAt: new Date().toISOString(), read: false, status: 'delivered' });
      changed = true;
    });
    const existingToday = new Set(items.filter(item => item.date === today && item.kind === 'platform').map(item => item.platformId));
    if (settings.platformRemindersEnabled !== false && settings.remindersEnabled !== false) {
      const [hour, minute] = String(settings.reminderTime || '19:00').split(':').map(Number);
      const start = new Date();
      start.setHours(hour || 0, minute || 0, 0, 0);
      const gap = Math.max(2, Math.min(5, Number(settings.reminderGapMinutes) || 3));
      platforms.filter(platform => !platform.frozen && platformAmount(platform, today) <= 0 && !existingToday.has(platform.id)).forEach((platform, index) => {
        const scheduled = new Date(start.getTime() + index * gap * 60000);
        items.push({ id: `${today}:platform:${platform.id}`, kind: 'platform', platformId: platform.id, title: `${platform.name} practice`, message: PLATFORM_REMINDERS[platform.id], date: today, scheduledFor: scheduled.toISOString(), read: false, status: 'pending' });
        changed = true;
      });
    }

    items.forEach(item => {
      if (item.kind !== 'platform' || item.status !== 'pending') return;
      const platform = AppData.getPlatform(item.platformId);
      if (settings.platformRemindersEnabled === false || settings.remindersEnabled === false || !platform || platform.frozen || platformAmount(platform, today) > 0) {
        item.status = 'skipped';
        changed = true;
      }
    });
    settings.notificationHistory = items.slice(-80);
    if (changed) await AppData.saveSettings(settings);
    notificationInitKey = key;
    updateNotificationBell();
    if (!notificationTimer) notificationTimer = window.setInterval(processScheduledNotifications, 30000);
  })();
  try { await notificationInitPromise; }
  finally { notificationInitPromise = null; }
}

async function resetSmartNotifications() {
  notificationInitKey = '';
  const settings = AppData.state.settings || {};
  const history = (settings.notificationHistory || []).filter(item => !(item.kind === 'platform' && item.status === 'pending' && item.date === todayISO()));
  if (history.length !== (settings.notificationHistory || []).length) {
    await AppData.saveSettings({ ...settings, notificationHistory: history });
  }
  await initializeSmartNotifications();
}

async function refreshPendingNotifications() {
  if (pendingRefreshPromise) return pendingRefreshPromise;
  const settings = AppData.state.settings || {};
  const history = [...(settings.notificationHistory || [])];
  let changed = false;
  history.forEach(item => {
    if (item.kind !== 'platform' || item.status !== 'pending') return;
    const platform = AppData.getPlatform(item.platformId);
    if (!platform || platform.frozen || platformAmount(platform, todayISO()) > 0 || settings.platformRemindersEnabled === false || settings.remindersEnabled === false) {
      item.status = 'skipped';
      changed = true;
    }
  });
  if (!changed) return;
  pendingRefreshPromise = AppData.saveSettings({ ...settings, notificationHistory: history })
    .then(updateNotificationBell)
    .catch(error => console.error('Could not refresh pending reminders:', error))
    .finally(() => { pendingRefreshPromise = null; });
  return pendingRefreshPromise;
}

async function processScheduledNotifications() {
  if (notificationProcessing) return;
  notificationProcessing = true;
  try {
    const settings = AppData.state.settings || {};
    if (settings.platformRemindersEnabled === false || settings.remindersEnabled === false) return;
    const items = [...(settings.notificationHistory || [])];
    const now = Date.now();
    const due = items.filter(item => item.kind === 'platform' && item.status === 'pending' && Date.parse(item.scheduledFor) <= now).sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
    const item = due[0];
    if (!item) return;
    const platform = AppData.getPlatform(item.platformId);
    if (!platform || platform.frozen || platformAmount(platform, todayISO()) > 0) {
      item.status = 'skipped';
      await AppData.saveSettings({ ...settings, notificationHistory: items });
      updateNotificationBell();
      return;
    }
    const gap = Math.max(2, Math.min(5, Number(settings.reminderGapMinutes) || 3)) * 60000;
    const lastDelivery = items.filter(entry => entry.kind === 'platform' && entry.deliveredAt).reduce((latest, entry) => Math.max(latest, Date.parse(entry.deliveredAt)), 0);
    if (lastDelivery && now - lastDelivery < gap) return;
    item.status = 'delivered';
    item.deliveredAt = new Date().toISOString();
    if (settings.browserNotificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(item.title, { body: item.message, tag: item.id });
    }
    await AppData.saveSettings({ ...settings, notificationHistory: items });
    updateNotificationBell();
    if (document.visibilityState === 'visible') showToast(`${item.title}: ${item.message}`);
  } catch (error) {
    console.error('Reminder delivery failed:', error);
  } finally {
    notificationProcessing = false;
  }
}

function updateNotificationBell() {
  const count = document.getElementById('notification-count');
  if (!count) return;
  const items = AppData.state.settings?.notificationHistory || [];
  const unread = items.filter(item => item.status === 'pending' || (item.status === 'delivered' && !item.read)).length;
  count.textContent = unread > 9 ? '9+' : String(unread);
  count.hidden = unread === 0;
  renderNotificationPanel();
}

function renderNotificationPanel() {
  const panel = document.getElementById('notification-panel');
  if (!panel) return;
  const items = [...(AppData.state.settings?.notificationHistory || [])]
    .filter(item => item.status === 'pending' || item.status === 'delivered')
    .sort((a, b) => a.status === 'pending' && b.status !== 'pending' ? -1 : b.status === 'pending' && a.status !== 'pending' ? 1 : Date.parse(b.deliveredAt || b.createdAt || b.scheduledFor) - Date.parse(a.deliveredAt || a.createdAt || a.scheduledFor));
  panel.innerHTML = `<div class="notification-panel-heading"><strong>Notifications</strong><button type="button" class="notification-close" aria-label="Close notifications">×</button></div>${items.length ? `<div class="notification-list">${items.slice(0, 12).map(item => `<article class="notification-item ${item.status === 'pending' ? 'is-pending' : ''}"><span class="notification-item-icon">${item.kind === 'motivation' ? '✳' : item.kind === 'streak' ? '🔥' : item.status === 'pending' ? '◷' : (AppData.getPlatform(item.platformId)?.icon || '•')}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${item.status === 'pending' ? `Scheduled ${new Date(item.scheduledFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : item.kind === 'motivation' ? 'Daily thought' : item.kind === 'streak' ? 'Streak alert' : item.kind === 'update' ? 'Important update' : 'Platform reminder'}</small></div></article>`).join('')}</div>` : '<div class="notification-empty"><strong>You are all caught up.</strong><p>New reminders and learning notes will appear here.</p></div>'}`;
  panel.querySelector('.notification-close')?.addEventListener('click', closeNotificationPanel);
}

async function openNotificationPanel() {
  const panel = document.getElementById('notification-panel');
  const button = document.getElementById('btn-notifications');
  if (!panel || !button) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  button.setAttribute('aria-expanded', String(opening));
  if (!opening) return;
  const settings = AppData.state.settings || {};
  const history = [...(settings.notificationHistory || [])];
  let changed = false;
  history.forEach(item => {
    if (item.status === 'delivered' && !item.read) { item.read = true; changed = true; }
  });
  if (changed) await AppData.saveSettings({ ...settings, notificationHistory: history });
  updateNotificationBell();
}

function closeNotificationPanel() {
  const panel = document.getElementById('notification-panel');
  const button = document.getElementById('btn-notifications');
  if (panel) panel.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}

function platformPeriodTotal(platform, startDate) {
  const dates = new Set([
    ...platform.activityLog.map(entry => entry.date),
    ...AppData.state.manualActivities.filter(entry => entry.platform_id === platform.id).map(entry => entry.date)
  ]);
  return [...dates].filter(date => date >= startDate && date <= todayISO())
    .reduce((sum, date) => sum + platformAmount(platform, date), 0);
}

function renderPeriodSummary() {
  const container = document.getElementById('period-summary');
  if (!container) return;
  const today = todayISO();
  const periods = [
    { label: 'Today', start: today },
    { label: 'This week', start: daysAgoISO(6) },
    { label: 'This month', start: `${monthKey()}-01` }
  ];
  const platforms = AppData.getPlatforms();
  container.innerHTML = periods.map(period => {
    const dateSet = new Set();
    const totals = { coding: 0, session: 0, language: 0, ideas: 0 };
    const activeTracks = new Set();
    platforms.forEach(platform => {
      const dates = new Set([
        ...platform.activityLog.map(entry => entry.date),
        ...AppData.state.manualActivities.filter(entry => entry.platform_id === platform.id).map(entry => entry.date)
      ]);
      [...dates].filter(date => date >= period.start && date <= today).forEach(date => {
        const amount = platformAmount(platform, date);
        if (!amount) return;
        dateSet.add(date);
        activeTracks.add(platform.id);
        totals[platform.category] += amount;
      });
    });
    const metrics = [
      totals.coding ? `${totals.coding.toLocaleString()} problems` : '',
      totals.session ? `${totals.session} ${totals.session === 1 ? 'session' : 'sessions'}` : '',
      totals.language ? `${totals.language.toLocaleString()} XP` : '',
      totals.ideas ? `${totals.ideas.toLocaleString()} ${totals.ideas === 1 ? 'idea' : 'ideas'}` : ''
    ].filter(Boolean);
    return `<article class="period-tile"><div class="period-tile-head"><h3>${period.label}</h3><span>${dateSet.size} active ${dateSet.size === 1 ? 'day' : 'days'}</span></div><strong>${activeTracks.size} <small>tracks</small></strong><p>${metrics.length ? metrics.join(' · ') : 'No activity logged'}</p></article>`;
  }).join('');
}

function platformAmount(platform, date) {
  if (platform.category === 'coding') {
    const day = platform.activityLog.find(entry => entry.date === date);
    const synced = day?.problemsSolved || 0;
    const manual = AppData.state.manualActivities.find(entry => entry.platform_id === platform.id && entry.date === date);
    return synced + Number(manual?.amount || 0);
  }
  const entry = AppData.state.manualActivities.find(item => item.platform_id === platform.id && item.date === date);
  return entry ? Number(entry.amount) : 0;
}

function renderDateTracker() {
  const container = document.getElementById('tracker-content');
  const monthInput = document.getElementById('tracker-month');
  if (!container || !monthInput) return;
  if (!monthInput.value) monthInput.value = monthKey();
  const [year, month] = monthInput.value.split('-').map(Number);
  if (!year || !month) return;

  const platforms = AppData.getPlatforms();
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDay = monthInput.value === monthKey() ? new Date().getDate() : daysInMonth;
  const rows = [];
  let activeDates = 0;
  let monthProblems = 0;
  const activePlatforms = new Set();

  for (let day = lastDay; day >= 1; day--) {
    const date = localDateForMonth(monthInput.value, day);
    const values = platforms.map(platform => platformAmount(platform, date));
    const active = values.filter(value => value > 0).length;
    if (active) activeDates++;
    values.forEach((value, index) => {
      if (value > 0) activePlatforms.add(platforms[index].id);
      if (platforms[index].category === 'coding') monthProblems += value;
    });
    const pieces = values.map((value, index) => value > 0 ? `${platforms[index].icon} ${platforms[index].id === 'duolingo' ? `${value} XP` : value}` : '').filter(Boolean);
    const totalText = pieces.length ? pieces.join(' · ') : '—';
    const cells = platforms.map((platform, index) => {
      const value = values[index];
      const display = value > 0 ? (platform.id === 'duolingo' ? `${value} XP` : value) : '·';
      const canLog = MANUAL_PLATFORM_IDS.includes(platform.id);
      return `<td class="${value ? 'has-value' : 'is-empty'}">${canLog ? `<button type="button" class="tracker-cell" data-entry-platform="${platform.id}" data-entry-date="${date}" aria-label="Log ${platform.name} for ${date}">${display}</button>` : `<span>${display}</span>`}</td>`;
    }).join('');
    rows.push(`<tr class="${active ? 'has-activity' : ''}"><th scope="row"><time datetime="${date}">${formatDateLabel(date)}</time><small>${new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short' })}</small></th>${cells}<td class="day-summary"><span>${active ? `${active} active` : '—'}</span><small>${totalText}</small></td></tr>`);
  }

  const dateLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  container.innerHTML = `<div class="tracker-meta"><span>${dateLabel}</span><span>${activeDates} active day${activeDates === 1 ? '' : 's'} · ${monthProblems} coding problems</span></div>
    <div class="tracker-table-scroll"><table class="tracker-table"><thead><tr><th scope="col">Date</th>${platforms.map(platform => `<th scope="col"><span title="${platform.name}">${platform.icon}</span><small>${platform.name}</small></th>`).join('')}<th scope="col">Daily activity</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <p class="tracker-footnote">CodeChef lifetime total syncs automatically; dated CodeChef rows are optional manual entries. LeetCode, Codeforces, and AtCoder import available accepted submissions.</p>`;
  container.querySelectorAll('[data-entry-platform]').forEach(button => button.addEventListener('click', () => openActivityDialog(button.dataset.entryPlatform, button.dataset.entryDate)));
}

function openActivityDialog(platformId = 'speakits', date = todayISO()) {
  const dialog = document.getElementById('activity-dialog');
  const form = document.getElementById('activity-form');
  const select = document.getElementById('entry-platform');
  const amountWrap = document.getElementById('entry-amount-wrap');
  const note = document.getElementById('entry-note');
  select.innerHTML = MANUAL_PLATFORM_IDS.map(id => {
    const platform = AppData.getPlatform(id);
    return `<option value="${id}">${platform.icon} ${platform.name}</option>`;
  }).join('');
  select.value = MANUAL_PLATFORM_IDS.includes(platformId) ? platformId : 'speakits';
  const dateInput = document.getElementById('entry-date');
  dateInput.value = date || todayISO();
  dateInput.max = todayISO();
  updateEntryFields();
  select.onchange = updateEntryFields;
  dateInput.onchange = updateEntryFields;
  form.onsubmit = async event => {
    event.preventDefault();
    const selectedPlatform = select.value;
    const isSpeakits = selectedPlatform === 'speakits';
    const amount = isSpeakits ? 1 : Number(document.getElementById('entry-amount').value);
    const status = document.getElementById('entry-status');
    const saveButton = document.getElementById('entry-save');
    saveButton.disabled = true;
    status.textContent = 'Saving…';
    try {
      await AppData.saveManualActivity({
        platformId: selectedPlatform,
        date: document.getElementById('entry-date').value,
        amount,
        note: note.value.trim()
      });
      dialog.close();
      showToast(selectedPlatform === 'speakits' ? 'Speakits session recorded.' : selectedPlatform === 'dsa-ideas' ? 'DSA progress saved.' : selectedPlatform === 'duolingo' ? 'Duolingo XP saved.' : 'CodeChef count saved.');
      renderDashboardCards();
      renderDateTracker();
      renderDashboardChart();
      if (document.getElementById('pd-content') && document.getElementById('screen-platform-detail').classList.contains('active')) {
        const activePlatform = AppData.getPlatform(document.getElementById('pd-platform-name').dataset.platformId);
        if (activePlatform) renderPlatformDetailContent(activePlatform);
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  };
  document.getElementById('activity-close').onclick = () => dialog.close();
  dialog.showModal();
}

function updateEntryFields() {
  const platform = AppData.getPlatform(document.getElementById('entry-platform').value);
  if (!platform) return;
  const isSpeakits = platform.id === 'speakits';
  const amountWrap = document.getElementById('entry-amount-wrap');
  const amountLabel = document.getElementById('entry-amount-label');
  const amountInput = document.getElementById('entry-amount');
  const title = document.getElementById('activity-title');
  const help = document.getElementById('entry-help');
  const noteLabel = document.getElementById('entry-note-label');
  const noteInput = document.getElementById('entry-note');
  const existing = AppData.state.manualActivities.find(entry => entry.platform_id === platform.id && entry.date === document.getElementById('entry-date').value);
  title.textContent = `Log ${platform.name}`;
  noteInput.value = isSpeakits ? '' : (existing?.note || '');
  noteLabel.hidden = isSpeakits;
  noteInput.hidden = isSpeakits;
  amountLabel.textContent = platform.id === 'duolingo' ? 'XP earned' : platform.id === 'dsa-ideas' ? 'Ideas worked on' : 'Problems solved';
  amountInput.value = existing?.amount ?? 1;
  amountInput.step = platform.id === 'duolingo' ? '1' : '1';
  amountInput.min = platform.id === 'speakits' ? '1' : '0';
  amountWrap.hidden = isSpeakits;
  help.textContent = isSpeakits
    ? 'One completed Speakits session will be recorded for this date.'
    : platform.id === 'duolingo'
      ? 'Duolingo does not offer a supported public progress API. Record XP manually.'
      : platform.id === 'dsa-ideas'
        ? 'Add the number of ideas or problems you worked through; notes are optional.'
        : 'CodeChef lifetime solved total syncs from your public profile. Dated activity is unavailable; this optional row records your daily count separately.';
}

function renderDashboardChart() {
  const canvas = document.getElementById('dashboard-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (dashboardChart) dashboardChart.destroy();
  const labels = [];
  const codingValues = [];
  const learningValues = [];
  for (let day = 29; day >= 0; day--) {
    const date = daysAgoISO(day);
    labels.push(new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const platforms = AppData.getPlatforms();
    codingValues.push(platforms.filter(platform => platform.category === 'coding').reduce((sum, platform) => sum + platformAmount(platform, date), 0));
    learningValues.push(platforms.filter(platform => platform.category !== 'coding').reduce((sum, platform) => sum + (platformAmount(platform, date) > 0 ? 1 : 0), 0));
  }
  dashboardChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Coding problems', data: codingValues, borderColor: '#3678D4', backgroundColor: '#3678D422', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
      { label: 'Learning tracks active', data: learningValues, yAxisID: 'y1', borderColor: '#D98269', backgroundColor: '#D9826918', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }
    ] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: animationsEnabled() ? 650 : 0 },
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7 } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 7 } },
        y: { beginAtZero: true, position: 'left', title: { display: true, text: 'Problems' }, ticks: { precision: 0 } },
        y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Tracks active' }, grid: { drawOnChartArea: false }, ticks: { precision: 0 } }
      }
    }
  });
}

function refreshDashboard() {
  renderDashboardSummary();
  renderPeriodSummary();
  renderDateTracker();
  renderDashboardChart();
}

document.addEventListener('DOMContentLoaded', () => {
  const monthInput = document.getElementById('tracker-month');
  if (monthInput) monthInput.value = monthKey();
  monthInput?.addEventListener('change', renderDateTracker);
});
