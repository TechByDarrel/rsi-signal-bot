export const BINANCE_API = "https://api.binance.com";
export const RSI_PERIOD = 14;
export const RSI_OVERSOLD = 30;
export const RSI_OVERBOUGHT = 70;
export const EMA_PERIOD = 50;
export const ATR_PERIOD = 14;
export const TIMEFRAMES = ["1m", "5m", "15m", "1h"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const CANDLES_TO_ANALYZE = 500;
export const DEFAULT_PAIR_LIMIT = 30;
export const DEFAULT_PAYOUT_PERCENT = 80;
export const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const REQUESTS_PER_BATCH = 5;
export const REQUEST_WEIGHT_PER_KLINE = 2;

// Recommendation uses the pair's 1m ATR as a percentage of its last close.
// Above the high threshold recommends 1m; between thresholds recommends 5m;
// below the low threshold recommends 15m.
export const ATR_LOW_THRESHOLD_PERCENT = 0.12;
export const ATR_HIGH_THRESHOLD_PERCENT = 0.3;

export const SIGNAL_STORAGE_KEY = "rsi-signal-bot:recent-signals";
export const SIGNAL_STORAGE_LIMIT = 100;

export const TIMEFRAME_MILLISECONDS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};
