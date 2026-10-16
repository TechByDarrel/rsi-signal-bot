import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CANDLE_LIMIT,
  EXPIRY_MINUTES,
  INTERVAL,
  LOG_FILE,
  PAIRS,
  POLL_SECONDS,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  RSI_PERIOD,
} from "./config";
import { rsi } from "./indicators";
import { fetchCandles } from "./market";

const CSV_HEADER =
  "signal_time,pair,direction,entry_price,rsi,status,result_price,result\n";

type Direction = "CALL" | "PUT";

interface PendingSignal {
  signalTime: string;
  pair: string;
  direction: Direction;
  entryPrice: number;
  rsi: number;
  evaluateAt: number;
}

interface TableRow {
  PAIR: string;
  PRICE: string;
  RSI: string;
  SIGNAL: string;
}

const pendingSignals: PendingSignal[] = [];
const lastSignalCandleByPair = new Map<string, number>();
let wins = 0;
let losses = 0;
let tickRunning = false;

async function initializeLog(): Promise<void> {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });

  if (!existsSync(LOG_FILE)) {
    await writeFile(LOG_FILE, CSV_HEADER, "utf8");
  }
}

function csvRow(
  signal: PendingSignal,
  status: string,
  resultPrice = "",
  result = "",
): string {
  return [
    signal.signalTime,
    signal.pair,
    signal.direction,
    String(signal.entryPrice),
    signal.rsi.toFixed(1),
    status,
    resultPrice,
    result,
  ].join(",") + "\n";
}

async function appendSignalRow(
  signal: PendingSignal,
  status: string,
  resultPrice = "",
  result = "",
): Promise<void> {
  await appendFile(LOG_FILE, csvRow(signal, status, resultPrice, result), "utf8");
}

async function runTick(): Promise<void> {
  if (tickRunning) {
    return;
  }

  tickRunning = true;
  try {
    const tableRows: TableRow[] = [];
    const currentPrices = new Map<string, number>();

    for (const pair of PAIRS) {
      try {
        const candles = await fetchCandles(pair, INTERVAL, CANDLE_LIMIT);
        const closedCandles = candles.slice(0, -1);
        if (closedCandles.length === 0) {
          throw new Error("No closed candles were returned");
        }

        const lastClosedCandle = closedCandles[closedCandles.length - 1];
        const price = lastClosedCandle.close;
        currentPrices.set(pair, price);

        const currentRsi = rsi(
          closedCandles.map((candle) => candle.close),
          RSI_PERIOD,
        );
        let signalLabel = "-";

        if (currentRsi !== null) {
          const direction =
            currentRsi <= RSI_OVERSOLD
              ? "CALL"
              : currentRsi >= RSI_OVERBOUGHT
                ? "PUT"
                : null;

          if (
            direction !== null &&
            lastSignalCandleByPair.get(pair) !== lastClosedCandle.openTime
          ) {
            const signal: PendingSignal = {
              signalTime: new Date().toISOString(),
              pair,
              direction,
              entryPrice: price,
              rsi: currentRsi,
              evaluateAt: Date.now() + EXPIRY_MINUTES * 60_000,
            };

            await appendSignalRow(signal, "OPEN");
            pendingSignals.push(signal);
            lastSignalCandleByPair.set(pair, lastClosedCandle.openTime);
            signalLabel = direction;
            console.log(
              `>> ${direction} signal on ${pair} at ${price.toFixed(8)} (RSI ${currentRsi.toFixed(1)})`,
            );
          } else if (direction !== null) {
            signalLabel = `${direction} (already signaled)`;
          }
        }

        tableRows.push({
          PAIR: pair,
          PRICE: price.toFixed(8),
          RSI: currentRsi === null ? "N/A" : currentRsi.toFixed(1),
          SIGNAL: signalLabel,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`Error processing ${pair}: ${message}`);
        tableRows.push({
          PAIR: pair,
          PRICE: "-",
          RSI: "-",
          SIGNAL: "ERROR",
        });
      }
    }

    console.table(tableRows);

    const now = Date.now();
    for (let index = pendingSignals.length - 1; index >= 0; index -= 1) {
      const signal = pendingSignals[index];
      const currentPrice = currentPrices.get(signal.pair);

      if (now < signal.evaluateAt || currentPrice === undefined) {
        continue;
      }

      const won =
        signal.direction === "CALL"
          ? currentPrice > signal.entryPrice
          : currentPrice < signal.entryPrice;
      const result = won ? "WIN" : "LOSS";

      try {
        await appendSignalRow(signal, result, String(currentPrice), result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`Error recording ${signal.pair} result: ${message}`);
        continue;
      }

      if (won) {
        wins += 1;
      } else {
        losses += 1;
      }

      console.log(
        `${result}: ${signal.direction} on ${signal.pair} at ${currentPrice.toFixed(8)}`,
      );
      pendingSignals.splice(index, 1);
    }

    const total = wins + losses;
    const winRate = total === 0 ? 0 : (wins / total) * 100;
    console.log(
      `Record so far: ${wins}W / ${losses}L (${winRate.toFixed(1)}% win rate over ${total} signals)`,
    );
  } finally {
    tickRunning = false;
  }
}

async function main(): Promise<void> {
  await initializeLog();
  await runTick();

  setInterval(() => {
    void runTick().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Tick failed: ${message}`);
    });
  }, POLL_SECONDS * 1000);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to start RSI signal bot: ${message}`);
  process.exitCode = 1;
});
