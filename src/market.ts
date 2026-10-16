export interface Candle {
  openTime: number;
  close: number;
}

export async function fetchCandles(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  const response = await fetch(
    `https://api.binance.com/api/v3/klines?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error(
      `Binance candle request failed for ${symbol}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(`Binance returned an invalid candle response for ${symbol}`);
  }

  return (data as unknown[][]).map((row, index) => {
    if (row.length < 5) {
      throw new Error(`Binance returned an invalid candle at index ${index} for ${symbol}`);
    }

    return {
      openTime: Number(row[0]),
      close: Number(row[4]),
    };
  });
}
