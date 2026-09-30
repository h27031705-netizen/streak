const MANUAL_PLATFORM_IDS = ['codechef', 'speakits', 'duolingo', 'dsa-ideas'];
let dashboardChart;

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
    const lastActivity = getPlatformStats(AppData.getPlatform(candidate.id)).lastActivity;
    return lastActivity && daysBetween(lastActivity, todayISO()) >= candidate.days;
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
