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
  const settings = { notificationsEnabled: true, platformRemindersEnabled: true, motivationEnabled: true, browserNotificationsEnabled: false, reminderTime: '19:00', reminderGapMinutes: 3, theme: 'system', animations: true, autoSync: true, ...(AppData.state.settings || {}) };
  const profile = AppData.profile || AppData.state.profile || {};
  const container = document.getElementById('settings-content');
  container.innerHTML = `<div class="card settings-card"><div class="settings-heading">Account</div>
    <form id="profile-form" class="settings-form"><label class="settings-field">Name<input id="profile-name" type="text" maxlength="80" value="${escapeHtml(profile.name || '')}" required></label><label class="settings-field">Email<input type="email" value="${escapeHtml(profile.email || '')}" readonly></label><button class="btn-secondary" type="submit">Save profile</button><p class="settings-status" id="profile-status" role="status"></p></form>
    <form id="password-form" class="settings-form"><strong class="settings-subheading">Change password</strong><label class="settings-field">Current password<input id="current-password" type="password" autocomplete="current-password" required></label><label class="settings-field">New password<input id="new-password" type="password" minlength="10" autocomplete="new-password" required></label><label class="settings-field">Confirm new password<input id="confirm-new-password" type="password" minlength="10" autocomplete="new-password" required></label><button class="btn-secondary" type="submit">Update password</button><p class="settings-status" id="password-status" role="status"></p></form>
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
  const authName = document.getElementById('auth-name');
  const confirmPassword = document.getElementById('auth-confirm-password');
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
    authName.disabled = authMode !== 'register';
    authName.required = authMode === 'register';
    confirmPassword.disabled = authMode !== 'register';
    confirmPassword.required = authMode === 'register';
    document.getElementById('remember-row').hidden = authMode !== 'login';
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
        remember: document.getElementById('remember-me').checked
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