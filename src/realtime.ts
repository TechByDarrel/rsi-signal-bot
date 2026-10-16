import {
  EMA_PERIOD,
  RSI_PERIOD,
  type Timeframe,
  TIMEFRAME_MILLISECONDS,
} from "./config";
import { ema, rsi, signalDirection, type SignalDirection } from "./indicators";
import type { Candle } from "./market";

export type SignalState = "DEVELOPING" | "CONFIRMED" | "CANCELLED";

export interface SignalTransition {
  state: SignalState | null;
  direction: SignalDirection | null;
}

export interface DevelopingOutcome {
  direction: SignalDirection;
  entryPrice: number;
  finalPrice: number;
  remainsSignalAtClose: boolean;
}

export interface DevelopingWinRate {
  wins: number;
  samples: number;
  winRate: number | null;
  cancelled: number;
  cancelledPercent: number | null;
}

export class CandleBuffer {
  private closed: Candle[] = [];
  private forming: Candle | null = null;

  constructor(private readonly capacity = 501) {
    if (capacity < 1) throw new RangeError("Candle buffer capacity must be positive");
  }

  seed(candles: Candle[], now = Date.now()): void {
    const ordered = [...candles]
      .sort((left, right) => left.openTime - right.openTime)
      .slice(-this.capacity);
    this.closed = ordered.filter(
      (candle) => candle.closed || candle.closeTime < now,
    );
    const latest = ordered[ordered.length - 1];
    this.forming =
      latest && !this.closed.some((candle) => candle.openTime === latest.openTime)
        ? { ...latest, closed: false }
        : null;
  }

  update(candle: Candle): void {
    if (this.forming?.openTime === candle.openTime) {
      this.forming = { ...candle };
      if (candle.closed) {
        this.appendClosed(candle);
        this.forming = null;
      }
      return;
    }

    const closedIndex = this.closed.findIndex(
      (existing) => existing.openTime === candle.openTime,
    );
    if (closedIndex >= 0) {
      this.closed[closedIndex] = { ...candle, closed: true };
      if (closedIndex === this.closed.length - 1) this.forming = null;
      return;
    }

    if (this.forming && candle.openTime < this.forming.openTime) return;
    if (candle.closed) {
      this.appendClosed(candle);
      this.forming = null;
    } else {
      this.forming = { ...candle };
    }
  }

  getClosed(): Candle[] {
    return this.closed.map((candle) => ({ ...candle }));
  }

  getForming(): Candle | null {
    return this.forming ? { ...this.forming } : null;
  }

  private appendClosed(candle: Candle): void {
    if (this.closed[this.closed.length - 1]?.openTime === candle.openTime) {
      this.closed[this.closed.length - 1] = { ...candle, closed: true };
    } else {
      this.closed.push({ ...candle, closed: true });
    }
    if (this.closed.length > this.capacity) {
      this.closed.splice(0, this.closed.length - this.capacity);
    }
  }
}

export function isWithinEarlyWarningWindow(
  closeTime: number,
  now: number,
  leadMinutes: 2 | 5,
): boolean {
  const remaining = closeTime - now;
  return remaining > 0 && remaining <= leadMinutes * 60_000;
}

export function transitionSignalState(
  previous: SignalTransition | null,
  currentDirection: SignalDirection | null,
  candleClosed: boolean,
): SignalTransition {
  if (previous?.state === "DEVELOPING") {
    if (currentDirection !== previous.direction) {
      return { state: "CANCELLED", direction: previous.direction };
    }
    if (candleClosed) {
      return { state: "CONFIRMED", direction: previous.direction };
    }
  }

  if (currentDirection) {
    return {
      state: candleClosed ? "CONFIRMED" : "DEVELOPING",
      direction: currentDirection,
    };
  }
  return { state: null, direction: null };
}

export function calculateDevelopingWinRate(
  outcomes: DevelopingOutcome[],
): DevelopingWinRate {
  let wins = 0;
  let cancelled = 0;
  for (const outcome of outcomes) {
    if (
      (outcome.direction === "CALL" &&
        outcome.finalPrice > outcome.entryPrice) ||
      (outcome.direction === "PUT" &&
        outcome.finalPrice < outcome.entryPrice)
    ) {
      wins += 1;
    }
    if (!outcome.remainsSignalAtClose) cancelled += 1;
  }

  return {
    wins,
    samples: outcomes.length,
    winRate:
      outcomes.length === 0 ? null : (wins / outcomes.length) * 100,
    cancelled,
    cancelledPercent:
      outcomes.length === 0 ? null : (cancelled / outcomes.length) * 100,
  };
}

export function replayDevelopingSignals(
  candles: Candle[],
  oneMinuteCandles: Candle[],
  timeframe: Timeframe,
  leadMinutes: 2 | 5,
  requireEmaTrend: boolean,
): DevelopingWinRate {
  const outcomes: DevelopingOutcome[] = [];
  const candleCloses = candles.map((candle) => candle.close);
  const leadMilliseconds = leadMinutes * 60_000;
  const candleDuration = TIMEFRAME_MILLISECONDS[timeframe];

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    if (candleDuration <= leadMilliseconds) continue;
    const warningTime = candle.closeTime - leadMilliseconds;
    let snapshot: Candle | undefined;
    for (let minuteIndex = oneMinuteCandles.length - 1; minuteIndex >= 0; minuteIndex -= 1) {
      const candidate = oneMinuteCandles[minuteIndex];
      if (
        candidate.closeTime <= warningTime &&
        candidate.openTime >= candle.openTime &&
        candidate.openTime < candle.closeTime
      ) {
        snapshot = candidate;
        break;
      }
    }
    if (!snapshot) continue;

    const prior = candleCloses.slice(0, index);
    const formingCloses = [...prior, snapshot.close];
    const direction = signalDirection(rsi(formingCloses, RSI_PERIOD));
    if (!direction) continue;

    const trend = ema(formingCloses, EMA_PERIOD);
    if (
      requireEmaTrend &&
      (trend === null ||
        (direction === "CALL" && snapshot.close <= trend) ||
        (direction === "PUT" && snapshot.close >= trend))
    ) {
      continue;
    }

    const closedCloses = [...prior, candle.close];
    const closedDirection = signalDirection(rsi(closedCloses, RSI_PERIOD));
    const closedTrend = ema(closedCloses, EMA_PERIOD);
    const remainsSignalAtClose =
      closedDirection === direction &&
      (!requireEmaTrend ||
        (closedTrend !== null &&
          ((direction === "CALL" && candle.close > closedTrend) ||
            (direction === "PUT" && candle.close < closedTrend))));

    outcomes.push({
      direction,
      entryPrice: snapshot.close,
      finalPrice: candle.close,
      remainsSignalAtClose,
    });
  }

  return calculateDevelopingWinRate(outcomes);
}
