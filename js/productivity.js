'use strict';

function selectManagerPanel(panelName) {
  const root = document.getElementById('ap-content');
  if (!root) return;
  const allowed = ['platforms', 'activities', 'projects', 'goals', 'history'];
  const selected = allowed.includes(panelName) ? panelName : 'platforms';
  root.dataset.activePanel = selected;
  root.querySelectorAll('[data-manager-tab]').forEach(tab => {
    const active = tab.dataset.managerTab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.classList.toggle('is-active', active);
  });
  allowed.forEach(panel => {
    const section = root.querySelector(`#manager-panel-${panel}`);
    if (section) section.hidden = panel !== selected;
  });
  if (selected === 'activities') renderCustomActivitiesManager(root);
  if (selected === 'projects') renderProjectsManager(root);
  if (selected === 'goals') renderGoalsManager(root);
  if (selected === 'history') renderHistoryManager(root);
  root.querySelectorAll('[data-manager-tab]').forEach(tab => {
    tab.onclick = () => selectManagerPanel(tab.dataset.managerTab);
  });
}

function renderCustomActivitiesManager(root) {
  const container = root.querySelector('#activities-manager-content');
  const activities = AppData.state.customActivities || [];
  container.innerHTML = `<div class="manager-section-heading"><div><h3>Recurring activities</h3><p>Create repeatable study, exercise, reading, research, or certification habits.</p></div><button id="custom-activity-add" class="btn-primary" type="button">+ Add activity</button></div>
    <form id="custom-activity-form" class="workspace-form" hidden>
      <strong id="custom-activity-form-title">Add activity</strong>
      <label>Name<input id="custom-activity-name" type="text" maxlength="80" required></label>
      <label>Description<input id="custom-activity-description" type="text" maxlength="1000"></label>
      <div class="workspace-form-grid"><label>Category<select id="custom-activity-category"><option value="study">Study</option><option value="practice">Practice</option><option value="project">Project work</option><option value="health">Health</option><option value="other">Other</option></select></label><label>Unit<select id="custom-activity-unit"><option value="sessions">Sessions</option><option value="minutes">Minutes</option><option value="problems">Problems</option><option value="pages">Pages</option><option value="hours">Hours</option><option value="items">Items</option></select></label></div>
      <div class="workspace-form-grid"><label>Frequency per week<input id="custom-activity-frequency" type="number" min="1" max="14" step="0.5" value="3" required></label><label>Target per session<input id="custom-activity-target" type="number" min="0.1" max="100000" step="any" value="1" required></label></div>
      <label>Status<select id="custom-activity-status"><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <div class="workspace-actions"><button class="btn-primary" type="submit">Save activity</button><button id="custom-activity-cancel" class="btn-secondary" type="button">Cancel</button></div><p id="custom-activity-status-message" class="workspace-status" role="status"></p>
    </form>
    <div class="workspace-list">${activities.length ? activities.map(activity => `<article class="card workspace-card"><div class="workspace-card-header"><div><h4>${escapeHtml(activity.name)}</h4><p>${escapeHtml(activity.category)} · ${Number(activity.frequencyPerWeek)}× / week · target ${Number(activity.targetPerSession)} ${escapeHtml(activity.unit)} · ${escapeHtml(activity.status)}</p></div><span class="workspace-status-tag ${activity.status === 'active' ? 'is-active' : ''}">${escapeHtml(activity.status)}</span></div>${activity.description ? `<p class="workspace-description">${escapeHtml(activity.description)}</p>` : ''}<div class="workspace-actions"><button type="button" class="btn-secondary" data-activity-log="${Number(activity.id)}" ${activity.status !== 'active' ? 'disabled' : ''}>Log / complete</button><button type="button" class="btn-secondary" data-activity-edit="${Number(activity.id)}">Edit</button><button type="button" class="btn-secondary workspace-delete" data-activity-delete="${Number(activity.id)}">Delete</button></div><form class="workspace-inline-form" data-activity-log-form="${Number(activity.id)}" hidden><label>Date<input type="date" name="date" value="${todayISO()}" required></label><label>Amount<input type="number" name="amount" min="0.1" step="any" value="${Number(activity.targetPerSession)}" required></label><label>Note<input type="text" name="note" maxlength="1000"></label><label class="workspace-check"><input type="checkbox" name="completed" checked>Completed</label><button class="btn-primary" type="submit">Save log</button><p class="workspace-status" role="status"></p></form></article>`).join('') : '<p class="workspace-empty">No activities yet. Add one to start building your own practice rhythm.</p>'}</div>`;

  const form = container.querySelector('#custom-activity-form');
  const addButton = container.querySelector('#custom-activity-add');
  const finish = () => {
    form.reset();
    delete form.dataset.activityId;
    form.hidden = true;
    addButton.hidden = false;
    container.querySelector('#custom-activity-form-title').textContent = 'Add activity';
    form.querySelector('[type="submit"]').textContent = 'Save activity';
    container.querySelector('#custom-activity-status-message').textContent = '';
  };
  addButton.addEventListener('click', () => { form.hidden = false; addButton.hidden = true; container.querySelector('#custom-activity-name').focus(); });
  container.querySelector('#custom-activity-cancel').addEventListener('click', finish);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const status = container.querySelector('#custom-activity-status-message');
    const button = form.querySelector('[type="submit"]');
    const data = {
      name: container.querySelector('#custom-activity-name').value.trim(),
      description: container.querySelector('#custom-activity-description').value.trim(),
      category: container.querySelector('#custom-activity-category').value,
      unit: container.querySelector('#custom-activity-unit').value,
      frequencyPerWeek: Number(container.querySelector('#custom-activity-frequency').value),
      targetPerSession: Number(container.querySelector('#custom-activity-target').value),
      status: container.querySelector('#custom-activity-status').value
    };
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const activityId = form.dataset.activityId;
      const saved = activityId ? await AppData.updateCustomActivity(activityId, data) : await AppData.createCustomActivity(data);
      finish();
      renderCustomActivitiesManager(root);
      renderDashboardCards();
      showToast(`${saved.name} ${activityId ? 'updated' : 'added'}.`);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  container.querySelectorAll('[data-activity-edit]').forEach(button => button.addEventListener('click', () => {
    const activity = activities.find(item => item.id === Number(button.dataset.activityEdit));
    if (!activity) return;
    form.dataset.activityId = String(activity.id);
    container.querySelector('#custom-activity-name').value = activity.name;
    container.querySelector('#custom-activity-description').value = activity.description || '';
    container.querySelector('#custom-activity-category').value = activity.category;
    container.querySelector('#custom-activity-unit').value = activity.unit;
    container.querySelector('#custom-activity-frequency').value = activity.frequencyPerWeek;
    container.querySelector('#custom-activity-target').value = activity.targetPerSession;
    container.querySelector('#custom-activity-status').value = activity.status;
    container.querySelector('#custom-activity-form-title').textContent = 'Edit activity';
    form.querySelector('[type="submit"]').textContent = 'Update activity';
    form.hidden = false;
    addButton.hidden = true;
    container.querySelector('#custom-activity-name').focus();
  }));
  container.querySelectorAll('[data-activity-delete]').forEach(button => button.addEventListener('click', async () => {
    const activity = activities.find(item => item.id === Number(button.dataset.activityDelete));
    if (!activity || !window.confirm(`Delete ${activity.name}? Its history will remain in unified activity.`)) return;
    button.disabled = true;
    try {
      await AppData.deleteCustomActivity(activity.id);
      renderCustomActivitiesManager(root);
      renderDashboardCards();
      showToast(`${activity.name} deleted.`);
    } catch (error) { button.disabled = false; showToast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-activity-log]').forEach(button => button.addEventListener('click', () => {
    const logForm = container.querySelector(`[data-activity-log-form="${button.dataset.activityLog}"]`);
    if (logForm) logForm.hidden = !logForm.hidden;
  }));
  container.querySelectorAll('[data-activity-log-form]').forEach(logForm => logForm.addEventListener('submit', async event => {
    event.preventDefault();
    const status = logForm.querySelector('.workspace-status');
    const button = logForm.querySelector('[type="submit"]');
    const formData = new FormData(logForm);
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      const log = await AppData.logCustomActivity(logForm.dataset.activityLogForm, {
        date: formData.get('date'), amount: Number(formData.get('amount')), note: formData.get('note'), completed: formData.get('completed') === 'on'
      });
      renderCustomActivitiesManager(root);
      renderDashboardCards();
      showToast(`${log.completed ? 'Activity completed' : 'Activity logged'} · ${log.amount} ${activities.find(item => item.id === Number(log.activityId))?.unit || 'items'}.`);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }));
}

function renderProjectsManager(root) {
  const container = root.querySelector('#projects-manager-content');
  const projects = AppData.state.projects || [];
  container.innerHTML = `<div class="manager-section-heading"><div><h3>Projects</h3><p>Break project work into dated tasks; progress is calculated from completed tasks.</p></div><button id="project-add" class="btn-primary" type="button">+ Add project</button></div>
    <form id="project-form" class="workspace-form" hidden><strong id="project-form-title">Add project</strong><label>Name<input id="project-name" type="text" maxlength="100" required></label><label>Description<textarea id="project-description" maxlength="2000" rows="2"></textarea></label><div class="workspace-form-grid"><label>Deadline<input id="project-deadline" type="date"></label><label>Priority<select id="project-priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label></div><label>Status<select id="project-status"><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label><div class="workspace-actions"><button class="btn-primary" type="submit">Save project</button><button id="project-cancel" class="btn-secondary" type="button">Cancel</button></div><p id="project-form-status" class="workspace-status" role="status"></p></form>
    <div class="workspace-list">${projects.length ? projects.map(project => {
      const tasks = project.tasks || [];
      const completed = tasks.filter(task => task.status === 'completed').length;
      const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
      return `<article class="card workspace-card project-card"><div class="workspace-card-header"><div><h4>${escapeHtml(project.name)}</h4><p>${escapeHtml(project.status)} · ${escapeHtml(project.priority)} priority${project.deadline ? ` · due ${formatDateLabel(project.deadline)}` : ''}</p></div><strong>${progress}%</strong></div>${project.description ? `<p class="workspace-description">${escapeHtml(project.description)}</p>` : ''}<div class="workspace-progress"><span style="width:${progress}%"></span></div><div class="project-task-list">${tasks.length ? tasks.map(task => `<div class="project-task"><button type="button" class="task-toggle ${task.status === 'completed' ? 'is-complete' : ''}" data-task-toggle="${project.id}:${task.id}" aria-pressed="${task.status === 'completed'}">${task.status === 'completed' ? '✓' : '○'}</button><div><strong>${escapeHtml(task.title)}</strong><small>${task.status === 'completed' ? `Completed ${task.completedAt ? formatDateLabel(task.completedAt) : ''}` : task.deadline ? `Due ${formatDateLabel(task.deadline)}` : 'Pending'}${task.description ? ` · ${escapeHtml(task.description)}` : ''}</small></div><button type="button" class="icon-btn task-delete" data-task-delete="${project.id}:${task.id}" aria-label="Delete ${escapeHtml(task.title)}">×</button></div>`).join('') : '<p class="workspace-empty">No tasks yet.</p>'}</div><div class="workspace-actions"><button type="button" class="btn-secondary" data-task-add="${project.id}">+ Add task</button><button type="button" class="btn-secondary" data-project-edit="${project.id}">Edit</button><button type="button" class="btn-secondary workspace-delete" data-project-delete="${project.id}">Delete</button></div><form class="workspace-inline-form" data-task-form="${project.id}" hidden><label>Task title<input name="title" type="text" maxlength="160" required></label><label>Description<input name="description" type="text" maxlength="1000"></label><label>Deadline<input name="deadline" type="date"></label><button class="btn-primary" type="submit">Save task</button><p class="workspace-status" role="status"></p></form></article>`;
    }).join('') : '<p class="workspace-empty">No projects yet. Add a project and create its first task.</p>'}</div>`;

  const form = container.querySelector('#project-form');
  const addButton = container.querySelector('#project-add');
  const finish = () => { form.reset(); delete form.dataset.projectId; form.hidden = true; addButton.hidden = false; container.querySelector('#project-form-title').textContent = 'Add project'; form.querySelector('[type="submit"]').textContent = 'Save project'; container.querySelector('#project-form-status').textContent = ''; };
  addButton.addEventListener('click', () => { form.hidden = false; addButton.hidden = true; container.querySelector('#project-name').focus(); });
  container.querySelector('#project-cancel').addEventListener('click', finish);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const status = container.querySelector('#project-form-status');
    const projectData = { name: container.querySelector('#project-name').value.trim(), description: container.querySelector('#project-description').value.trim(), deadline: container.querySelector('#project-deadline').value || null, priority: container.querySelector('#project-priority').value, status: container.querySelector('#project-status').value };
    button.disabled = true; status.textContent = 'Saving…';
    try {
      const projectId = form.dataset.projectId;
      const saved = projectId ? await AppData.updateProject(projectId, projectData) : await AppData.createProject(projectData);
      finish(); renderProjectsManager(root); renderDashboardCards(); showToast(`${saved.name} ${projectId ? 'updated' : 'created'}.`);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  container.querySelectorAll('[data-project-edit]').forEach(button => button.addEventListener('click', () => {
    const project = projects.find(item => item.id === Number(button.dataset.projectEdit));
    if (!project) return;
    form.dataset.projectId = String(project.id);
    container.querySelector('#project-name').value = project.name;
    container.querySelector('#project-description').value = project.description || '';
    container.querySelector('#project-deadline').value = project.deadline || '';
    container.querySelector('#project-priority').value = project.priority;
    container.querySelector('#project-status').value = project.status;
    container.querySelector('#project-form-title').textContent = 'Edit project';
    form.querySelector('[type="submit"]').textContent = 'Update project';
    form.hidden = false; addButton.hidden = true;
  }));
  container.querySelectorAll('[data-project-delete]').forEach(button => button.addEventListener('click', async () => {
    const project = projects.find(item => item.id === Number(button.dataset.projectDelete));
    if (!project || !window.confirm(`Archive ${project.name}? Completed task history will be kept.`)) return;
    button.disabled = true;
    try { await AppData.deleteProject(project.id); renderProjectsManager(root); renderDashboardCards(); showToast(`${project.name} archived.`); }
    catch (error) { button.disabled = false; showToast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-task-add]').forEach(button => button.addEventListener('click', () => {
    const taskForm = container.querySelector(`[data-task-form="${button.dataset.taskAdd}"]`);
    if (taskForm) taskForm.hidden = !taskForm.hidden;
  }));
  container.querySelectorAll('[data-task-form]').forEach(taskForm => taskForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(taskForm);
    const submit = taskForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await AppData.createProjectTask(taskForm.dataset.taskForm, { title: data.get('title'), description: data.get('description'), deadline: data.get('deadline') || null });
      renderProjectsManager(root); renderDashboardCards(); showToast('Task added to project.');
    } catch (error) { taskForm.querySelector('.workspace-status').textContent = error.message; }
    finally { submit.disabled = false; }
  }));
  container.querySelectorAll('[data-task-toggle]').forEach(button => button.addEventListener('click', async () => {
    const [projectId, taskId] = button.dataset.taskToggle.split(':').map(Number);
    const project = projects.find(item => item.id === projectId);
    const task = project?.tasks.find(item => item.id === taskId);
    if (!task) return;
    button.disabled = true;
    try {
      await AppData.updateProjectTask(projectId, taskId, { ...task, status: task.status === 'completed' ? 'pending' : 'completed' });
      renderProjectsManager(root); renderDashboardCards();
      showToast(task.status === 'completed' ? 'Task reopened.' : 'Task completed.');
    } catch (error) { button.disabled = false; showToast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-task-delete]').forEach(button => button.addEventListener('click', async () => {
    const [projectId, taskId] = button.dataset.taskDelete.split(':').map(Number);
    const project = projects.find(item => item.id === projectId);
    const task = project?.tasks.find(item => item.id === taskId);
    if (!task || !window.confirm(`Remove task ${task.title}?`)) return;
    button.disabled = true;
    try { await AppData.deleteProjectTask(projectId, taskId); renderProjectsManager(root); renderDashboardCards(); showToast('Task removed.'); }
    catch (error) { button.disabled = false; showToast(error.message, 'error'); }
  }));
}

function renderGoalsManager(root) {
  const container = root.querySelector('#goals-manager-content');
  const goals = AppData.state.goals || [];
  container.innerHTML = `<div class="manager-section-heading"><div><h3>Goals</h3><p>Track measurable outcomes with deadlines and priority; progress changes are recorded in history.</p></div><button id="goal-add" class="btn-primary" type="button">+ Add goal</button></div>
    <form id="goal-form" class="workspace-form" hidden><strong id="goal-form-title">Add goal</strong><label>Name<input id="goal-name" type="text" maxlength="100" required></label><label>Description<textarea id="goal-description" maxlength="2000" rows="2"></textarea></label><div class="workspace-form-grid"><label>Target<input id="goal-target" type="number" min="0.1" step="any" required></label><label>Unit<input id="goal-unit" type="text" maxlength="30" value="items" required></label></div><div class="workspace-form-grid"><label>Deadline<input id="goal-deadline" type="date"></label><label>Priority<select id="goal-priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select></label></div><label>Status<select id="goal-status"><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select></label><div class="workspace-actions"><button class="btn-primary" type="submit">Save goal</button><button id="goal-cancel" class="btn-secondary" type="button">Cancel</button></div><p id="goal-form-status" class="workspace-status" role="status"></p></form>
    <div class="workspace-list">${goals.length ? goals.map(goal => {
      const percent = Math.min(100, Math.round(Number(goal.currentValue) / Number(goal.targetValue) * 100));
      return `<article class="card workspace-card goal-card"><div class="workspace-card-header"><div><h4>${escapeHtml(goal.name)}</h4><p>${escapeHtml(goal.status)} · ${escapeHtml(goal.priority)} priority${goal.deadline ? ` · due ${formatDateLabel(goal.deadline)}` : ''}</p></div><strong>${percent}%</strong></div>${goal.description ? `<p class="workspace-description">${escapeHtml(goal.description)}</p>` : ''}<div class="workspace-progress"><span style="width:${percent}%"></span></div><p class="goal-count">${Number(goal.currentValue).toLocaleString()} / ${Number(goal.targetValue).toLocaleString()} ${escapeHtml(goal.unit)}</p><div class="workspace-actions">${goal.status === 'active' ? `<button type="button" class="btn-secondary" data-goal-progress="${goal.id}">Add progress</button>` : ''}<button type="button" class="btn-secondary" data-goal-edit="${goal.id}">Edit</button><button type="button" class="btn-secondary workspace-delete" data-goal-delete="${goal.id}">Delete</button></div>${goal.status === 'active' ? `<form class="workspace-inline-form" data-goal-progress-form="${goal.id}" hidden><label>Progress amount<input name="amount" type="number" min="0.1" step="any" required></label><label>Date<input name="date" type="date" value="${todayISO()}" required></label><label>Note<input name="note" type="text" maxlength="1000"></label><button class="btn-primary" type="submit">Save progress</button><p class="workspace-status" role="status"></p></form>` : ''}</article>`;
    }).join('') : '<p class="workspace-empty">No goals yet. Add a target and deadline to track measurable progress.</p>'}</div>`;

  const form = container.querySelector('#goal-form');
  const addButton = container.querySelector('#goal-add');
  const finish = () => { form.reset(); delete form.dataset.goalId; form.hidden = true; addButton.hidden = false; container.querySelector('#goal-form-title').textContent = 'Add goal'; form.querySelector('[type="submit"]').textContent = 'Save goal'; container.querySelector('#goal-form-status').textContent = ''; };
  addButton.addEventListener('click', () => { form.hidden = false; addButton.hidden = true; container.querySelector('#goal-name').focus(); });
  container.querySelector('#goal-cancel').addEventListener('click', finish);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const status = container.querySelector('#goal-form-status');
    const data = { name: container.querySelector('#goal-name').value.trim(), description: container.querySelector('#goal-description').value.trim(), targetValue: Number(container.querySelector('#goal-target').value), unit: container.querySelector('#goal-unit').value.trim(), deadline: container.querySelector('#goal-deadline').value || null, priority: container.querySelector('#goal-priority').value, status: container.querySelector('#goal-status').value };
    button.disabled = true; status.textContent = 'Saving…';
    try {
      const goalId = form.dataset.goalId;
      const saved = goalId ? await AppData.updateGoal(goalId, data) : await AppData.createGoal(data);
      finish(); renderGoalsManager(root); renderDashboardCards(); showToast(`${saved.name} ${goalId ? 'updated' : 'created'}.`);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  container.querySelectorAll('[data-goal-edit]').forEach(button => button.addEventListener('click', () => {
    const goal = goals.find(item => item.id === Number(button.dataset.goalEdit));
    if (!goal) return;
    form.dataset.goalId = String(goal.id);
    container.querySelector('#goal-name').value = goal.name;
    container.querySelector('#goal-description').value = goal.description || '';
    container.querySelector('#goal-target').value = goal.targetValue;
    container.querySelector('#goal-unit').value = goal.unit;
    container.querySelector('#goal-deadline').value = goal.deadline || '';
    container.querySelector('#goal-priority').value = goal.priority;
    container.querySelector('#goal-status').value = goal.status;
    container.querySelector('#goal-form-title').textContent = 'Edit goal';
    form.querySelector('[type="submit"]').textContent = 'Update goal';
    form.hidden = false; addButton.hidden = true;
  }));
  container.querySelectorAll('[data-goal-delete]').forEach(button => button.addEventListener('click', async () => {
    const goal = goals.find(item => item.id === Number(button.dataset.goalDelete));
    if (!goal || !window.confirm(`Archive ${goal.name}? Progress history will be kept.`)) return;
    button.disabled = true;
    try { await AppData.deleteGoal(goal.id); renderGoalsManager(root); renderDashboardCards(); showToast(`${goal.name} archived.`); }
    catch (error) { button.disabled = false; showToast(error.message, 'error'); }
  }));
  container.querySelectorAll('[data-goal-progress]').forEach(button => button.addEventListener('click', () => {
    const progressForm = container.querySelector(`[data-goal-progress-form="${button.dataset.goalProgress}"]`);
    if (progressForm) progressForm.hidden = !progressForm.hidden;
  }));
  container.querySelectorAll('[data-goal-progress-form]').forEach(progressForm => progressForm.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(progressForm);
    const button = progressForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await AppData.addGoalProgress(progressForm.dataset.goalProgressForm, Number(data.get('amount')), data.get('date'), data.get('note'));
      renderGoalsManager(root); renderDashboardCards(); showToast(result.goal.status === 'completed' ? 'Goal completed.' : 'Goal progress saved.');
    } catch (error) { progressForm.querySelector('.workspace-status').textContent = error.message; }
    finally { button.disabled = false; }
  }));
}

function renderHistoryManager(root) {
  const container = root.querySelector('#history-manager-content');
  const history = AppData.state.intelligence?.activityHistory || AppData.state.activityHistory || [];
  container.innerHTML = `<div class="manager-section-heading"><div><h3>Unified activity history</h3><p>External sync, manual logs, custom activity, completed project tasks, and goal progress from this account.</p></div></div>${history.length ? `<div class="workspace-history">${history.slice(0, 100).map(event => `<article class="workspace-history-row"><time datetime="${escapeHtml(event.date)}">${formatDateLabel(event.date)}</time><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.type.replace(/-/g, ' '))}${event.detail ? ` · ${escapeHtml(event.detail)}` : ''}</small></div><span>${Number(event.amount).toLocaleString()} ${escapeHtml(event.unit)}</span></article>`).join('')}</div>` : '<p class="workspace-empty">No activity history yet. Sync a platform or log an activity to begin.</p>'}`;
}
