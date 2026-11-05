
'use strict';

function distance(left, right) {
  return Math.sqrt(
    left.reduce(
      (sum, value, index) => sum + (value - right[index]) ** 2,
      0
    )
  );
}

function kMeans(points, clusterCount = 3, maxIterations = 40) {
  if (!points.length) {
    return { centers: [], assignments: [] };
  }

  const dimensions = points[0].length;
  const count = Math.min(clusterCount, points.length);

  const centers = Array.from({ length: count }, (_, index) => [
    ...points[
      Math.floor(
        index * (points.length - 1) / Math.max(1, count - 1)
      )
    ]
  ]);

  let assignments = new Array(points.length).fill(-1);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let changed = false;

    assignments = points.map(point => {
      let nearest = 0;
      let nearestDistance = distance(point, centers[0]);

      for (let i = 1; i < centers.length; i++) {
        const candidateDistance = distance(point, centers[i]);

        if (candidateDistance < nearestDistance) {
          nearest = i;
          nearestDistance = candidateDistance;
        }
      }

      return nearest;
    });

    for (let centerIndex = 0; centerIndex < count; centerIndex++) {
      const members = points.filter(
        (_, pointIndex) => assignments[pointIndex] === centerIndex
      );

      if (!members.length) continue;

      const nextCenter = Array.from(
        { length: dimensions },
        (_, dimension) =>
          members.reduce((sum, point) => sum + point[dimension], 0)
          / members.length
      );

      if (distance(centers[centerIndex], nextCenter) > 1e-6) {
        changed = true;
      }

      centers[centerIndex] = nextCenter;
    }

    if (!changed) break;
  }

  return { centers, assignments };
}

module.exports = { kMeans };