const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeConsistency, classifyWithKMeans } = require('../lib/consistency');

const {
  evaluateClassification
} = require('../lib/ml_evaluation');

const testCases = [
  {
    expected: 'Inactive',
    history: [
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] },
      { activeDays: 0, vector: [0, 0, 0, 0] }
    ]
  },

  {
    expected: 'At Risk',
    history: [
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 3, vector: [0.43, 0.43, 0.43, 0.5] },
      { activeDays: 2, vector: [0.28, 0.28, 0.28, 0.25] }
    ]
  },

  {
    expected: 'Irregular',
    history: [
      { activeDays: 5, vector: [0.71, 0.70, 0.25, 0.15] },
      { activeDays: 2, vector: [0.28, 0.30, 0.10, 0.80] },
      { activeDays: 6, vector: [0.85, 0.80, 0.30, 0.20] },
      { activeDays: 1, vector: [0.14, 0.15, 0.05, 0.90] },
      { activeDays: 4, vector: [0.57, 0.55, 0.20, 0.10] },
      { activeDays: 2, vector: [0.28, 0.25, 0.08, 0.75] },
      { activeDays: 5, vector: [0.71, 0.65, 0.22, 0.15] },
      { activeDays: 3, vector: [0.43, 0.40, 0.12, 0.60] }
    ]
  },

  {
    expected: 'Consistent',
    history: [
      { activeDays: 4, vector: [0.57, 0.65, 0.45, 0.50] },
      { activeDays: 4, vector: [0.57, 0.65, 0.45, 0.50] },
      { activeDays: 5, vector: [0.71, 0.70, 0.50, 0.60] },
      { activeDays: 4, vector: [0.57, 0.65, 0.45, 0.50] },
      { activeDays: 5, vector: [0.71, 0.70, 0.50, 0.60] },
      { activeDays: 4, vector: [0.57, 0.65, 0.45, 0.50] },
      { activeDays: 5, vector: [0.71, 0.70, 0.50, 0.60] },
      { activeDays: 4, vector: [0.57, 0.65, 0.45, 0.50] }
    ]
  },

  {
    expected: 'Highly Consistent',
    history: [
      { activeDays: 7, vector: [1.00, 0.95, 0.90, 0.90] },
      { activeDays: 7, vector: [1.00, 0.95, 0.90, 0.90] },
      { activeDays: 6, vector: [0.85, 0.90, 0.80, 0.85] },
      { activeDays: 7, vector: [1.00, 0.95, 0.90, 0.90] },
      { activeDays: 6, vector: [0.85, 0.90, 0.80, 0.85] },
      { activeDays: 7, vector: [1.00, 0.95, 0.90, 0.90] },
      { activeDays: 6, vector: [0.85, 0.90, 0.80, 0.85] },
      { activeDays: 7, vector: [1.00, 0.95, 0.90, 0.90] }
    ]
  }
];

const actual = testCases.map(testCase => testCase.expected);

const predicted = testCases.map(testCase => {
  const current =
    testCase.history[testCase.history.length - 1];

  return classifyWithKMeans(
    testCase.history,
    current
  ).classification;
});

test('K-Means classifies the known activity profiles', () => {
  assert.deepEqual(predicted, actual);
});

test('K-Means reports cold-start for users with insufficient activity', () => {
  const inactiveWeek = { activeDays: 0, vector: [0, 0, 0, 0] };
  const noActivity = classifyWithKMeans(Array(8).fill(inactiveWeek), inactiveWeek);
  assert.equal(noActivity.coldStart, true);
  assert.equal(noActivity.cluster, null);
  assert.equal(noActivity.classification, 'Collecting activity');

  const lowActivityWeek = { activeDays: 1, vector: [0.14, 0.14, 0.14, 0.25] };
  const insufficientHistory = classifyWithKMeans(Array(8).fill(lowActivityWeek), lowActivityWeek);
  assert.equal(insufficientHistory.coldStart, true);
  assert.equal(insufficientHistory.historyWeeks, 7);
});

test('consistency score retains the configured weights and cold-start behavior', () => {
  const analysis = analyzeConsistency({
    events: [{ date: '2026-11-03', type: 'manual-activity', sourceId: 'test-track' }],
    today: '2026-11-03'
  });

  assert.deepEqual(analysis.scoreBreakdown.weights, {
    activity: 0.35,
    scheduledCompletion: 0.25,
    rhythm: 0.2,
    goalProgress: 0.2
  });
  assert.equal(analysis.score, 3);
  assert.equal(analysis.classifier.coldStart, true);
});

const evaluation = evaluateClassification(
  actual,
  predicted
);

console.log('');
console.log('================================');
console.log('     STREAK FORCE ML EVALUATION');
console.log('================================');
console.log('');

console.log(`Accuracy   : ${evaluation.accuracy * 100}%`);
console.log(`Precision  : ${evaluation.precision * 100}%`);
console.log(`Recall     : ${evaluation.recall * 100}%`);
console.log(`F1-Score   : ${evaluation.f1Score * 100}%`);

console.log('');
console.log('Behavior Classes:');

for (const label of actual) {
  console.log(`✓ ${label}`);
}

console.log('');
console.log('Confusion Matrix:');
console.table(evaluation.confusionMatrix);
