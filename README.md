# RSI Signal Bot

A browser-based dashboard that scans Binance spot markets quoted in USDT, ranks pairs by their 24-hour high-low range, and displays RSI-based CALL/PUT signals with a simplified historical backtest. It is for market analysis and alerting only: it does not connect to Pocket Option, any broker, or place trades or orders.

## Local development

Requires Node.js 20.19 or later.

```sh
npm install
npm run dev
```

Vite prints the local URL. The app runs entirely in your browser and fetches Binance public market data without API keys. If Binance rate-limits requests, the dashboard displays the wait and retries after the requested delay.

## Tests and production build

```sh
npm test
npm run build
```

Vitest covers RSI, ATR, the break-even payout calculation, and the timeframe recommendation rule.

## How to use the dashboard

- The universe is loaded dynamically from Binance exchange information (USDT quote assets in `TRADING` status). The app ranks that universe by `((24h high - 24h low) / 24h open) * 100` and deeply analyzes the selected top pairs.
- Adjust the number of pairs, search, sort, filter by volatility, and set a binary payout percentage. Break-even is `100 / (100 + payout) * 100` percent. It is a comparison reference, not a prediction.
- The optional EMA(50) filter is on by default: CALL signals require price above EMA(50), and PUT signals require price below it. The filter also applies to historical replay.
- The timeframe recommendation uses the pair's 1m ATR as a percentage of its last close. Above `ATR_HIGH_THRESHOLD_PERCENT` recommends 1m; between the high and low thresholds recommends 5m; below `ATR_LOW_THRESHOLD_PERCENT` recommends 15m. The levels and thresholds are configurable in `src/config.ts`.
- RSI(14) is calculated on closed candles only; RSI at or below 30 suggests CALL and at or above 70 suggests PUT. A signal's timeframe is labelled its **suggested candle timeframe**, not a guaranteed expiry.
- The backtest replays signals over up to 500 closed candles. A win means the next candle's close moved in the signal direction. Every win rate includes its sample size; fewer than 30 signals is flagged as insufficient sample.
- Recent signals are saved in this browser's local storage. Clearing site data removes that local feed.

## Limitations and risk

Data comes from Binance public spot markets, not Pocket Option or a broker. The historical result is a simple one-candle price comparison and excludes fees, slippage, execution, and other real-world factors. Historical results do not predict future results. Binary options carry high risk and may be restricted in your country. Nothing here is financial advice. The app only analyzes and displays signals; it never places trades.

## GitHub Pages deployment

The included GitHub Actions workflow builds and deploys `dist/` on every push to `main`. One-time setup: in your repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.

The expected live URL is:

<https://TECHBYDARREL.github.io/rsi-signal-bot/>
