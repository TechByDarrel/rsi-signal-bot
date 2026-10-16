import { describe, expect, it } from "vitest";
import {
  atr,
  breakEvenWinRate,
  recommendTimeframe,
  rsi,
} from "../src/indicators";

describe("rsi", () => {
  it("returns null when there are not enough closes", () => {
    expect(rsi([1, 2, 3], 3)).toBeNull();
  });

  it("returns 100 when the Wilder-smoothed average loss is zero", () => {
    expect(rsi([1, 2, 3, 4], 3)).toBe(100);
  });

  it("seeds and smooths the average gain and loss using Wilder's method", () => {
    expect(rsi([1, 2, 1, 2, 1], 2)).toBeCloseTo(37.5, 10);
  });
});

describe("atr", () => {
  it("computes true ranges and the Wilder average from known candles", () => {
    expect(
      atr(
        [11, 13, 13],
        [9, 10, 11],
        [10, 11, 12],
        2,
      ),
    ).toBe(2.5);
  });

  it("returns null when there are too few candles or mismatched series", () => {
    expect(atr([11, 12], [9, 10], [10, 11], 2)).toBeNull();
    expect(atr([11, 12], [9], [10, 11], 1)).toBeNull();
  });
});

describe("breakEvenWinRate", () => {
  it("calculates the break-even rate for the configured payout", () => {
    expect(breakEvenWinRate(80)).toBeCloseTo(55.5555555, 6);
  });

  it("rejects a negative or invalid payout", () => {
    expect(() => breakEvenWinRate(-1)).toThrow(RangeError);
  });
});

describe("recommendTimeframe", () => {
  it("uses high, middle, and low ATR bands including threshold boundaries", () => {
    expect(recommendTimeframe(0.31, 0.12, 0.3)).toBe("1m");
    expect(recommendTimeframe(0.3, 0.12, 0.3)).toBe("5m");
    expect(recommendTimeframe(0.12, 0.12, 0.3)).toBe("5m");
    expect(recommendTimeframe(0.11, 0.12, 0.3)).toBe("15m");
  });

  it("rejects inconsistent thresholds", () => {
    expect(() => recommendTimeframe(0.2, 0.3, 0.2)).toThrow(RangeError);
  });
});
