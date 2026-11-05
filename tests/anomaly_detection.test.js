'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectAnomaly
} = require('../lib/anomaly_detection');

function week(vector) {
  return {
    vector,
    activeDays: Math.max(2, Math.round(vector[0] * 7))
  };
}

const history = [
  week([0.70, 0.70, 0.65, 0.70]),
  week([0.75, 0.72, 0.70, 0.75]),
  week([0.68, 0.70, 0.65, 0.68]),
  week([0.78, 0.75, 0.72, 0.78]),
  week([0.72, 0.74, 0.68, 0.72]),
  week([0.76, 0.78, 0.70, 0.75]),
  week([0.74, 0.73, 0.69, 0.74])
];

test('detects normal behaviour', () => {
  const current = week([0.73, 0.74, 0.69, 0.73]);

  const result = detectAnomaly(history, current);

  assert.equal(result.anomaly, false);
  assert.equal(result.severity, 'normal');
  assert.ok(result.score < 0.30);
});

test('detects moderate behavioural anomaly', () => {
  const current = week([0.30, 0.30, 0.30, 0.30]);

  const result = detectAnomaly(history, current);

  assert.equal(result.anomaly, true);

  assert.ok(
    result.severity === 'moderate' ||
    result.severity === 'high'
  );

  assert.ok(result.score >= 0.30);
});

test('detects high behavioural anomaly', () => {
  const current = week([0.05, 0.05, 0.05, 0.05]);

  const result = detectAnomaly(history, current);

  assert.equal(result.anomaly, true);
  assert.equal(result.severity, 'high');
  assert.ok(result.score >= 0.60);
});

test('protects against insufficient history', () => {
  const shortHistory = [
    week([0.70, 0.70, 0.65, 0.70]),
    week([0.75, 0.72, 0.70, 0.75])
  ];

  const current = week([0.20, 0.20, 0.20, 0.20]);

  const result = detectAnomaly(shortHistory, current);

  assert.equal(result.anomaly, false);
  assert.equal(result.severity, 'insufficient data');
});

test('returns anomaly score between 0 and 1', () => {
  const current = week([0.20, 0.20, 0.20, 0.20]);

  const result = detectAnomaly(history, current);

  assert.ok(result.score >= 0);
  assert.ok(result.score <= 1);
});

test('returns nearest behavioural cluster', () => {
  const current = week([0.73, 0.74, 0.69, 0.73]);

  const result = detectAnomaly(history, current);

  assert.ok(Number.isInteger(result.cluster));
  assert.ok(result.cluster >= 1);
});

console.log('Anomaly detection tests loaded.');