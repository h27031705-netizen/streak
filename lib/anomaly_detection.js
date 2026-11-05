'use strict';
const { kMeans } = require('./kmeans');

function distance(left, right) {
  return Math.sqrt(
    left.reduce(
      (sum, value, index) =>
        sum + (value - right[index]) ** 2,
      0
    )
  );
}

function detectAnomaly(history, current, options = {}) {
  const {
    clusterCount = 3,
    threshold = 0.30
  } = options;

  if (!Array.isArray(history) || history.length < 4) {
    return {
      anomaly: false,
      score: 0,
      severity: 'insufficient data',
      reason: 'Not enough historical weeks for anomaly detection.'
    };
  }

  const trainingVectors = history
    .map(week => week.vector)
    .filter(vector => Array.isArray(vector));

  if (trainingVectors.length < 4 || !current?.vector) {
    return {
      anomaly: false,
      score: 0,
      severity: 'insufficient data',
      reason: 'Missing weekly feature vectors.'
    };
  }

  const model = kMeans(
    trainingVectors,
    clusterCount
  );

  if (!model.centers.length) {
    return {
      anomaly: false,
      score: 0,
      severity: 'insufficient data',
      reason: 'Unable to build behavioral clusters.'
    };
  }

  let nearestCluster = 0;

  let nearestDistance = distance(
    current.vector,
    model.centers[0]
  );

  for (let index = 1; index < model.centers.length; index++) {
    const candidateDistance = distance(
      current.vector,
      model.centers[index]
    );

    if (candidateDistance < nearestDistance) {
      nearestDistance = candidateDistance;
      nearestCluster = index;
    }
  }

  const anomalyScore = Math.min(
    1,
    nearestDistance / 2
  );

  let severity = 'normal';

  if (anomalyScore >= 0.60) {
    severity = 'high';
  } else if (anomalyScore >= threshold) {
    severity = 'moderate';
  }

  const anomaly = anomalyScore >= threshold;

  let reason;

  if (anomaly) {
    reason =
      `Current behavior differs from the nearest historical ` +
      `behavior cluster (distance ${nearestDistance.toFixed(3)}).`;
  } else {
    reason =
      `Current behavior remains close to a historical ` +
      `behavior cluster (distance ${nearestDistance.toFixed(3)}).`;
  }

  return {
    anomaly,
    score: Number(anomalyScore.toFixed(3)),
    severity,
    cluster: nearestCluster + 1,
    distance: Number(nearestDistance.toFixed(3)),
    threshold,
    reason
  };
}

module.exports = {
  detectAnomaly
};