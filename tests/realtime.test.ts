import { describe, expect, it } from "vitest";
import {
  calculateDevelopingWinRate,
  CandleBuffer,
  isWithinEarlyWarningWindow,
  transitionSignalState,
  type SignalTransition,
} from "../src/realtime";
import type { Candle } from "../src/market";

function candle(
  openTime: number,
  closeTime: number,
  close: number,
  closed = true,
): Candle {
  return {
    openTime,
    closeTime,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    closed,
  };
}

describe("CandleBuffer", () => {
  it("seeds closed candles and retains the forming candle separately", () => {
    const buffer = new CandleBuffer(5);
    buffer.seed(
      [candle(0, 59, 10), candle(60, 119, 11), candle(120, 179, 12, false)],
      150,
    );
    expect(buffer.getClosed().map((item) => item.openTime)).toEqual([0, 60]);
    expect(buffer.getForming()?.openTime).toBe(120);
  });

  it("updates a forming candle without duplicating it", () => {
    const buffer = new CandleBuffer();
    buffer.seed([candle(0, 59, 10, false)], 10);
    buffer.update(candle(0, 59, 12, false));
    expect(buffer.getClosed()).toHaveLength(0);
    expect(buffer.getForming()?.close).toBe(12);
  });

  it("appends a candle exactly once when it closes", () => {
    const buffer = new CandleBuffer();
    buffer.seed([candle(0, 59, 10, false)], 10);
    buffer.update(candle(0, 59, 12, true));
    buffer.update(candle(60, 119, 13, false));
    expect(buffer.getClosed().map((item) => item.openTime)).toEqual([0]);
    expect(buffer.getForming()?.openTime).toBe(60);
  });
});

describe("signal state transitions", () => {
  it("moves a developing signal to confirmed when it closes unchanged", () => {
    const previous: SignalTransition = {
      state: "DEVELOPING",
      direction: "CALL",
    };
    expect(transitionSignalState(previous, "CALL", true)).toEqual({
      state: "CONFIRMED",
      direction: "CALL",
    });
  });

  it("moves a developing signal to cancelled when it reverses", () => {
    const previous: SignalTransition = {
      state: "DEVELOPING",
      direction: "PUT",
    };
    expect(transitionSignalState(previous, null, false)).toEqual({
      state: "CANCELLED",
      direction: "PUT",
    });
  });
});

describe("early-warning window", () => {
  it("includes alerts due within the selected two or five minute lead", () => {
    expect(isWithinEarlyWarningWindow(120_000, 0, 2)).toBe(true);
    expect(isWithinEarlyWarningWindow(300_000, 0, 5)).toBe(true);
    expect(isWithinEarlyWarningWindow(240_000, 0, 5)).toBe(true);
  });

  it("excludes candles outside the lead or already closed", () => {
    expect(isWithinEarlyWarningWindow(120_001, 0, 2)).toBe(false);
    expect(isWithinEarlyWarningWindow(0, 0, 2)).toBe(false);
    expect(isWithinEarlyWarningWindow(-1, 0, 5)).toBe(false);
  });
});

describe("developing signal win rate", () => {
  it("counts directional wins and cancelled warnings separately", () => {
    expect(
      calculateDevelopingWinRate([
        {
          direction: "CALL",
          entryPrice: 10,
          finalPrice: 11,
          remainsSignalAtClose: true,
        },
        {
          direction: "PUT",
          entryPrice: 10,
          finalPrice: 9,
          remainsSignalAtClose: true,
        },
        {
          direction: "CALL",
          entryPrice: 10,
          finalPrice: 12,
          remainsSignalAtClose: false,
        },
        {
          direction: "PUT",
          entryPrice: 10,
          finalPrice: 11,
          remainsSignalAtClose: true,
        },
      ]),
    ).toEqual({
      wins: 3,
      samples: 4,
      winRate: 75,
      cancelled: 1,
      cancelledPercent: 25,
    });
  });
});
