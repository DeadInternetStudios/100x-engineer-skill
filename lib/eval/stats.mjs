// Exact numbers for small samples. A bake-off has a handful of pairs, so nothing here is an approximation that hides how few there are.

// Two-sided sign test. With no real difference each decisive pair is a win for either side with probability 1/2.
// p is the chance of a split at least this uneven in either direction, from the exact binomial sum.
export function signTest(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  if (n > 1000) throw new RangeError('the sign test here is exact up to 1000 decisive pairs');
  let tail = 0n;
  let term = 1n;
  for (let k = 0; k <= Math.min(wins, losses); k += 1) {
    tail += term;
    term = (term * BigInt(n - k)) / BigInt(k + 1);
  }
  return Math.min(1, (2 * Number(tail)) / 2 ** n);
}

// Wilson score interval for k of n at 95%. It stays inside 0 to 1 and does not collapse to a point at 6 of 6, as the plain interval does.
export function wilson(k, n, z = 1.96) {
  if (n === 0) return null;
  const share = k / n;
  const denominator = 1 + (z * z) / n;
  const center = (share + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((share * (1 - share)) / n + (z * z) / (4 * n * n))) / denominator;
  // At 0 of n the lower end is exactly 0 and at n of n the upper end is exactly 1. Floating point lands a hair off, so those two are set.
  return [k === 0 ? 0 : Math.max(0, center - half), k === n ? 1 : Math.min(1, center + half)];
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
