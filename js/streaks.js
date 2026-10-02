/*
  Streak calculation engine.
  Rules:
   - green  : activity today OR yesterday (streak alive)
   - yellow : exactly 1 full day missed (gap == 2 from last activity)
   - red    : 2+ days missed in a row (gap >= 3 from last activity)
*/

function getSortedDates(activityLog) {
  return [...new Set(activityLog.map(a => a.date).filter(date => date <= todayISO()))].sort();
}

function getLastActivityDate(activityLog) {
  const dates = getSortedDates(activityLog);
  return dates.length ? dates[dates.length - 1] : null;
}

function getStreakStatus(activityLog) {
  const lastDate = getLastActivityDate(activityLog);
  if (!lastDate) return 'red'; // never logged = red (needs attention)

  const gap = daysBetween(lastDate, todayISO()); // days since last activity

  if (gap <= 1) return 'green';   // active today or yesterday
  if (gap <= 3) return 'yellow'; // missed one or two days
  return 'red';                   // missed three or more days in a row
}

function calculateCurrentStreak(activityLog) {
  const dates = getSortedDates(activityLog);
  if (!dates.length) return 0;

  // Walk backwards from the most recent date, counting consecutive days
  let streak = 1;
  for (let i = dates.length - 1; i > 0; i--) {
    const diff = daysBetween(dates[i - 1], dates[i]);
    if (diff === 1) {
      streak++;
    } else {
      break;
    }
  }

  // If the streak's last day is too far in the past, it's already broken
  const gapFromToday = daysBetween(dates[dates.length - 1], todayISO());
  if (gapFromToday >= 2) return 0;

  return streak;
}

function calculateLongestStreak(activityLog) {
  const dates = getSortedDates(activityLog);
  if (!dates.length) return 0;

  let longest = 1;
  let current = 1;

  for (let i = 1; i < dates.length; i++) {
    const diff = daysBetween(dates[i - 1], dates[i]);
    if (diff === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }
  return longest;
}

function getPlatformStats(platform) {
  const category = platform.category || 'coding';
  const log = platform.activityLog || [];
  const manual = AppData.state.manualActivities.filter(entry => entry.platform_id === platform.id);
  const dates = [...new Set([...log.map(entry => entry.date), ...manual.map(entry => entry.date)])].filter(date => date <= todayISO()).sort();
  const freezeRanges = AppData.state.settings.platformFreezeHistory?.[platform.id] || [];
  const isFrozenDate = date => freezeRanges.some(range => date >= range.from && (!range.to || date <= range.to));
  const unfrozenDaysBetween = (start, end) => {
    let count = 0;
    const date = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    while (date <= endDate) {
      const iso = date.toISOString().slice(0, 10);
      if (!isFrozenDate(iso)) count++;
      date.setUTCDate(date.getUTCDate() + 1);
    }
    return count;
  };
  let currentStreak = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  dates.forEach((date, index) => {
    runningStreak = index && unfrozenDaysBetween(dates[index - 1], date) === 0 ? runningStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, runningStreak);
  });
  if (dates.length && unfrozenDaysBetween(dates[dates.length - 1], todayISO()) <= 1) currentStreak = runningStreak;
  const topicCounts = {};
  log.forEach(entry => (entry.topics || []).forEach(topic => {
    topicCounts[topic] = (topicCounts[topic] || 0) + 1;
  }));
  const loggedProblems = log.reduce((sum, entry) => sum + (entry.problemsSolved || 0), 0);
  const manualTotal = manual.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const total = category === 'coding'
    ? Number(platform.stats?.totalSolved ?? (loggedProblems + manualTotal))
    : manualTotal;
  const lastActivity = dates.length ? dates[dates.length - 1] : null;
  const activeLog = dates.map(date => ({ date }));
  const weeklyTotal = log.filter(entry => {
    const age = daysBetween(entry.date, todayISO());
    return age >= 0 && age <= 6;
  }).reduce((sum, entry) => sum + (entry.problemsSolved || 0), 0) + manual.filter(entry => {
    const age = daysBetween(entry.date, todayISO());
    return age >= 0 && age <= 6;
  }).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const missedDays = dates.length ? unfrozenDaysBetween(dates[dates.length - 1], todayISO()) : 0;
  return {
    status: platform.frozen ? 'frozen' : !dates.length ? 'red' : missedDays <= 1 ? 'green' : missedDays <= 3 ? 'yellow' : 'red',
    currentStreak,
    longestStreak,
    total,
    totalProblems: category === 'coding' ? total : 0,
    totalSessions: category === 'session' ? total : 0,
    totalXP: category === 'language' ? total : 0,
    totalIdeas: category === 'ideas' ? total : 0,
    totalContests: log.reduce((sum, entry) => sum + (entry.contestsJoined || 0), 0),
    activeDays: dates.length,
    weeklyProblems: weeklyTotal,
    weeklyTotal,
    lastActivity,
    uniqueTopics: [...new Set(log.flatMap(entry => entry.topics || []))],
    topicCounts,
    isCoding: category === 'coding',
    category
  };
}

// Badge helper — returns emoji + label for a given status
function getStatusMeta(status) {
  switch (status) {
    case 'green': return { emoji: '🟢', label: 'On fire' };
    case 'yellow': return { emoji: '🟡', label: '1 day missed' };
    case 'red': return { emoji: '🔴', label: 'Streak broken' };
    case 'frozen': return { emoji: '❄️', label: 'Frozen' };
    default: return { emoji: '⚪', label: 'No data' };
  }
}