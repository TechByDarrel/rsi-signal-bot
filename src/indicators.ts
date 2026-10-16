import {
  EMA_PERIOD,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  RSI_PERIOD,
} from "./config";

export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) {
    return null;
  }

  const window = values.slice(values.length - period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

export function rsi(closes: number[], period = 14): number | null {
  if (period <= 0 || closes.length < period + 1) {
    return null;
  }

  let averageGain = 0;
  let averageLoss = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = closes[index] - closes[index - 1];
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }

  averageGain /= period;
  averageLoss /= period;

  for (let index = period + 1; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) {
    return null;
  }

  let result =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);

  for (let index = period; index < values.length; index += 1) {
    result = (values[index] - result) * multiplier + result;
  }

  return result;
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number | null {
  if (
    period <= 0 ||
    highs.length !== lows.length ||
    lows.length !== closes.length ||
    closes.length < period + 1
  ) {
    return null;
  }

  const trueRanges: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    trueRanges.push(
      Math.max(
        highs[index] - lows[index],
        Math.abs(highs[index] - closes[index - 1]),
        Math.abs(lows[index] - closes[index - 1]),
      ),
    );
  }

  let result =
    trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) /
    period;
  for (let index = period; index < trueRanges.length; index += 1) {
    result = (result * (period - 1) + trueRanges[index]) / period;
  }

  return result;
}

export function breakEvenWinRate(payoutPercent: number): number {
  if (!Number.isFinite(payoutPercent) || payoutPercent < 0) {
    throw new RangeError("Payout percentage must be a non-negative number");
  }
  return 100 / (100 + payoutPercent) * 100;
}

export function recommendTimeframe(
  atrPercent: number,
  lowThreshold: number,
  highThreshold: number,
): "1m" | "5m" | "15m" {
  if (lowThreshold < 0 || highThreshold <= lowThreshold) {
    throw new RangeError("ATR thresholds must be non-negative and high > low");
  }
  if (atrPercent > highThreshold) {
    return "1m";
  }
  if (atrPercent < lowThreshold) {
    return "15m";
  }
  return "5m";
}

export type SignalDirection = "CALL" | "PUT";
export type PlainSignalLabel = "Bullish" | "Bearish" | "None";

export function signalLabel(value: number | null): PlainSignalLabel {
  if (value === null) return "None";
  if (value <= RSI_OVERSOLD) return "Bullish";
  if (value >= RSI_OVERBOUGHT) return "Bearish";
  return "None";
}

export function signalDirection(value: number | null): SignalDirection | null {
  const label = signalLabel(value);
  if (label === "Bullish") return "CALL";
  if (label === "Bearish") return "PUT";
  return null;
}

export interface BacktestResult {
  wins: number;
  samples: number;
  winRate: number | null;
}

export function backtestSignals(
  highs: number[],
  lows: number[],
  closes: number[],
  requireEmaTrend: boolean,
): BacktestResult {
  let wins = 0;
  let samples = 0;

  for (
    let end = requireEmaTrend ? EMA_PERIOD + 1 : RSI_PERIOD + 1;
    end < closes.length;
    end += 1
  ) {
    const history = closes.slice(0, end);
    const direction = signalDirection(rsi(history, RSI_PERIOD));
    if (!direction) continue;

    const trend = ema(history, EMA_PERIOD);
    if (
      requireEmaTrend &&
      (trend === null ||
        (direction === "CALL" && closes[end - 1] <= trend) ||
        (direction === "PUT" && closes[end - 1] >= trend))
    ) {
      continue;
    }

    const previousClose = closes[end - 1];
    const nextClose = closes[end];
    samples += 1;
    if (
      (direction === "CALL" && nextClose > previousClose) ||
      (direction === "PUT" && nextClose < previousClose)
    ) {
      wins += 1;
    }
  }

  return {
    wins,
    samples,
    winRate: samples === 0 ? null : (wins / samples) * 100,
  };
}
