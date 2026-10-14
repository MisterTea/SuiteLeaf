import { describe, expect, it } from "vitest";
import { keepTopKTopP } from "../apps/web/src/ai/nucleus";

const logitsFor = (probabilities: number[]) => Float32Array.from(probabilities, (q) => Math.log(q));

describe("top-k and top-p filtering", () => {
  it("keeps the smallest set of top tokens that reaches p", () => {
    const logits = logitsFor([0.05, 0.5, 0.02, 0.3, 0.13]);
    expect(keepTopKTopP(logits, 64, 0.9)).toBe(3);
    expect([...logits].map((x) => Number.isFinite(x))).toEqual([false, true, false, true, true]);
    expect(logits[1]).toBeCloseTo(Math.log(0.5));
  });

  it("applies top-k before top-p, and always keeps the best token", () => {
    const logits = logitsFor([0.4, 0.3, 0.2, 0.1]);
    expect(keepTopKTopP(logits, 2, 0.99)).toBe(2);
    expect([...logits].map((x) => Number.isFinite(x))).toEqual([true, true, false, false]);
    const sure = logitsFor([0.999, 0.001]);
    expect(keepTopKTopP(sure, 64, 0.5)).toBe(1);
  });

  it("finds the top k in a vocabulary-sized row", () => {
    const logits = new Float32Array(262_144).map((_, i) => Math.sin(i) * 3);
    const sorted = [...logits].sort((a, b) => b - a);
    keepTopKTopP(logits, 64, 1);
    const kept = [...logits].filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
    expect(kept).toEqual(sorted.slice(0, kept.length));
    expect(kept.length).toBe(64);
  });
});
