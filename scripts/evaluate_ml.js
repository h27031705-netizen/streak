'use strict';

const fs = require('fs');
const path = require('path');

const {
  classifyWithKMeans,
} = require('../lib/consistency');

const {
  evaluateClassification,
} = require('../lib/ml_evaluation');


/* ---------------------------------------------------------
   Create one weekly feature object
--------------------------------------------------------- */

function makeWeek(activityRate, completionRate, streakDensity, sourceDiversity) {
  return {
    activeDays: Math.max(2, Math.round(activityRate * 7)),
    activityRate,
    completionRate,
    streakDensity,
    sourceDiversity,
    sourceCount: Math.max(1, Math.round(sourceDiversity * 4)),
    vector: [
      activityRate,
      completionRate,
      streakDensity,
      sourceDiversity,
    ],
  };
}


/* ---------------------------------------------------------
   Create an evaluation case
--------------------------------------------------------- */

function makeCase(label, history, current) {
  const historyWeeks = history.map(values => makeWeek(...values));
  const currentWeek = makeWeek(...current);

  return {
    expected: label,
    history: [...historyWeeks, currentWeek],
    current: currentWeek,
  };
}


/* ---------------------------------------------------------
   Realistic varied weekly histories
--------------------------------------------------------- */

const baseHistory = [
  [0.45, 0.50, 0.40, 0.45],
  [0.60, 0.55, 0.50, 0.55],
  [0.75, 0.70, 0.65, 0.70],
  [0.50, 0.60, 0.45, 0.55],
  [0.85, 0.80, 0.75, 0.80],
  [0.70, 0.75, 0.65, 0.70],
  [0.90, 0.85, 0.80, 0.85],
];


/* ---------------------------------------------------------
   25 controlled test cases
   5 cases per behaviour class
--------------------------------------------------------- */

const testCases = [

  // INACTIVE
  makeCase('Inactive', baseHistory, [0.10, 0.15, 0.10, 0.15]),
  makeCase('Inactive', baseHistory, [0.08, 0.20, 0.12, 0.10]),
  makeCase('Inactive', baseHistory, [0.12, 0.18, 0.10, 0.20]),
  makeCase('Inactive', baseHistory, [0.05, 0.10, 0.08, 0.12]),
  makeCase('Inactive', baseHistory, [0.14, 0.20, 0.12, 0.15]),

  // AT RISK
  makeCase('At Risk', baseHistory, [0.20, 0.30, 0.25, 0.30]),
  makeCase('At Risk', baseHistory, [0.25, 0.35, 0.30, 0.25]),
  makeCase('At Risk', baseHistory, [0.28, 0.30, 0.25, 0.35]),
  makeCase('At Risk', baseHistory, [0.18, 0.25, 0.20, 0.30]),
  makeCase('At Risk', baseHistory, [0.22, 0.32, 0.28, 0.30]),

  // IRREGULAR
  makeCase('Irregular', baseHistory, [0.45, 0.40, 0.35, 0.45]),
  makeCase('Irregular', baseHistory, [0.50, 0.35, 0.30, 0.40]),
  makeCase('Irregular', baseHistory, [0.55, 0.40, 0.30, 0.35]),
  makeCase('Irregular', baseHistory, [0.40, 0.45, 0.35, 0.40]),
  makeCase('Irregular', baseHistory, [0.48, 0.42, 0.32, 0.38]),

  // CONSISTENT
  makeCase('Consistent', baseHistory, [0.65, 0.70, 0.60, 0.65]),
  makeCase('Consistent', baseHistory, [0.70, 0.65, 0.60, 0.70]),
  makeCase('Consistent', baseHistory, [0.75, 0.70, 0.65, 0.70]),
  makeCase('Consistent', baseHistory, [0.60, 0.65, 0.60, 0.65]),
  makeCase('Consistent', baseHistory, [0.68, 0.72, 0.62, 0.68]),

  // HIGHLY CONSISTENT
  makeCase('Highly Consistent', baseHistory, [0.90, 0.90, 0.90, 0.90]),
  makeCase('Highly Consistent', baseHistory, [0.85, 0.90, 0.85, 0.90]),
  makeCase('Highly Consistent', baseHistory, [0.92, 0.88, 0.90, 0.92]),
  makeCase('Highly Consistent', baseHistory, [0.88, 0.92, 0.90, 0.88]),
  makeCase('Highly Consistent', baseHistory, [0.95, 0.90, 0.92, 0.95]),
];


/* ---------------------------------------------------------
   Run predictions
--------------------------------------------------------- */

const predictions = testCases.map((testCase, index) => {
  const result = classifyWithKMeans(
    testCase.history,
    testCase.current
  );

  return {
    case: index + 1,
    expected: testCase.expected,
    predicted: result.classification,
    correct: result.classification === testCase.expected,

    cluster: result.cluster,
    clusterQuality: Number(result.clusterQuality.toFixed(3)),
    silhouetteScore: Number(result.silhouetteScore.toFixed(3)),
    confidence: result.confidence,

    coldStart: result.coldStart,
    reason: result.reason,
  };
});


/* ---------------------------------------------------------
   Calculate evaluation metrics
--------------------------------------------------------- */

const actual = predictions.map(item => item.expected);
const predicted = predictions.map(item => item.predicted);

const evaluation = evaluateClassification(
  actual,
  predicted
);


/* ---------------------------------------------------------
   Create confusion matrix
--------------------------------------------------------- */

const labels = [
  'Inactive',
  'At Risk',
  'Irregular',
  'Consistent',
  'Highly Consistent',
];

const confusionMatrix = {};

labels.forEach(actualLabel => {
  confusionMatrix[actualLabel] = {};

  labels.forEach(predictedLabel => {
    confusionMatrix[actualLabel][predictedLabel] =
      predictions.filter(
        item =>
          item.expected === actualLabel &&
          item.predicted === predictedLabel
      ).length;
  });
});


/* ---------------------------------------------------------
   Save JSON report
--------------------------------------------------------- */

const report = {
  evaluationDate: new Date().toISOString(),

  model: 'K-Means',

  task: 'Consistency behaviour classification',

  totalTestCases: testCases.length,

  classes: labels,

  metrics: {
  accuracy: Number(evaluation.accuracy.toFixed(3)),
  precision: Number(evaluation.precision.toFixed(3)),
  recall: Number(evaluation.recall.toFixed(3)),
  f1Score: Number(evaluation.f1Score.toFixed(3)),
},

  perClassMetrics: evaluation.perClass,

  confusionMatrix,

  predictions,
};


const reportsDirectory = path.join(__dirname, '..', 'reports');

if (!fs.existsSync(reportsDirectory)) {
  fs.mkdirSync(reportsDirectory, { recursive: true });
}

const reportPath = path.join(
  reportsDirectory,
  'ml_evaluation.json'
);

fs.writeFileSync(
  reportPath,
  JSON.stringify(report, null, 2)
);


/* ---------------------------------------------------------
   Console output
--------------------------------------------------------- */

console.log('\n==========================================');
console.log('       ML EVALUATION REPORT');
console.log('==========================================\n');

console.log(`Total test cases : ${testCases.length}`);
console.log(`Accuracy         : ${evaluation.accuracy.toFixed(3)}`)
console.log(`Precision        : ${evaluation.precision.toFixed(3)}`);
console.log(`Recall           : ${evaluation.recall.toFixed(3)}`);
console.log(`F1 Score         : ${evaluation.f1Score.toFixed(3)}`);

console.log('\nConfusion Matrix:\n');

console.table(confusionMatrix);

console.log('\nPredictions:\n');

predictions.forEach(item => {
  console.log(
    `${String(item.case).padStart(2, '0')}. ` +
    `Expected: ${item.expected.padEnd(20)} ` +
    `Predicted: ${item.predicted.padEnd(20)} ` +
    `Correct: ${item.correct ? 'YES' : 'NO'} ` +
    `Silhouette: ${item.silhouetteScore}`
  );
});

console.log('\n------------------------------------------');
console.log(`Report saved to: ${reportPath}`);
console.log('------------------------------------------\n');