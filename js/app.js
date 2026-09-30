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

  // Sync bottom nav highlight
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.screen === screenId);
  });

  // Lazy-init screen content
  if (screenId === 'screen-dashboard') renderDashboardCards();
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
  const settings = { notificationsEnabled: true, theme: 'system', animations: true, autoSync: true, ...(AppData.state.settings || {}) };
  const container = document.getElementById('settings-content');
  container.innerHTML = `<div class="card settings-card"><div class="settings-heading">Motivation</div>
    ${settingsToggle('notificationsEnabled', 'In-app motivation', 'Show a short, relevant nudge after a quiet stretch.', settings.notificationsEnabled)}
  </div><div class="card settings-card"><div class="settings-heading">Appearance</div>
    <label class="settings-field">Theme<select id="setting-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    ${settingsToggle('animations', 'Animations', 'Use subtle transitions and animated statistics.', settings.animations)}
  </div><div class="card settings-card"><div class="settings-heading">Data synchronization</div>
    ${settingsToggle('autoSync', 'Sync automatically', 'Refresh connected platforms when the app opens.', settings.autoSync)}
    <p class="settings-helper">Supported public profiles refresh when you open the app. Manual platform entries remain account-specific.</p>
    <button class="btn-primary" id="settings-save">Save reminder time</button><p class="settings-status" id="settings-status" role="status"></p>
  </div>`;
  const themeSelect = container.querySelector('#setting-theme');
  themeSelect.value = ['light', 'dark', 'system'].includes(settings.theme) ? settings.theme : 'system';
  container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = settings[input.dataset.setting]; });
  themeSelect.addEventListener('change', async () => {
    try {
      const saved = await AppData.saveSettings({ ...settings, ...AppData.state.settings, theme: themeSelect.value });
      applyTheme(saved.theme);
      showToast(`${saved.theme[0].toUpperCase()}${saved.theme.slice(1)} theme applied.`);
    } catch (error) {
      showToast(`Theme could not be saved: ${error.message}`, 'error');
    }
  });
  container.querySelectorAll('input[type="checkbox"]').forEach(input => input.addEventListener('change', async () => {
    const next = { ...settings, ...AppData.state.settings, [input.dataset.setting]: input.checked };
    try {
      const saved = await AppData.saveSettings(next);
      applyTheme(saved.theme);
      renderMotivation();
      showToast(`${input.dataset.setting === 'animations' ? 'Animations' : input.dataset.setting === 'notificationsEnabled' ? 'Motivation' : 'Automatic sync'} ${input.checked ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      input.checked = !input.checked;
      showToast(`Setting could not be saved: ${error.message}`, 'error');
    }
  }));
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
  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await AppData.logout(); } catch (error) { console.error(error); }
    navigateTo('screen-auth', { replace: true });
  });

  let authMode = 'login';
  const authForm = document.getElementById('auth-form');
  const authToggle = document.getElementById('auth-mode-toggle');
  const authSubmit = document.getElementById('auth-submit');
  authToggle.addEventListener('click', () => {
    authMode = authMode === 'login' ? 'register' : 'login';
    authSubmit.textContent = authMode === 'login' ? 'Sign in' : 'Create account';
    document.getElementById('auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    authToggle.textContent = authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in';
    document.getElementById('auth-status').textContent = authMode === 'register' ? 'Use a password with at least 10 characters.' : '';
  });
  authForm.addEventListener('submit', async event => {
    event.preventDefault();
    authSubmit.disabled = true;
    document.getElementById('auth-status').textContent = 'Signing in…';
    try {
      const profile = await AppData.authenticate(authMode, document.getElementById('auth-email').value, document.getElementById('auth-password').value);
      document.getElementById('account-email').textContent = profile.email;
      applyTheme((AppData.state.settings || {}).theme || 'system');
      navigateTo('screen-dashboard', { replace: true });
    } catch (error) {
      document.getElementById('auth-status').textContent = error.message;
    } finally {
      authSubmit.disabled = false;
    }
  });

  AppData.checkSession().then(profile => {
    if (profile) {
      document.getElementById('account-email').textContent = profile.email;
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