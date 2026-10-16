# RSI Signal Bot

An alert-only personal-use bot that watches cryptocurrency pairs on Binance, calculates RSI, and records possible CALL and PUT signals. It does not place trades or connect to a broker.

## Setup

Install dependencies and start the bot with Node.js 18 or later:

```sh
npm install
npm start
```

The bot fetches public market candle data from Binance. It creates `logs/signals.csv` when it starts.

## Configuration

Change the watched pairs, candle interval, RSI thresholds, expiry, polling interval, and CSV path in [`src/config.ts`](src/config.ts).

## Reading the output

Each polling tick prints a table with the pair, latest closed-candle price, RSI, and any signal. A CALL signal is raised when RSI is at or below the oversold threshold; a PUT signal is raised when RSI is at or above the overbought threshold. The bot also prints each signal, its eventual WIN or LOSS result, and a running record.

The CSV contains a signal row with status `OPEN`, followed by a result row when the signal is evaluated. Result rows have status and result set to `WIN` or `LOSS`, along with the comparison price.

## Limitations

- Market data comes from Binance, not Pocket Option or any other broker.
- The expiry check is a simple comparison between the entry price and a later fetched candle price; it does not model broker pricing or execution.
- This software is for alerts and record-keeping only. It does not place trades or orders.
- Nothing here is financial advice. Test on demo first.
