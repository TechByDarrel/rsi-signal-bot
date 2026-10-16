import {
  BINANCE_API,
  CANDLES_TO_ANALYZE,
  REQUESTS_PER_BATCH,
  REQUEST_WEIGHT_PER_KLINE,
  TIMEFRAME_MILLISECONDS,
  TIMEFRAMES,
  type Timeframe,
} from "./config";

export interface Candle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  closed: boolean;
}

export interface Ticker24h {
  symbol: string;
  open: number;
  high: number;
  low: number;
  last: number;
  changePercent: number;
  rangePercent: number;
}

interface ExchangeInfo {
  symbols: Array<{
    symbol: string;
    quoteAsset: string;
    status: string;
  }>;
}

type StatusHandler = (message: string) => void;

const cache = new Map<
  string,
  { expiresAt: number; candles: Candle[]; promise?: Promise<Candle[]> }
>();
let rateLimitUntil = 0;
let statusHandler: StatusHandler = () => undefined;

export function setMarketStatusHandler(handler: StatusHandler): void {
  statusHandler = handler;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1, seconds) * 1000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return dateDelay;
  }
  return 60_000;
}

async function requestJson<T>(url: string): Promise<T> {
  while (true) {
    const remaining = rateLimitUntil - Date.now();
    if (remaining > 0) {
      statusHandler(
        `Rate limited, retrying in ${Math.ceil(remaining / 1000)}s`,
      );
      await sleep(Math.min(remaining, 10_000));
      continue;
    }

    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      const cause = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(
        `Could not reach Binance market data (network error${cause}). Your network or region may block this.`,
      );
    }
    if (response.status === 429 || response.status === 418) {
      const delay = retryDelay(response);
      rateLimitUntil = Date.now() + delay;
      statusHandler(
        `Rate limited, retrying in ${Math.ceil(delay / 1000)}s (HTTP ${response.status})`,
      );
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Could not reach Binance market data (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}). Your network or region may block this.`,
      );
    }
    return (await response.json()) as T;
  }
}

export async function fetchUsdtUniverse(): Promise<string[]> {
  const info = await requestJson<ExchangeInfo>(
    `${BINANCE_API}/api/v3/exchangeInfo`,
  );
  return info.symbols
    .filter(
      (symbol) =>
        symbol.quoteAsset === "USDT" && symbol.status === "TRADING",
    )
    .map((symbol) => symbol.symbol);
}

export async function fetch24hTickers(
  universe: Set<string>,
): Promise<Ticker24h[]> {
  const tickers = await requestJson<
    Array<{
      symbol: string;
      openPrice: string;
      highPrice: string;
      lowPrice: string;
      lastPrice: string;
      priceChangePercent: string;
    }>
  >(`${BINANCE_API}/api/v3/ticker/24hr`);

  return tickers
    .filter((ticker) => universe.has(ticker.symbol))
    .map((ticker) => {
      const open = Number(ticker.openPrice);
      const high = Number(ticker.highPrice);
      const low = Number(ticker.lowPrice);
      return {
        symbol: ticker.symbol,
        open,
        high,
        low,
        last: Number(ticker.lastPrice),
        changePercent: Number(ticker.priceChangePercent),
        rangePercent: open > 0 ? ((high - low) / open) * 100 : 0,
      };
    });
}

async function requestCandles(
  symbol: string,
  interval: Timeframe,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(CANDLES_TO_ANALYZE + 1),
  });
  const rows = await requestJson<unknown[][]>(
    `${BINANCE_API}/api/v3/klines?${params.toString()}`,
  );
  if (!Array.isArray(rows)) {
    throw new Error(`Binance returned an invalid candle response for ${symbol}`);
  }
  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error(
        `Binance returned an invalid candle at index ${index} for ${symbol}`,
      );
    }
    return {
      openTime: Number(row[0]),
      closeTime: Number(row[6]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      closed: Number(row[6]) < Date.now(),
    };
  });
}

export async function fetchCandles(
  symbol: string,
  interval: Timeframe,
): Promise<Candle[]> {
  const now = Date.now();
  for (const [cachedKey, value] of cache) {
    if (value.expiresAt <= now) cache.delete(cachedKey);
  }

  const key = `${symbol}:${interval}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    if (existing.promise) return existing.promise;
    return existing.candles;
  }

  const promise = requestCandles(symbol, interval).then((candles) => {
    cache.set(key, {
      candles,
      expiresAt: Date.now() + TIMEFRAME_MILLISECONDS[interval],
    });
    return candles;
  });
  cache.set(key, {
    candles: [],
    expiresAt: Date.now() + TIMEFRAME_MILLISECONDS[interval],
    promise,
  });

  try {
    return await promise;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export async function fetchAnalysisCandles(
  symbols: string[],
  onProgress: (completed: number, total: number) => void,
): Promise<Map<string, Partial<Record<Timeframe, Candle[]>>>> {
  const jobs = symbols.flatMap((symbol) =>
    TIMEFRAMES.map((timeframe) => ({ symbol, timeframe })),
  );
  const results = new Map<string, Partial<Record<Timeframe, Candle[]>>>();
  const totalWeight = jobs.length * REQUEST_WEIGHT_PER_KLINE;
  if (totalWeight > 1000) {
    throw new Error(
      `Analysis requires ${totalWeight} request weight, exceeding the 1000 weight/minute budget`,
    );
  }

  let completed = 0;
  for (let start = 0; start < jobs.length; start += REQUESTS_PER_BATCH) {
    const batch = jobs.slice(start, start + REQUESTS_PER_BATCH);
    const responses = await Promise.all(
      batch.map(async ({ symbol, timeframe }) => ({
        symbol,
        timeframe,
        candles: await fetchCandles(symbol, timeframe),
      })),
    );
    for (const response of responses) {
      const perTimeframe = results.get(response.symbol) ?? {};
      perTimeframe[response.timeframe] = response.candles;
      results.set(response.symbol, perTimeframe);
      completed += 1;
      onProgress(completed, jobs.length);
    }
  }
  return results;
}

export function volatilityRank(tickers: Ticker24h[]): Ticker24h[] {
  return [...tickers].sort((left, right) => right.rangePercent - left.rangePercent);
}
