// Top-k then top-p (nucleus) filtering of one row of logits, in place, the
// way llama.cpp samples. transformers.js only applies top-k: its top-p
// warper has no implementation, so the browser needs this one.

/**
 * Keep the `k` largest logits, then the smallest prefix of those whose
 * probabilities add up to at least `p`; set every other logit to -Infinity.
 * `logits` is one vocabulary row, already divided by the temperature.
 */
export function keepTopKTopP(logits: Float32Array, k: number, p: number) {
  const n = logits.length;
  k = Math.max(1, Math.min(k > 0 ? k : n, n));
  // A min-heap of the k best indices, so one pass over the vocabulary finds them.
  const heap = new Int32Array(k);
  let size = 0;
  const less = (a: number, b: number) => logits[a] < logits[b];
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1,
        r = l + 1;
      let m = i;
      if (l < size && less(heap[l], heap[m])) m = l;
      if (r < size && less(heap[r], heap[m])) m = r;
      if (m === i) return;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  };
  for (let i = 0; i < n; i++) {
    if (size < k) {
      heap[size] = i;
      for (let c = size++; c > 0; ) {
        const parent = (c - 1) >> 1;
        if (!less(heap[c], heap[parent])) break;
        [heap[c], heap[parent]] = [heap[parent], heap[c]];
        c = parent;
      }
    } else if (logits[i] > logits[heap[0]]) {
      heap[0] = i;
      down(0);
    }
  }
  const best = Array.from(heap.subarray(0, size)).sort((a, b) => logits[b] - logits[a]);
  const top = logits[best[0]];
  const weights = best.map((i) => Math.exp(logits[i] - top));
  const total = weights.reduce((a, b) => a + b, 0);
  let keep = 0;
  for (let mass = 0; keep < best.length && (keep === 0 || mass < p); keep++) mass += weights[keep] / total;
  const kept = best.slice(0, keep).map((i) => [i, logits[i]] as const);
  logits.fill(-Infinity);
  for (const [i, value] of kept) logits[i] = value;
  return keep;
}
