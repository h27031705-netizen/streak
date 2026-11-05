'use strict';

/**
 * Calculate classification accuracy.
 */
function accuracy(actual, predicted) {
  if (actual.length === 0) return 0;

  let correct = 0;

  for (let i = 0; i < actual.length; i++) {
    if (actual[i] === predicted[i]) {
      correct++;
    }
  }

  return correct / actual.length;
}

/**
 * Calculate precision for each class.
 */
function precision(actual, predicted, labels) {
  const result = {};

  for (const label of labels) {
    let truePositive = 0;
    let falsePositive = 0;

    for (let i = 0; i < actual.length; i++) {
      if (predicted[i] === label && actual[i] === label) {
        truePositive++;
      }

      if (predicted[i] === label && actual[i] !== label) {
        falsePositive++;
      }
    }

    result[label] =
      truePositive + falsePositive === 0
        ? 0
        : truePositive / (truePositive + falsePositive);
  }

  return result;
}

/**
 * Calculate recall for each class.
 */
function recall(actual, predicted, labels) {
  const result = {};

  for (const label of labels) {
    let truePositive = 0;
    let falseNegative = 0;

    for (let i = 0; i < actual.length; i++) {
      if (actual[i] === label && predicted[i] === label) {
        truePositive++;
      }

      if (actual[i] === label && predicted[i] !== label) {
        falseNegative++;
      }
    }

    result[label] =
      truePositive + falseNegative === 0
        ? 0
        : truePositive / (truePositive + falseNegative);
  }

  return result;
}

/**
 * Calculate F1-score for each class.
 */
function f1Score(precisionValues, recallValues, labels) {
  const result = {};

  for (const label of labels) {
    const p = precisionValues[label];
    const r = recallValues[label];

    result[label] =
      p + r === 0
        ? 0
        : (2 * p * r) / (p + r);
  }

  return result;
}

/**
 * Create a confusion matrix.
 */
function confusionMatrix(actual, predicted, labels) {
  const matrix = {};

  for (const actualLabel of labels) {
    matrix[actualLabel] = {};

    for (const predictedLabel of labels) {
      matrix[actualLabel][predictedLabel] = 0;
    }
  }

  for (let i = 0; i < actual.length; i++) {
    const actualLabel = actual[i];
    const predictedLabel = predicted[i];

    if (
      matrix[actualLabel] &&
      matrix[actualLabel][predictedLabel] !== undefined
    ) {
      matrix[actualLabel][predictedLabel]++;
    }
  }

  return matrix;
}

/**
 * Evaluate classification performance.
 */
function evaluateClassification(actual, predicted) {
  if (actual.length !== predicted.length) {
    throw new Error('Actual and predicted arrays must have the same length.');
  }

  const labels = [...new Set([...actual, ...predicted])];

  const modelAccuracy = accuracy(actual, predicted);
  const precisionValues = precision(actual, predicted, labels);
  const recallValues = recall(actual, predicted, labels);
  const f1Values = f1Score(
    precisionValues,
    recallValues,
    labels
  );

  const macroPrecision =
    labels.reduce((sum, label) => sum + precisionValues[label], 0) /
    labels.length;

  const macroRecall =
    labels.reduce((sum, label) => sum + recallValues[label], 0) /
    labels.length;

  const macroF1 =
    labels.reduce((sum, label) => sum + f1Values[label], 0) /
    labels.length;

  return {
    accuracy: Number(modelAccuracy.toFixed(3)),
    precision: Number(macroPrecision.toFixed(3)),
    recall: Number(macroRecall.toFixed(3)),
    f1Score: Number(macroF1.toFixed(3)),
    precisionByClass: precisionValues,
    recallByClass: recallValues,
    f1ByClass: f1Values,
    confusionMatrix: confusionMatrix(
      actual,
      predicted,
      labels
    )
  };
}

module.exports = {
  accuracy,
  precision,
  recall,
  f1Score,
  confusionMatrix,
  evaluateClassification
};