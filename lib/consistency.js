
'use strict';

const { kMeans } = require('./kmeans');
const { detectAnomaly } = require('./anomaly_detection');

const DAY_MS = 24 * 60 * 60 * 1000;
const SCORE_WEIGHTS = { activity: 0.35, scheduledCompletion: 0.25, rhythm: 0.2, goalProgress: 0.2 };

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function dateOffset(date, offset) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}


function daysBetween(start, end) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) -
      Date.parse(`${start}T00:00:00Z`)) / DAY_MS
  );
}

function getConsecutiveRun(dates) {
  if (!dates.length) return 0;

  let longest = 1;
  let current = 1;

  for (let index = 1; index < dates.length; index++) {
    if (daysBetween(dates[index - 1], dates[index]) === 1) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 1;
    }
  }

  return longest;
}

function distance(left, right) {
  return Math.sqrt(
    left.reduce(
      (sum, value, index) => sum + (value - right[index]) ** 2,
      0
    )
  );
}

function silhouetteScore(points, assignments, centers) {
  if (points.length < 2 || centers.length < 2) return 0;

  const scores = points.map((point, index) => {
    const cluster = assignments[index];

    const sameCluster = points.filter(
      (_, otherIndex) =>
        otherIndex !== index && assignments[otherIndex] === cluster
    );

    if (!sameCluster.length) return 0;

    const a =
      sameCluster.reduce(
        (sum, otherPoint) => sum + distance(point, otherPoint),
        0
      ) / sameCluster.length;

    const otherClusters = centers
      .map((_, clusterIndex) => clusterIndex)
      .filter(clusterIndex => clusterIndex !== cluster);

    const b = Math.min(
      ...otherClusters.map(otherCluster => {
        const otherPoints = points.filter(
          (_, otherIndex) => assignments[otherIndex] === otherCluster
        );

        if (!otherPoints.length) return Infinity;

        return (
          otherPoints.reduce(
            (sum, otherPoint) => sum + distance(point, otherPoint),
            0
          ) / otherPoints.length
        );
      })
    );

    if (!Number.isFinite(b)) return 0;

    return (b - a) / Math.max(a, b, 1e-9);
  });

  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}



function featureQuality(features) {
  return 0.35 * features.activityRate
    + 0.3 * features.completionRate
    + 0.2 * features.streakDensity
    + 0.15 * features.sourceDiversity;
}

function buildWeeklyFeatures(events, activities, today) {
  const windows = [];
  for (let weeksAgo = 7; weeksAgo >= 0; weeksAgo--) {
    const end = dateOffset(today, -weeksAgo * 7);
    const start = dateOffset(end, -6);
    const weeklyEvents = events.filter(event => event.date >= start && event.date <= end && event.completed !== false);
    const activeDates = [...new Set(weeklyEvents.map(event => event.date))].sort();
    const activityRate = activeDates.length / 7;
    const completedByActivity = new Map();
    weeklyEvents.filter(event => event.type === 'custom-activity').forEach(event => {
      completedByActivity.set(event.sourceId, (completedByActivity.get(event.sourceId) || 0) + 1);
    });
    const plannedSessions = activities.filter(activity => activity.status === 'active')
      .reduce((sum, activity) => sum + Number(activity.frequencyPerWeek || 0), 0);
    const completedSessions = [...completedByActivity.values()].reduce((sum, amount) => sum + amount, 0);
    const completionRate = plannedSessions > 0 ? clamp(completedSessions / plannedSessions) : activityRate;
    const sourceCount = new Set(weeklyEvents.map(event => event.sourceId || event.type)).size;
    const features = {
      start,
      end,
      activeDays: activeDates.length,
      activityRate,
      completionRate,
      streakDensity: getConsecutiveRun(activeDates) / 7,
      sourceDiversity: clamp(sourceCount / 4),
      sourceCount
    };
    features.vector = [features.activityRate, features.completionRate, features.streakDensity, features.sourceDiversity];
    windows.push(features);
  }
  return windows;
}

function classifyWithKMeans(history, current) {
  const training = history.slice(0, -1);
  const activeWeeks = training.filter(week => week.activeDays > 0).length;
  const activeDays = training.reduce((sum, week) => sum + week.activeDays, 0);
  if (activeWeeks < 4 || activeDays < 14) {
    return {
      model: 'K-Means',
      classification: 'Collecting activity',
      cluster: null,
      confidence: 'insufficient data',
      coldStart: true,
      historyWeeks: activeWeeks,
      minimumWeeks: 4,
      reason: `Need at least 4 active weeks and 14 logged days; current history has ${activeWeeks} active weeks and ${activeDays} days.`
    };
  }

  const trainingVectors = training.map(week => week.vector);
const model = kMeans(trainingVectors, 3);

const silhouette = silhouetteScore(
  trainingVectors,
  model.assignments,
  model.centers
);
  const cluster = model.centers.reduce((nearest, center, index) =>
    distance(current.vector, center) < distance(current.vector, model.centers[nearest]) ? index : nearest, 0
  );
  const clusterFeatures = {
    activityRate: model.centers[cluster][0],
    completionRate: model.centers[cluster][1],
    streakDensity: model.centers[cluster][2],
    sourceDiversity: model.centers[cluster][3]
  };
  const currentFeatures = {
  activityRate: current.activityRate ?? current.vector[0],
  completionRate: current.completionRate ?? current.vector[1],
  streakDensity: current.streakDensity ?? current.vector[2],
  sourceDiversity: current.sourceDiversity ?? current.vector[3]
};
  const quality = featureQuality(clusterFeatures);

// Interpret the cluster using its learned feature values.
const clusterActivity = clusterFeatures.activityRate;
const clusterCompletion = clusterFeatures.completionRate;
const clusterStreak = clusterFeatures.streakDensity;
const clusterDiversity = clusterFeatures.sourceDiversity;

let classification;

if (currentFeatures.activityRate < 0.15) {
  classification = 'Inactive';
} else if (
  currentFeatures.activityRate < 0.3 ||
  currentFeatures.completionRate < 0.4
) {
  classification = 'At Risk';
} else if (
  currentFeatures.activityRate >= 0.75 &&
  currentFeatures.completionRate >= 0.75 &&
  currentFeatures.streakDensity >= 0.5
) {
  classification = 'Highly Consistent';
} else if (
  quality < 0.48 ||
  currentFeatures.streakDensity < 0.3 ||
  currentFeatures.sourceDiversity < 0.25
) {
  classification = 'Irregular';
} else if (quality >= 0.78) {
  classification = 'Highly Consistent';
} else {
  classification = 'Consistent';
}

  return {
    model: 'K-Means',
    classification,
    cluster: cluster + 1,
    clusterQuality: Number(quality.toFixed(3)),
    silhouetteScore: Number(silhouette.toFixed(3)),
    confidence: activeWeeks >= 7 && activeDays >= 35 ? 'high' : 'medium',
    coldStart: false,
    historyWeeks: activeWeeks,
    reason: `Assigned to a historical activity cluster using ${activeWeeks} active weeks (${activeDays} logged days).`
  };
}

function analyzeConsistency({ events = [], activities = [], projects = [], goals = [], today = new Date().toISOString().slice(0, 10) }) {
  const validEvents = events.filter(event => event.date && event.date <= today && event.completed !== false);
  const dates = [...new Set(validEvents.map(event => event.date))].sort();
  const cutoff30 = dateOffset(today, -29);
  const last30Dates = dates.filter(date => date >= cutoff30);
  const recentEvents = validEvents.filter(event => event.date >= cutoff30);
  const last30Set = new Set(last30Dates);
  let currentStreak = 0;
  if (dates.length && daysBetween(dates[dates.length - 1], today) <= 1) {
    currentStreak = 1;
    for (let index = dates.length - 1; index > 0; index--) {
      if (daysBetween(dates[index - 1], dates[index]) !== 1) break;
      currentStreak++;
    }
  }
  const gaps = last30Dates.slice(1).map((date, index) => daysBetween(last30Dates[index], date));
  const averageGapDays = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
  const activeGoals = goals.filter(goal => ['active', 'completed'].includes(goal.status) && Number(goal.targetValue) > 0);
  const goalProgressRate = activeGoals.length
    ? activeGoals.reduce((sum, goal) => sum + clamp(Number(goal.currentValue) / Number(goal.targetValue)), 0) / activeGoals.length
    : null;
  const completedSessions = recentEvents.filter(event => event.type === 'custom-activity').length;
  const plannedSessions = activities.filter(activity => activity.status === 'active')
    .reduce((sum, activity) => sum + Number(activity.frequencyPerWeek || 0) * 30 / 7, 0);
  const scheduledCompletionRate = plannedSessions > 0 ? clamp(completedSessions / plannedSessions) : null;
  const activityCoverage = last30Set.size / 30;
  const rhythmScore = averageGapDays === null ? 0 : clamp(1 - averageGapDays / 14);
  const streakContinuity = clamp(currentStreak / 14);
  const goalComponent = goalProgressRate === null ? activityCoverage : goalProgressRate;
  const scheduleComponent = scheduledCompletionRate === null ? activityCoverage : scheduledCompletionRate;
  const score = dates.length
    ? Math.round(100 * (SCORE_WEIGHTS.activity * activityCoverage + SCORE_WEIGHTS.scheduledCompletion * scheduleComponent + SCORE_WEIGHTS.rhythm * rhythmScore + SCORE_WEIGHTS.goalProgress * goalComponent))
    : null;
  const scoreBreakdown = {
    formula: '35% recent active-day coverage + 25% planned-session completion + 20% activity rhythm + 20% goal progress. Missing planned activities/goals use active-day coverage as a neutral substitute.',
    activeDaysLast30: last30Set.size,
    activityCoverage: Number(activityCoverage.toFixed(3)),
    scheduledCompletionRate: scheduledCompletionRate === null ? null : Number(scheduledCompletionRate.toFixed(3)),
    averageGapDays: averageGapDays === null ? null : Number(averageGapDays.toFixed(1)),
    rhythmScore: Number(rhythmScore.toFixed(3)),
    currentStreak,
    goalProgressRate: goalProgressRate === null ? null : Number(goalProgressRate.toFixed(3)),
    weights: SCORE_WEIGHTS
  };

  const weeks = buildWeeklyFeatures(validEvents, activities, today);
const currentWeek = weeks[weeks.length - 1];
const classifier = classifyWithKMeans(weeks, currentWeek);

const anomaly = detectAnomaly(
  weeks.slice(0, -1),
  currentWeek
);

const previousWeek = weeks[weeks.length - 2];
  const weeklyTrend = currentWeek.activeDays - previousWeek.activeDays;
  const reasons = [];
  if (last30Set.size >= 20) reasons.push(`Active on ${last30Set.size} of the last 30 days.`);
  else if (last30Set.size > 0) reasons.push(`Active on ${last30Set.size} of the last 30 days; regularity can improve.`);
  if (averageGapDays !== null) reasons.push(`Average gap between active days is ${averageGapDays.toFixed(1)} days.`);
  if (scheduledCompletionRate !== null) reasons.push(`Completed ${completedSessions} of approximately ${Math.ceil(plannedSessions)} planned sessions in the last 30 days.`);
  if (goalProgressRate !== null) reasons.push(`Average progress across active/completed goals is ${Math.round(goalProgressRate * 100)}%.`);
  if (weeklyTrend > 0) reasons.push(`Activity increased by ${weeklyTrend} active days versus the previous 7-day window.`);
  if (weeklyTrend < 0) reasons.push(`Activity decreased by ${Math.abs(weeklyTrend)} active days versus the previous 7-day window.`);

  const patterns = [];
  const last28Events = validEvents.filter(event => event.date >= dateOffset(today, -27));
  const weekdayDays = new Set(last28Events.filter(event => {
    const day = new Date(`${event.date}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  }).map(event => event.date));
  const weekendDays = new Set(last28Events.filter(event => {
    const day = new Date(`${event.date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6;
  }).map(event => event.date));
  const weekdayRate = weekdayDays.size / 20;
  const weekendRate = weekendDays.size / 8;
  if (weekdayRate >= weekendRate * 1.5 && weekdayDays.size >= 4 && weekendDays.size < 8) patterns.push('Your logged activity is more consistent on weekdays than weekends.');
  if (weeklyTrend > 0) patterns.push('Your active days increased compared with the previous week.');
  if (weeklyTrend < 0) patterns.push('Your active days decreased compared with the previous week.');
  if (currentStreak >= 5) patterns.push(`You have maintained a ${currentStreak}-day current streak.`);
  const projectEvents = validEvents.filter(event => event.type === 'project-task');
  if (projectEvents.length) patterns.push(`You have completed ${projectEvents.length} tracked project tasks.`);

  const positivePatterns = patterns.filter(pattern => !pattern.toLowerCase().includes('decreased'));
  const attentionPatterns = patterns.filter(pattern => pattern.toLowerCase().includes('decreased'));
  if (anomaly.anomaly) {
  attentionPatterns.push(
    `Behavior anomaly detected: your current activity is significantly different from your historical pattern (${anomaly.severity} anomaly).`
  );
}
  if (dates.length && last30Set.size < 8) attentionPatterns.push(`Only ${last30Set.size} active days were recorded in the last 30 days.`);
  if (averageGapDays !== null && averageGapDays > 4) attentionPatterns.push(`The average activity gap is ${averageGapDays.toFixed(1)} days.`);
  const goalRisks = goals.filter(goal => {
    if (goal.status !== 'active' || !goal.deadline) return false;
    const daysLeft = daysBetween(today, goal.deadline);
    const progress = Number(goal.currentValue) / Number(goal.targetValue);
    return daysLeft >= 0 && daysLeft <= 7 && progress < 0.8;
  }).map(goal => ({
    name: goal.name,
    deadline: goal.deadline,
    daysRemaining: daysBetween(today, goal.deadline),
    progress: Number((Number(goal.currentValue) / Number(goal.targetValue)).toFixed(3))
  }));

  const recommendations = [];
  goals.filter(goal => goal.status === 'active' && goal.deadline).forEach(goal => {
    const daysLeft = daysBetween(today, goal.deadline);
    const progress = Number(goal.currentValue) / Number(goal.targetValue);
    if (daysLeft >= 0 && daysLeft <= 7 && progress < 0.8) recommendations.push(`${goal.name} is due in ${daysLeft} day${daysLeft === 1 ? '' : 's'} at ${Math.round(progress * 100)}% progress; schedule a focused session for it.`);
  });
  projects.filter(project => project.status === 'active').forEach(project => {
    const projectTaskEvents = projectEvents.filter(event => event.detail === project.name);
    const lastTaskDate = projectTaskEvents.map(event => event.date).sort().at(-1);
    if (!lastTaskDate || daysBetween(lastTaskDate, today) >= 4) {
      const idleDays = lastTaskDate ? daysBetween(lastTaskDate, today) : 'no';
      recommendations.push(`${project.name} has had ${idleDays} project activity days since its last completed task; choose one small next step.`);
    }
  });
  if (weeklyTrend < 0) recommendations.push('Your activity is down from the previous week; choose one brief task today to restart your rhythm.');
  if (recommendations.length === 0 && dates.length === 0) recommendations.push('Record your first activity to begin personalized consistency analysis.');
  if (recommendations.length === 0 && classifier.coldStart) recommendations.push(`Keep logging activity for ${Math.max(0, 14 - last30Set.size)} more active day${14 - last30Set.size === 1 ? '' : 's'} to establish a reliable pattern.`);
  if (recommendations.length === 0 && dates.length) recommendations.push('Your current activity is on track; keep the routine that is producing these logged results.');

  return {
  score,
  scoreBreakdown,
  classifier,
  anomaly,
    features: {
      activeDaysLast30: last30Set.size,
      currentStreak,
      longestStreak: getConsecutiveRun(dates),
      averageGapDays: averageGapDays === null ? null : Number(averageGapDays.toFixed(1)),
      goalProgressRate: goalProgressRate === null ? null : Number(goalProgressRate.toFixed(3)),
      weeklyActiveDays: currentWeek.activeDays,
      previousWeeklyActiveDays: previousWeek.activeDays,
      activeDaysTrend: weeklyTrend
    },
    weeklyActivity: weeks.map(({ start, end, activeDays, completionRate }) => ({ start, end, activeDays, completionRate: Number(completionRate.toFixed(3)) })),
    reasons,
    patterns,
    positivePatterns,
    attentionPatterns,
    goalRisks,
    recommendations,
    activityHistory: events
  };
}

module.exports = {
  analyzeConsistency,
  kMeans,
  classifyWithKMeans,
  SCORE_WEIGHTS
};
