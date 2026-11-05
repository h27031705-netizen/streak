/*
  App-wide navigation controller.
  Handles: splash → dashboard transition, bottom nav switching,
  back buttons, and lazy-initializing each screen's content.
*/

let activeScreen = 'screen-splash';
const screenHistory = [];

function navigateTo(screenId, options = {}) {
  const nextScreen = document.getElementById(screenId);
  if (!nextScreen || activeScreen === screenId) return false;
  if (!options.replace && activeScreen !== 'screen-splash') screenHistory.push(activeScreen);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  nextScreen.classList.add('active');
  activeScreen = screenId;

  // Syncfunction navigateTo bottom nav highlight
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.screen === screenId);
  });

  // Lazy-init screen content
  if (screenId === 'screen-dashboard') renderDashboardCards();
  if (screenId === 'screen-targets') renderTargets();
  if (screenId === 'screen-add-platform') renderManagePlatforms();
  if (screenId === 'screen-ai' && !document.getElementById('ai-chat').hasChildNodes()) initAIAssistant();
  if (screenId === 'screen-settings') renderSettings();
  return true;
}

function goBack(fallback = 'screen-dashboard') {
  const previous = screenHistory.pop();
  navigateTo(previous || fallback, { replace: true });
}

function renderSettings() {
  const settings = { notificationsEnabled: true, platformRemindersEnabled: true, motivationEnabled: true, browserNotificationsEnabled: false, reminderTime: '19:00', reminderGapMinutes: 3, theme: 'system', animations: true, autoSync: true, ...(AppData.state.settings || {}) };
  const profile = AppData.profile || AppData.state.profile || {};
  const container = document.getElementById('settings-content');
  container.innerHTML = `<div class="card settings-card"><div class="settings-heading">Account</div>
    <form id="profile-form" class="settings-form"><label class="settings-field">Name<input id="profile-name" type="text" maxlength="80" value="${escapeHtml(profile.name || '')}" required></label><label class="settings-field">Email<input type="email" value="${escapeHtml(profile.email || '')}" readonly></label><button class="btn-secondary" type="submit">Save profile</button><p class="settings-status" id="profile-status" role="status"></p></form>
    <form id="password-form" class="settings-form"><strong class="settings-subheading">Change password</strong><label class="settings-field">Current password<input id="current-password" type="password" autocomplete="current-password" required></label><label class="settings-field">New password<input id="new-password" type="password" minlength="10" autocomplete="new-password" required></label><label class="settings-field">Confirm new password<input id="confirm-new-password" type="password" minlength="10" autocomplete="new-password" required></label><button class="btn-secondary" type="submit">Update password</button><p class="settings-status" id="password-status" role="status"></p></form>
    <form id="security-question-form" class="settings-form"><strong class="settings-subheading">Account recovery</strong><p class="settings-helper">Set a personal security question and answer. Your answer is stored as a hash.</p><label class="settings-field">Current password<input id="security-current-password" type="password" autocomplete="current-password" required></label><label class="settings-field">Security question<input id="profile-security-question" type="text" maxlength="200" required></label><label class="settings-field">Security answer<input id="profile-security-answer" type="text" maxlength="200" autocomplete="off" required></label><button class="btn-secondary" type="submit">Save recovery question</button><p class="settings-status" id="security-question-status" role="status"></p></form>
    <button class="btn-secondary settings-logout" id="settings-logout" type="button">Sign out</button>
  </div><div class="card settings-card"><div class="settings-heading">Platforms</div><p class="settings-helper">Frozen platforms keep their history and do not count as missed activity.</p>
    <div class="settings-platform-list">${AppData.getPlatforms().map(platform => `<label class="settings-platform-row"><span>${platform.icon} ${escapeHtml(platform.name)}<small>${platform.frozen ? 'Frozen' : 'Active'}</small></span><input type="checkbox" data-platform-freeze="${platform.id}" ${platform.frozen ? 'checked' : ''} aria-label="Freeze ${escapeHtml(platform.name)}"><i></i></label>`).join('')}</div>
    <button class="btn-secondary" type="button" id="settings-manage-platforms">Manage profile IDs and connections</button>
  </div><div class="card settings-card"><div class="settings-heading">Notifications</div>
    ${settingsToggle('platformRemindersEnabled', 'Platform reminders', 'Separate reminders for each active platform.', settings.platformRemindersEnabled)}
    ${settingsToggle('motivationEnabled', 'Daily motivation', 'A fresh thought, without consecutive-day repeats.', settings.motivationEnabled)}
    ${settingsToggle('browserNotificationsEnabled', 'System notifications', 'Deliver reminders while this app is open.', settings.browserNotificationsEnabled)}
    <div class="settings-inline-fields"><label class="settings-field">Start time<input id="setting-reminder-time" type="time" value="${escapeHtml(settings.reminderTime)}"></label><label class="settings-field">Gap between reminders<select id="setting-reminder-gap">${[2, 3, 4, 5].map(gap => `<option value="${gap}" ${Number(settings.reminderGapMinutes) === gap ? 'selected' : ''}>${gap} minutes</option>`).join('')}</select></label></div>
    <button class="btn-secondary" type="button" id="settings-save-notifications">Save notification timing</button><p class="settings-helper">System reminders can only run while the app is open; browser permission is requested when enabled.</p><p class="settings-status" id="notification-settings-status" role="status"></p>
  </div><div class="card settings-card"><div class="settings-heading">Appearance</div>
    <label class="settings-field">Theme<select id="setting-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    ${settingsToggle('animations', 'Animations', 'Use subtle transitions and animated statistics.', settings.animations)}
  </div><div class="card settings-card"><div class="settings-heading">Data synchronization</div>
    ${settingsToggle('autoSync', 'Sync automatically', 'Refresh connected public profiles when the app opens.', settings.autoSync)}
    <p class="settings-helper">Manual platforms remain manual. Sync availability and data scope are shown in Platform Management.</p>
  </div>`;
  const themeSelect = container.querySelector('#setting-theme');
  themeSelect.value = ['light', 'dark', 'system'].includes(settings.theme) ? settings.theme : 'system';
  container.querySelectorAll('input[data-setting]').forEach(input => { input.checked = settings[input.dataset.setting]; });
  themeSelect.addEventListener('change', async () => {
    try {
      const saved = await AppData.saveSettings({ ...settings, ...AppData.state.settings, theme: themeSelect.value });
      applyTheme(saved.theme);
      showToast(`${saved.theme[0].toUpperCase()}${saved.theme.slice(1)} theme applied.`);
    } catch (error) {
      showToast(`Theme could not be saved: ${error.message}`, 'error');
    }
  });
  container.querySelectorAll('input[data-setting]').forEach(input => input.addEventListener('change', async () => {
    if (input.dataset.setting === 'browserNotificationsEnabled' && input.checked) {
      if (!('Notification' in window)) { input.checked = false; showToast('System notifications are not supported by this browser.', 'error'); return; }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { input.checked = false; showToast('Allow browser notifications to enable system alerts.', 'error'); return; }
    }
    const next = { ...AppData.state.settings, [input.dataset.setting]: input.checked };
    if (input.dataset.setting === 'motivationEnabled') next.notificationsEnabled = input.checked;
    try {
      const saved = await AppData.saveSettings(next);
      applyTheme(saved.theme);
      renderMotivation();
      if (['platformRemindersEnabled', 'motivationEnabled'].includes(input.dataset.setting)) await resetSmartNotifications();
      showToast(`${input.dataset.setting.replace(/[A-Z]/g, letter => ` ${letter.toLowerCase()}`)} ${input.checked ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      input.checked = !input.checked;
      showToast(`Setting could not be saved: ${error.message}`, 'error');
    }
  }));
  container.querySelector('#settings-save-notifications').addEventListener('click', async () => {
    const status = container.querySelector('#notification-settings-status');
    try {
      await AppData.saveSettings({ ...AppData.state.settings, reminderTime: container.querySelector('#setting-reminder-time').value, reminderGapMinutes: Number(container.querySelector('#setting-reminder-gap').value) });
      await resetSmartNotifications();
      status.textContent = 'Notification timing saved.';
    } catch (error) { status.textContent = error.message; }
  });
  container.querySelectorAll('[data-platform-freeze]').forEach(input => input.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await AppData.setPlatformFrozen(input.dataset.platformFreeze, input.checked);
      const platform = AppData.getPlatform(input.dataset.platformFreeze);
      input.closest('.settings-platform-row').querySelector('small').textContent = platform.frozen ? 'Frozen' : 'Active';
      await resetSmartNotifications();
      renderDashboardCards();
      showToast(`${platform.name} ${platform.frozen ? 'frozen' : 'unfrozen'}.`);
    } catch (error) { input.checked = !input.checked; showToast(error.message, 'error'); }
    finally { input.disabled = false; }
  }));
  container.querySelector('#settings-manage-platforms').addEventListener('click', () => navigateTo('screen-add-platform'));
  container.querySelector('#profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = container.querySelector('#profile-status');
    try {
      const updated = await AppData.saveProfile(container.querySelector('#profile-name').value.trim());
      document.getElementById('account-email').textContent = updated.name || updated.email;
      status.textContent = 'Profile updated.';
    } catch (error) { status.textContent = error.message; }
  });
  container.querySelector('#password-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = container.querySelector('#password-status');
    const newPassword = container.querySelector('#new-password').value;
    if (newPassword !== container.querySelector('#confirm-new-password').value) { status.textContent = 'New passwords do not match.'; return; }
    try {
      await AppData.changePassword(container.querySelector('#current-password').value, newPassword);
      event.currentTarget.reset();
      status.textContent = 'Password updated.';
    } catch (error) { status.textContent = error.message; }
  });
  container.querySelector('#security-question-form').addEventListener('submit', async event => {
    event.preventDefault();
    const status = container.querySelector('#security-question-status');
    try {
      await AppData.saveSecurityQuestion(
        container.querySelector('#security-current-password').value,
        container.querySelector('#profile-security-question').value,
        container.querySelector('#profile-security-answer').value
      );
      event.currentTarget.reset();
      status.textContent = 'Recovery question updated.';
    } catch (error) { status.textContent = error.message; }
  });
  container.querySelector('#settings-logout').addEventListener('click', async () => {
    try { await AppData.logout(); } catch (error) { showToast(error.message, 'error'); return; }
    navigateTo('screen-auth', { replace: true });
  });
}

function settingsToggle(key, label, helper, checked) {
  return `<label class="settings-toggle"><span><strong>${label}</strong><small>${helper}</small></span><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}><i></i></label>`;
}

function applyTheme(theme) {
  const normalized = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  const root = document.documentElement;
  if (normalized === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = normalized;
  root.dataset.animations = AppData.state.settings.animations === false ? 'off' : 'on';
  if (typeof Chart !== 'undefined') {
    Chart.defaults.color = getComputedStyle(root).getPropertyValue('--color-text-muted').trim();
    Chart.defaults.borderColor = getComputedStyle(root).getPropertyValue('--color-border').trim();
    document.querySelectorAll('canvas').forEach(canvas => Chart.getChart(canvas)?.update());
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.hasAttribute('data-theme')) applyTheme('system');
});

function animationsEnabled() {
  return AppData.state.settings.animations !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function showToast(message, kind = 'success') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), animationsEnabled() ? 220 : 0);
  }, 3200);
}

function consistencyScoreStatus(score) {
  if (!Number.isFinite(score)) return { label: 'No score yet', tone: 'unavailable' };
  if (score < 50) return { label: 'Low consistency', tone: 'low' };
  if (score < 80) return { label: 'Medium consistency', tone: 'medium' };
  return { label: 'High consistency', tone: 'high' };
}

function renderDashboardInsights() {
  const container = document.getElementById('intelligence-content');
  if (!container) return;
  const insight = AppData.state.intelligence;
  if (!insight) {
    const message = AppData.state.intelligenceError
      ? `Consistency analysis is temporarily unavailable: ${escapeHtml(AppData.state.intelligenceError)}`
      : 'Consistency analysis will appear after your activity loads.';
    container.innerHTML = `<p class="insight-empty">${message}</p>`;
    return;
  }
  const score = Number.isFinite(insight.score) ? insight.score : null;
  const scoreStatus = consistencyScoreStatus(score);
  const classifier = insight.classifier || {};
  const breakdown = insight.scoreBreakdown || {};
  const anomaly = insight.anomaly || {};
  const goalRisks = (insight.goalRisks || []).map(goal => `${goal.name} is due in ${goal.daysRemaining} day${goal.daysRemaining === 1 ? '' : 's'} at ${Math.round(goal.progress * 100)}% progress.`);
  const attentionItems = [...new Set([...(insight.attentionPatterns || []), ...goalRisks])];
  const activeDays = Number(breakdown.activeDaysLast30 || 0);
  const activities = AppData.state.customActivities || [];
  const historyAvailable = Array.isArray(insight.activityHistory);
  const history = historyAvailable ? insight.activityHistory : AppData.state.activityHistory || [];
  const cutoff = daysAgoISO(29);
  const recentSessions = history.filter(event =>
    event.type === 'custom-activity' && event.date >= cutoff && event.date <= todayISO() && event.completed !== false
  ).length;
  const plannedSessions = activities
    .filter(activity => activity.status === 'active')
    .reduce((total, activity) => total + Number(activity.frequencyPerWeek || 0) * 30 / 7, 0);
  const plannedRate = breakdown.scheduledCompletionRate;
  const goalRate = breakdown.goalProgressRate;
  const activeRate = Number(breakdown.activityCoverage ?? activeDays / 30);
  const statusExplanation = score === null
    ? 'A score will appear after activity has been recorded.'
    : scoreStatus.tone === 'low'
      ? 'Your score is below 50. The activity breakdown below shows which recorded factors have the most room to improve.'
      : scoreStatus.tone === 'medium'
        ? 'Your score is between 50 and 79. The activity breakdown below shows where small, steady changes could help.'
        : 'Your score is 80 or higher. Keep the habits reflected in your recent activity data.';
  const scoreFactors = [
    { label: 'Active-day coverage', value: activeRate },
    { label: 'Planned-session completion', value: plannedRate === null ? activeRate : Number(plannedRate) },
    { label: 'Activity rhythm', value: Number(breakdown.rhythmScore ?? 0) },
    { label: 'Goal progress', value: goalRate === null ? activeRate : Number(goalRate) }
  ];
  const lowestFactors = [...scoreFactors].sort((a, b) => a.value - b.value).slice(0, 2);
  const explanation = score === null
    ? 'No completed activity is available yet, so a score cannot be calculated.'
    : `${statusExplanation} The current score is most affected by ${lowestFactors.map(factor => `${factor.label.toLowerCase()} (${Math.round(factor.value * 100)}%)`).join(' and ')}.`;
  const metricCards = [
    {
      label: 'Active days',
      value: `${activeDays} <small>/ 30</small>`,
      detail: 'Unique days with completed activity in the last 30 days.',
      tone: 'activity'
    },
    {
      label: 'Planned sessions',
      value: plannedRate === null ? 'Not scheduled' : `${historyAvailable ? recentSessions : '—'} <small>/ ~${Math.ceil(plannedSessions)}</small>`,
      detail: plannedRate === null ? 'No active recurring activities are scheduled.' : `${Math.round(Number(plannedRate) * 100)}% completion over the last 30 days; plan is approximate.`,
      tone: 'sessions'
    },
    {
      label: 'Average activity gap',
      value: breakdown.averageGapDays === null ? 'Unavailable' : `${escapeHtml(breakdown.averageGapDays)} <small>days</small>`,
      detail: breakdown.averageGapDays === null ? 'More than one active day is needed to calculate a gap.' : 'Average days between recorded active dates.',
      tone: 'gap'
    },
    {
      label: 'Goal progress',
      value: goalRate === null ? 'No goals' : `${Math.round(Number(goalRate) * 100)}<small>%</small>`,
      detail: goalRate === null ? 'Add a goal to include goal progress in this breakdown.' : 'Average progress across active and completed goals.',
      tone: 'goals'
    }
  ];
  const factors = [
    { label: 'Active-day coverage · 35%', value: activeRate, note: `${activeDays} of 30 days` },
    { label: 'Planned-session completion · 25%', value: plannedRate === null ? activeRate : Number(plannedRate), note: plannedRate === null ? 'Uses active-day coverage; no schedule set' : `${Math.round(Number(plannedRate) * 100)}% completed` },
    { label: 'Activity rhythm · 20%', value: Number(breakdown.rhythmScore ?? 0), note: breakdown.averageGapDays === null ? 'Unavailable; rhythm component is 0 until gaps can be measured' : `${breakdown.averageGapDays}-day average gap` },
    { label: 'Goal progress · 20%', value: goalRate === null ? activeRate : Number(goalRate), note: goalRate === null ? 'Uses active-day coverage; no goals set' : `${Math.round(Number(goalRate) * 100)} average progress` }
  ];
  const activityCountsByDate = new Map();
  history.filter(event => event.date && event.date <= todayISO() && event.completed !== false).forEach(event => {
    activityCountsByDate.set(event.date, (activityCountsByDate.get(event.date) || 0) + 1);
  });
  const todayDate = new Date(`${todayISO()}T00:00:00Z`);
  const currentWeekMonday = new Date(todayDate);
  currentWeekMonday.setUTCDate(todayDate.getUTCDate() - ((todayDate.getUTCDay() + 6) % 7));
  const weeklyRows = Array.from({ length: 8 }, (_, rowIndex) => {
    const weekStart = new Date(currentWeekMonday);
    weekStart.setUTCDate(currentWeekMonday.getUTCDate() - (7 - rowIndex) * 7);
    return Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(weekStart);
      date.setUTCDate(weekStart.getUTCDate() + dayIndex);
      const iso = date.toISOString().slice(0, 10);
      const future = iso > todayISO();
      const count = future ? null : activityCountsByDate.get(iso) || 0;
      const level = count === null ? 'future' : count === 0 ? 'level-0' : count === 1 ? 'level-1' : count <= 3 ? 'level-2' : 'level-3';
      const dateLabel = new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      return { date: iso, label: dateLabel, day: date.getUTCDate(), count, level };
    });
  });
  const suggestions = [...(insight.recommendations || [])];
  if (activeDays < 12 && activeDays > 0) {
    suggestions.push(`Activity is recorded on ${activeDays} of the last 30 days; choose a repeatable time on another day to build a steadier rhythm.`);
  }
  if (plannedRate !== null && Number(plannedRate) < 0.7 && historyAvailable) {
    suggestions.push(`Recorded ${recentSessions} completed sessions against approximately ${Math.ceil(plannedSessions)} planned; consider adjusting the schedule or setting aside time for an upcoming planned session.`);
  }
  if (breakdown.averageGapDays !== null && Number(breakdown.averageGapDays) > 4) {
    suggestions.push(`The current average gap is ${breakdown.averageGapDays} days; try spacing sessions more evenly across the week.`);
  }
  if (goalRate !== null && Number(goalRate) < 0.7) {
    suggestions.push(`Current average goal progress is ${Math.round(Number(goalRate) * 100)}%; break an existing goal into a manageable next step.`);
  }
  if (!suggestions.length && score !== null) suggestions.push('Keep the routine that is reflected in your recorded activity and review this breakdown as new data is logged.');
  const uniqueSuggestions = [...new Set(suggestions)];
  const statusClass = scoreStatus.tone;
  const percent = score === null ? 0 : Math.max(0, Math.min(100, score));
  const clusterValue = classifier.cluster === null || classifier.cluster === undefined ? 'Unavailable' : `Cluster ${escapeHtml(classifier.cluster)}`;
  const clusterQuality = classifier.clusterQuality === null || classifier.clusterQuality === undefined ? 'Unavailable' : escapeHtml(classifier.clusterQuality);
  const silhouette = classifier.silhouetteScore === null || classifier.silhouetteScore === undefined ? 'Unavailable' : escapeHtml(classifier.silhouetteScore);
  const confidence = classifier.confidence ? escapeHtml(classifier.confidence) : 'Unavailable';

  container.innerHTML = `<section class="intelligence-overview" aria-label="Consistency score overview">
      <article class="card score-card score-${statusClass}">
        <div class="score-card-heading"><div><p class="eyebrow">YOUR CONSISTENCY</p><h3>Consistency score</h3></div><span class="score-status">${escapeHtml(scoreStatus.label)}</span></div>
        <div class="score-main">
          <div class="score-ring" role="progressbar" aria-label="Consistency score" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score === null ? 0 : score}" style="--score-progress:${percent}%">
            <span>${score === null ? '—' : score}<small>${score === null ? '' : '%'}</small></span>
          </div>
          <div class="score-message"><p>${escapeHtml(explanation)}</p><small>Low 0–49 · Medium 50–79 · High 80–100</small></div>
        </div>
        <div class="score-progress-track" role="presentation"><span style="width:${percent}%"></span></div>
      </article>
      <section class="card score-breakdown-card" aria-labelledby="score-breakdown-heading">
        <div class="insight-card-heading"><div><p class="eyebrow">HOW YOUR SCORE IS BUILT</p><h3 id="score-breakdown-heading">Score breakdown</h3></div></div>
        <div class="score-factor-list">${factors.map(factor => `<div class="score-factor"><div class="score-factor-heading"><strong>${escapeHtml(factor.label)}</strong><span>${Math.round(Math.max(0, Math.min(1, factor.value)) * 100)}%</span></div><div class="score-factor-track"><span style="width:${Math.max(0, Math.min(1, factor.value)) * 100}%"></span></div><small>${escapeHtml(factor.note)}</small></div>`).join('')}</div>
      </section>
    </section>
    <section class="insight-metrics" aria-label="Consistency metrics">${metricCards.map(metric => `<article class="card insight-metric insight-metric-${metric.tone}"><span class="insight-metric-label">${escapeHtml(metric.label)}</span><strong>${metric.value}</strong><p>${escapeHtml(metric.detail)}</p></article>`).join('')}</section>
    <section class="insight-analytics" aria-label="Activity analytics">
      <article class="card weekly-activity-card"><div class="insight-card-heading"><div><p class="eyebrow">WEEKLY VIEW</p><h3>Activity by day</h3></div><span class="chart-caption">Latest 8 weeks · count of recorded activities</span></div>
        <div class="activity-grid" role="grid" aria-label="Daily activity counts for the latest eight weeks, Monday through Sunday">
          <div class="activity-grid-corner" aria-hidden="true">Week</div>
          <div class="activity-day-headers" role="row">${[['Monday', 'Mon'], ['Tuesday', 'Tue'], ['Wednesday', 'Wed'], ['Thursday', 'Thu'], ['Friday', 'Fri'], ['Saturday', 'Sat'], ['Sunday', 'Sun']].map(([day, shortDay]) => `<span role="columnheader" title="${day}">${shortDay}</span>`).join('')}</div>
          ${weeklyRows.map((week, rowIndex) => {
            const startLabel = week[0].date;
            const weekLabel = new Date(`${startLabel}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `<div class="activity-week-label" role="rowheader" title="Week beginning ${escapeHtml(weekLabel)}">${escapeHtml(weekLabel)}</div><div class="activity-week-row" role="row">${week.map((day, dayIndex) => `<span class="activity-cell ${day.level}" role="gridcell" title="${day.count === null ? `${day.label}: future date; no activity data yet` : `${day.label}: ${day.count} recorded ${day.count === 1 ? 'activity' : 'activities'}`}" aria-label="${day.count === null ? `${day.label}, future date; no activity data yet` : `${day.label}, ${day.count} recorded ${day.count === 1 ? 'activity' : 'activities'}`}"><small>${day.day}</small><strong>${day.count === null ? '–' : day.count}</strong></span>`).join('')}</div>`;
          }).join('')}
        </div>
        <div class="activity-grid-legend" aria-label="Activity count legend">
          <span>Less</span><i class="level-0" title="0 activities"></i><i class="level-1" title="1 activity"></i><i class="level-2" title="2–3 activities"></i><i class="level-3" title="4 or more activities"></i><span>More</span>
          <small>0–1 red · 2–3 yellow · 4+ green</small>
        </div>
      </article>
      <article class="card monthly-activity-card"><div class="insight-card-heading"><div><p class="eyebrow">MONTHLY VIEW</p><h3>Daily activity</h3></div><span id="monthly-activity-period" class="chart-caption">Selected month · recorded activity count</span></div><p class="chart-helper">One point per date, counting completed activity records. Hover or tap a point for the exact date and count.</p><div class="chart-canvas-wrap"><canvas id="dashboard-chart" aria-label="Daily activity count for the selected month"></canvas></div></article>
    </section>
    <section class="kmeans-section" aria-labelledby="kmeans-heading">
      <div class="insight-card-heading"><div><p class="eyebrow">PATTERN GROUPING</p><h3 id="kmeans-heading">K-Means analysis</h3></div><span class="model-badge">${escapeHtml(classifier.model || 'K-Means')}</span></div>
      <p class="kmeans-explanation">${classifier.coldStart ? escapeHtml(classifier.reason || 'More activity history is needed before a cluster can be assigned.') : 'The model groups the current 7-day activity pattern with similar historical weeks. A cluster number is a group label, not a grade.'}</p>
      <div class="kmeans-metrics">
        <article class="card kmeans-metric"><span>Cluster assignment</span><strong>${clusterValue}</strong><small>${escapeHtml(classifier.classification || 'Collecting activity')}</small></article>
        <article class="card kmeans-metric"><span>Cluster quality</span><strong>${clusterQuality}</strong><small>Learned cluster feature quality</small></article>
        <article class="card kmeans-metric"><span>Confidence level</span><strong>${confidence}</strong><small>${classifier.historyWeeks === undefined ? 'Training history unavailable' : `${escapeHtml(classifier.historyWeeks)} active history weeks`}</small></article>
        <article class="card kmeans-metric"><span>Distance</span><strong>Unavailable</strong><small>The current API does not expose a distance value.</small></article>
        <article class="card kmeans-metric"><span>Silhouette score</span><strong>${silhouette}</strong><small>Separation between historical clusters</small></article>
      </div>
    </section>
    <section class="intelligence-lists" aria-label="Explanation and next steps">
      <article class="card insight-list-card"><h3>Why this score</h3>${insight.reasons?.length ? `<ul>${insight.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : `<p class="insight-empty">${escapeHtml(explanation)}</p>`}</article>
      <article class="card insight-list-card"><h3>What is working</h3>${insight.positivePatterns?.length ? `<ul>${insight.positivePatterns.map(pattern => `<li>${escapeHtml(pattern)}</li>`).join('')}</ul>` : '<p class="insight-empty">No positive pattern is established yet.</p>'}</article>
      <article class="card insight-list-card"><h3>Practical next steps</h3>${uniqueSuggestions.length ? `<ul>${uniqueSuggestions.map(recommendation => `<li>${escapeHtml(recommendation)}</li>`).join('')}</ul>` : '<p class="insight-empty">No suggestions are available for the current data.</p>'}</article>
      <article class="card insight-list-card"><h3>Pattern check</h3><p class="anomaly-status">${anomaly.anomaly ? 'Unusual activity detected' : 'No unusual activity detected'}</p><p>${escapeHtml(anomaly.reason || 'Not enough historical data to analyze behavior.')}</p><small>Severity: ${escapeHtml(anomaly.severity || 'Unavailable')}</small></article>
    </section>`;

  if (typeof renderDashboardChart === 'function') renderDashboardChart();
}

function initApp() {
  // ---- Bottom nav ----
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.screen));
  });

  // ---- Back buttons (data-back attribute) ----
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goBack(btn.dataset.back));
  });

  // ---- FAB → Add Platform screen ----
  document.getElementById('btn-add-platform').addEventListener('click', () => {
    navigateTo('screen-add-platform');
  });

  document.getElementById('btn-settings').addEventListener('click', () => navigateTo('screen-settings'));
  document.getElementById('open-activity-history').addEventListener('click', () => {
    navigateTo('screen-add-platform');
    if (typeof selectManagerPanel === 'function') selectManagerPanel('history');
  });
  document.getElementById('btn-notifications').addEventListener('click', openNotificationPanel);
  document.addEventListener('click', event => {
    if (!event.target.closest('.notification-wrap')) closeNotificationPanel();
  });
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await AppData.logout(); } catch (error) { console.error(error); }
    navigateTo('screen-auth', { replace: true });
  });

  let authMode = 'login';
  const authForm = document.getElementById('auth-form');
  const authToggle = document.getElementById('auth-mode-toggle');
  const authSubmit = document.getElementById('auth-submit');
  const nameField = document.getElementById('auth-name-field');
  const confirmField = document.getElementById('auth-confirm-field');
  const securityFields = document.getElementById('auth-security-fields');
  const authName = document.getElementById('auth-name');
  const confirmPassword = document.getElementById('auth-confirm-password');
  const securityQuestion = document.getElementById('auth-security-question');
  const securityAnswer = document.getElementById('auth-security-answer');
  authToggle.addEventListener('click', () => {
    authMode = authMode === 'login' ? 'register' : 'login';
    authSubmit.textContent = authMode === 'login' ? 'Login' : 'Create account';
    document.getElementById('auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    document.getElementById('auth-email-label').textContent = authMode === 'login' ? 'Email / User ID' : 'Email address';
    document.getElementById('auth-email').autocomplete = authMode === 'login' ? 'username' : 'email';
    document.getElementById('auth-email').placeholder = authMode === 'login' ? 'you@example.com or user ID' : 'you@example.com';
    authToggle.textContent = authMode === 'login' ? 'Create New Account' : 'Already have an account? Login';
    nameField.hidden = authMode !== 'register';
    confirmField.hidden = authMode !== 'register';
    securityFields.hidden = authMode !== 'register';
    authName.disabled = authMode !== 'register';
    authName.required = authMode === 'register';
    confirmPassword.disabled = authMode !== 'register';
    confirmPassword.required = authMode === 'register';
    securityQuestion.disabled = authMode !== 'register';
    securityQuestion.required = authMode === 'register';
    securityAnswer.disabled = authMode !== 'register';
    securityAnswer.required = authMode === 'register';
    document.getElementById('remember-row').hidden = authMode !== 'login';
    document.getElementById('forgot-password').hidden = authMode !== 'login';
    document.getElementById('auth-status').textContent = authMode === 'register' ? 'Use a password with at least 10 characters.' : '';
  });
  document.querySelectorAll('[data-password-target]').forEach(button => button.addEventListener('click', () => {
    const password = document.getElementById(button.dataset.passwordTarget);
    const visible = password.type === 'password';
    password.type = visible ? 'text' : 'password';
    button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${button.dataset.passwordTarget === 'auth-password' ? 'password' : 'confirm password'}`);
    button.title = visible ? 'Hide password' : 'Show password';
  }));
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('auth-password').value;
    if (authMode === 'register' && password !== confirmPassword.value) {
      document.getElementById('auth-status').textContent = 'Passwords do not match.';
      confirmPassword.focus();
      return;
    }
    authSubmit.disabled = true;
    document.getElementById('auth-status').textContent = authMode === 'register' ? 'Creating your account…' : 'Signing in…';
    try {
      const profile = await AppData.authenticate(authMode, {
        name: authName.value.trim(),
        email: document.getElementById('auth-email').value,
        password,
        ...(authMode === 'register' ? { securityQuestion: securityQuestion.value, securityAnswer: securityAnswer.value } : {}),
        remember: authMode === 'login' && document.getElementById('remember-me').checked
      });
      document.getElementById('account-email').textContent = profile.name || profile.email;
      applyTheme((AppData.state.settings || {}).theme || 'system');
      navigateTo('screen-dashboard', { replace: true });
    } catch (error) {
      document.getElementById('auth-status').textContent = error.message;
    } finally {
      authSubmit.disabled = false;
    }
  });

  let recoveryIdentifier = '';
  const recoveryPanel = document.getElementById('auth-recovery');
  const recoveryIdentifierForm = document.getElementById('recovery-identifier-form');
  const recoveryAnswerForm = document.getElementById('recovery-answer-form');
  const recoveryPasswordForm = document.getElementById('recovery-password-form');
  document.getElementById('forgot-password').addEventListener('click', () => {
    recoveryIdentifier = document.getElementById('auth-email').value.trim();
    document.getElementById('recovery-identifier').value = recoveryIdentifier;
    authForm.hidden = true;
    authToggle.hidden = true;
    recoveryPanel.hidden = false;
    recoveryIdentifierForm.hidden = false;
    recoveryAnswerForm.hidden = true;
    recoveryPasswordForm.hidden = true;
    document.getElementById('recovery-identifier-status').textContent = '';
    document.getElementById('recovery-identifier').focus();
  });
  recoveryIdentifierForm.addEventListener('submit', async event => {
    event.preventDefault();
    recoveryIdentifier = document.getElementById('recovery-identifier').value.trim();
    const status = document.getElementById('recovery-identifier-status');
    status.textContent = 'Looking up account…';
    try {
      const result = await AppData.getRecoveryQuestion(recoveryIdentifier);
      document.getElementById('recovery-question').textContent = result.securityQuestion;
      recoveryIdentifierForm.hidden = true;
      recoveryAnswerForm.hidden = false;
      document.getElementById('recovery-answer').focus();
    } catch (error) { status.textContent = error.message; }
  });
  recoveryAnswerForm.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('recovery-answer-status');
    status.textContent = 'Checking answer…';
    try {
      await AppData.verifyRecoveryAnswer(recoveryIdentifier, document.getElementById('recovery-answer').value);
      recoveryAnswerForm.hidden = true;
      recoveryPasswordForm.hidden = false;
      document.getElementById('recovery-new-password').focus();
    } catch (error) { status.textContent = error.message; }
  });
  recoveryPasswordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('recovery-password-status');
    const newPassword = document.getElementById('recovery-new-password').value;
    if (newPassword !== document.getElementById('recovery-confirm-password').value) {
      status.textContent = 'New passwords do not match.';
      return;
    }
    status.textContent = 'Updating password…';
    try {
      await AppData.resetPassword(newPassword);
      recoveryPanel.hidden = true;
      authForm.hidden = false;
      authToggle.hidden = false;
      document.getElementById('auth-email').value = recoveryIdentifier;
      document.getElementById('auth-password').value = '';
      document.getElementById('auth-status').textContent = 'Password updated. Sign in with your new password.';
      event.currentTarget.reset();
      document.getElementById('auth-password').focus();
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('recovery-back').addEventListener('click', () => {
    recoveryPanel.hidden = true;
    authForm.hidden = false;
    authToggle.hidden = false;
    document.getElementById('auth-status').textContent = '';
  });

  AppData.checkSession().then(profile => {
    if (profile) {
      document.getElementById('account-email').textContent = profile.name || profile.email;
      applyTheme((AppData.state.settings || {}).theme || 'system');
      navigateTo('screen-dashboard', { replace: true });
    } else {
      navigateTo('screen-auth', { replace: true });
    }
  }).catch(error => {
    document.getElementById('auth-status').textContent = `Could not reach the app server: ${error.message}`;
    navigateTo('screen-auth', { replace: true });
  });
}

document.addEventListener('DOMContentLoaded', initApp);

function renderTargets() {
  const screen = document.getElementById('screen-targets');
  if (!screen) return;
  renderGoalsManager(screen);
}
