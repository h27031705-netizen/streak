/*
  AI Coach — local analytics + recommendation engine.

  FIXED: chart canvases now render inside a height-bound wrapper
  (see CSS) with maintainAspectRatio:false, so they no longer
  freeze/loop-resize inside the flex chat column.
  FIXED: responses now support **bold** and line breaks via
  formatAIText(), instead of dumping raw markdown as text.
*/

const AI_SUGGESTIONS = [
  "Which platform am I using the most?",
  "What are my weak areas?",
  "Give me a daily plan",
  "Show my progress chart",
  "Generate Python code for my stats"
];

function initAIAssistant() {
  const chat = document.getElementById('ai-chat');
  chat.innerHTML = '';
  addAIBubble("Hey there! 👋 I'm your AI Coach. Ask me about your streaks, strengths, weak spots, or say 'generate python code' for your stats!");
  renderAISuggestions();

  document.getElementById('ai-send').addEventListener('click', handleUserAsk);
  document.getElementById('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUserAsk();
  });
}

function renderAISuggestions() {
  let chip = document.querySelector('.ai-suggestions');
  if (chip) chip.remove();
  chip = el('div', 'ai-suggestions');
  AI_SUGGESTIONS.forEach(s => {
    const c = el('div', 'ai-suggestion-chip', s);
    c.addEventListener('click', () => {
      document.getElementById('ai-input').value = s;
      handleUserAsk();
    });
    chip.appendChild(c);
  });
  document.getElementById('ai-chat').after(chip);
}

function handleUserAsk() {
  const input = document.getElementById('ai-input');
  const question = input.value.trim();
  if (!question) return;

  addUserBubble(question);
  input.value = '';

  const typingRow = addTypingIndicator();
  setTimeout(() => {
    typingRow.remove();
    const response = getAIResponse(question);
    addAIBubble(response.text, response.chartData, response.code);
  }, 550);
}

// ---------- Text formatting (FIX: real bold + line breaks) ----------
function formatAIText(text) {
  const escaped = escapeHTML(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ---------- Chat UI helpers ----------
function addUserBubble(text) {
  const chat = document.getElementById('ai-chat');
  const row = el('div', 'ai-bubble-row user');
  row.appendChild(el('div', 'ai-bubble user', escapeHTML(text)));
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function addAIBubble(text, chartData, code) {
  const chat = document.getElementById('ai-chat');
  const row = el('div', 'ai-bubble-row bot');
  row.appendChild(el('div', 'ai-avatar', '🤖'));

  const bubble = el('div', 'ai-bubble bot', formatAIText(text));
  row.appendChild(bubble);
  chat.appendChild(row);

  if (chartData) {
    const wrap = el('div', 'chart-wrapper');
    const canvas = document.createElement('canvas');
    canvas.id = 'ai-chart-' + Date.now() + Math.floor(Math.random() * 1000);
    wrap.appendChild(canvas);
    bubble.appendChild(wrap);
    // Render on next frame so the canvas has real layout dimensions first
    requestAnimationFrame(() => renderAIChart(canvas.id, chartData));
  }

  if (code) {
    bubble.appendChild(el('pre', '', escapeHTML(code)));
  }

  chat.scrollTop = chat.scrollHeight;
  return row;
}

function addTypingIndicator() {
  const chat = document.getElementById('ai-chat');
  const row = el('div', 'ai-bubble-row bot');
  row.appendChild(el('div', 'ai-avatar', '🤖'));
  const bubble = el('div', 'ai-bubble bot');
  bubble.innerHTML = `<div class="ai-typing"><span></span><span></span><span></span></div>`;
  row.appendChild(bubble);
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  return row;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------- Intent Router ----------
function getAIResponse(question) {
  const q = question.toLowerCase();

  if ((q.includes('compare') || q.includes('versus') || q.includes(' vs ')) && q.includes('platform')) return answerPlatformComparison();
  if (q.includes('most') && q.includes('platform')) return answerMostUsedPlatform();
  if (q.includes('yesterday')) return answerDayHistory(daysAgoISO(1), 'yesterday');
  if (q.includes('today')) return answerDayHistory(todayISO(), 'today');
  if (q.includes('weak') || q.includes('improve')) return answerWeakAreas();
  if (q.includes('plan') || q.includes('recommend')) return answerDailyPlan();
  if (q.includes('chart') || q.includes('progress') || q.includes('graph')) return answerProgressChart();
  if (q.includes('python') || q.includes('code')) return answerPythonCode();
  if (q.includes('streak')) return answerStreakSummary();

  return {
    text: "I can tell you which platform you use most, your weak areas, a daily plan, show progress charts, or generate Python code for your stats. Try asking one of those! 😊"
  };
}


function answerDayHistory(date, label) {
  const matches = AppData.getPlatforms().flatMap(platform => (platform.activityLog || []).filter(entry => entry.date === date).map(entry => ({ platform, entry })));
  if (!matches.length) return { text: `I don't have stored activity for ${label} yet. Sync a connected platform and I can check again. 📭` };
  const lines = matches.flatMap(({ platform, entry }) => {
    const problems = (entry.problems || []).map(problem => problem.name).filter(Boolean);
    return [`**${platform.name}** — ${entry.problemsSolved || 0} problem${entry.problemsSolved === 1 ? '' : 's'}${entry.contestsJoined ? ` · ${entry.contestsJoined} contest${entry.contestsJoined === 1 ? '' : 's'}` : ''}`, problems.length ? `Solved: ${problems.join(', ')}` : 'Problem names were not provided by this platform.'];
  });
  return { text: `Here is what I have stored for ${label}:\n\n${lines.join('\n')}` };
}

// ---------- Analysis Functions ----------
function answerMostUsedPlatform() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  if (!platforms.length) return { text: "You haven't added any platforms yet! 🧩" };

  const ranked = platforms
    .map(p => {
      const stats = getPlatformStats(p);
      return { name: p.name, activeDays: stats.activeDays, total: stats.totalProblems, contests: stats.totalContests };
    })
    .sort((a, b) => b.activeDays - a.activeDays || b.total - a.total);

  const top = ranked[0];
  const text = `You use **${top.name}** most often: ${top.activeDays} active day${top.activeDays === 1 ? '' : 's'}, ${top.total} problems solved, and ${top.contests} contest${top.contests === 1 ? '' : 's'}. ${randomEncouragement()}\n\nActive days are the clearest measure of platform usage, so here is the comparison:`;

  return {
    text,
    chartData: {
      type: 'bar',
      labels: ranked.map(r => r.name),
      values: ranked.map(r => r.activeDays),
      label: 'Active Days'
    }
  };
}

function answerPlatformComparison() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  if (platforms.length < 2) return { text: 'Add at least two platforms and I can compare your rhythm across them. 🧩' };
  const ranked = platforms.map(platform => {
    const stats = getPlatformStats(platform);
    return { platform, stats };
  }).sort((a, b) => b.stats.totalProblems - a.stats.totalProblems);
  const strongest = ranked[0];
  const mostConsistent = [...ranked].sort((a, b) => b.stats.activeDays - a.stats.activeDays)[0];
  const lines = ranked.map(item => `• **${item.platform.name}** — ${item.stats.totalProblems} solved · ${item.stats.activeDays} active days · ${item.stats.uniqueTopics.length} topics · ${item.stats.totalContests} contests`).join('\n');
  return { text: `Here is your actual platform comparison:\n\n${lines}\n\n**Volume leader:** ${strongest.platform.name}. **Consistency leader:** ${mostConsistent.platform.name}. To balance your week, give the least-active platform one focused 25-minute session next.` };
}

function answerWeakAreas() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  if (!platforms.length) return { text: "Add a platform first so I can analyze it! 🧩" };

  const statuses = platforms.map(p => ({ name: p.name, stats: getPlatformStats(p) }));
  const weak = statuses.filter(s => s.stats.status !== 'green');

  const topicCounts = {};
  platforms.forEach(p => p.activityLog.forEach(a => (a.topics || []).forEach(t => {
    topicCounts[t] = (topicCounts[t] || 0) + 1;
  })));
  const leastPracticedTopics = Object.entries(topicCounts).sort((a, b) => a[1] - b[1]).slice(0, 3).map(t => t[0]);

  let text = weak.length
    ? `Your streak needs attention on: ${weak.map(w => `**${w.name}** (${getStatusMeta(w.stats.status).label})`).join(', ')}.\n\n`
    : `Great news — all platforms are on active streaks! 🎉\n\n`;

  text += leastPracticedTopics.length
    ? `Topic-wise, you've barely touched: **${leastPracticedTopics.join(', ')}**. Might be worth a focused session there.`
    : `Keep logging topics so I can spot gaps for you!`;

  return { text };
}

function answerDailyPlan() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  if (!platforms.length) return { text: "Add a platform first so I can build you a plan! 🧩" };

  const order = { red: 0, yellow: 1, green: 2 };
  const needsWork = platforms
    .map(p => ({ p, stats: getPlatformStats(p) }))
    .sort((a, b) => order[a.stats.status] - order[b.stats.status]);

  const plan = needsWork.slice(0, 3).map((item, i) =>
    `${i + 1}. **${item.p.name}** — solve 2 problems today${item.stats.status === 'red' ? ' (priority — streak is broken 🔴)' : ''}`
  ).join('\n');

  return { text: `Here's your personalized plan for today:\n\n${plan}\n\nSmall consistent steps beat big irregular bursts. You've got this! 💪` };
}

function answerProgressChart() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  if (!platforms.length) return { text: "Add a platform first so I have data to chart! 🧩" };

  const labels = [];
  for (let i = 6; i >= 0; i--) labels.push(formatDateLabel(daysAgoISO(i)));

  const datasets = platforms.map(p => {
    const values = [];
    for (let i = 6; i >= 0; i--) {
      const date = daysAgoISO(i);
      values.push(p.activityLog.filter(a => a.date === date).reduce((s, a) => s + (a.problemsSolved || 0), 0));
    }
    return { name: p.name, values, color: p.color };
  });

  return {
    text: `Here's your 7-day activity across all platforms 📊`,
    chartData: { type: 'multiline', labels, datasets }
  };
}

function answerStreakSummary() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  if (!platforms.length) return { text: "No platforms yet — tap ➕ on the dashboard to add one!" };

  const lines = platforms.map(p => {
    const s = getPlatformStats(p);
    const meta = getStatusMeta(s.status);
    return `${meta.emoji} **${p.name}**: ${s.currentStreak}-day streak (best: ${s.longestStreak})`;
  });
  return { text: lines.join('\n') };
}

function answerPythonCode() {
  const platforms = AppData.getPlatforms().filter(platform => getPlatformStats(platform).isCoding);
  const dataRows = platforms.flatMap(p => p.activityLog.map(entry => ({
    platform: p.name,
    date: entry.date,
    problems_solved: entry.problemsSolved || 0,
    contests_joined: entry.contestsJoined || 0,
    topics: (entry.topics || []).join(', ')
  })));

  const code = `import pandas as pd
import matplotlib.pyplot as plt

# Generated from your saved StreakForce activity log. This code is not executed by StreakForce.
data = ${JSON.stringify(dataRows, null, 2)}
df = pd.DataFrame(data)
df["date"] = pd.to_datetime(df["date"])

summary = df.groupby("platform", as_index=False).agg(
    problems_solved=("problems_solved", "sum"),
    contests_joined=("contests_joined", "sum"),
    active_days=("date", "nunique")
)

ax = summary.plot(x="platform", y="problems_solved", kind="bar", color="#246BFD", legend=False, figsize=(9, 5))
ax.set_ylabel("Problems solved")
ax.set_xlabel("")
ax.set_title("StreakForce platform activity")
plt.xticks(rotation=25, ha="right")
plt.tight_layout()
plt.show()

`;

  return { text: "Here is accurate Pandas + Matplotlib code built from your saved activity rows. It is ready to run locally; I have not executed it here.", code };
}

// ---------- Chart rendering (FIX: maintainAspectRatio false + bound container) ----------
function renderAIChart(canvasId, chartData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: animationsEnabled() ? 400 : 0 }
  };

  if (chartData.type === 'bar') {
    new Chart(ctx, {
      type: 'bar',
      data: { labels: chartData.labels, datasets: [{ label: chartData.label, data: chartData.values, backgroundColor: '#7C3AED', borderRadius: 6 }] },
      options: { ...commonOptions, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  } else if (chartData.type === 'multiline') {
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: chartData.datasets.map(d => ({
          label: d.name, data: d.values, borderColor: d.color || '#7C3AED',
          fill: false, tension: 0.3, pointRadius: 2
        }))
      },
      options: { ...commonOptions, plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true } } }
    });
  }
}