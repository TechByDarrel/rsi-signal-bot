import {
  ATR_HIGH_THRESHOLD_PERCENT,
  ATR_LOW_THRESHOLD_PERCENT,
  ATR_PERIOD,
  CANDLES_TO_ANALYZE,
  DEFAULT_PAIR_LIMIT,
  DEFAULT_PAYOUT_PERCENT,
  DEFAULT_EARLY_WARNING_MINUTES,
  EMA_PERIOD,
  REFRESH_INTERVAL_MS,
  REST_FALLBACK_INTERVAL_MS,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  RSI_PERIOD,
  SIGNAL_STORAGE_KEY,
  SIGNAL_STORAGE_LIMIT,
  TIMEFRAMES,
  UI_UPDATE_INTERVAL_MS,
  WEBSOCKET_MAX_STREAMS,
  WEBSOCKET_RECONNECT_BASE_MS,
  WEBSOCKET_RECONNECT_MAX_MS,
  WEBSOCKET_ROTATE_MS,
  type Timeframe,
} from "./config";
import {
  atr,
  backtestSignals,
  breakEvenWinRate,
  ema,
  recommendTimeframe,
  rsi,
  signalDirection,
  type SignalDirection,
} from "./indicators";
import {
  fetch24hTickers,
  fetchAnalysisCandles,
  fetchUsdtUniverse,
  setMarketStatusHandler,
  volatilityRank,
  type Candle,
  type Ticker24h,
} from "./market";
import {
  calculateDevelopingWinRate,
  CandleBuffer,
  isWithinEarlyWarningWindow,
  replayDevelopingSignals,
  transitionSignalState,
  type SignalState,
  type SignalTransition,
} from "./realtime";
import "./style.css";

interface TimeframeAnalysis {
  candles: Candle[];
  oneMinuteLastOpenTime: number | null;
  rsi: number | null;
  atrPercent: number | null;
  ema: number | null;
  direction: SignalDirection | null;
  backtest: ReturnType<typeof backtestSignals>;
  developingBacktest: ReturnType<typeof calculateDevelopingWinRate>;
  backtestEmaFilter: boolean;
  developingEmaFilter: boolean;
  developingLeadMinutes: 2 | 5;
}

interface PairAnalysis {
  ticker: Ticker24h;
  recommendation: Timeframe | null;
  volatility: "Low" | "Medium" | "High" | "Unknown";
  frames: Partial<Record<Timeframe, TimeframeAnalysis>>;
}

interface SignalRecord {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  state: SignalState;
  rsi: number;
  atrPercent: number;
  entryPrice: number;
  generatedAt: string;
  emaFilterEnabled?: boolean;
  priceAboveEma?: boolean | null;
  closeTime?: number;
  remainingMs?: number;
}

interface ActiveSignal {
  candleOpenTime: number;
  direction: SignalDirection;
  state: SignalState;
  id: string;
}

interface StreamKlineMessage {
  stream: string;
  data: {
    s: string;
    k: {
      t: number;
      T: number;
      o: string;
      h: string;
      l: string;
      c: string;
      x: boolean;
      i: string;
    };
  };
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Dashboard root element was not found");

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="RSI Signal Bot dashboard home">
        <span class="brand-mark" aria-hidden="true">R</span>
        <span><strong>RSI Signal Bot</strong><small>MARKET INTELLIGENCE</small></span>
      </a>
      <div class="top-actions">
        <span class="live-indicator"><i></i> PUBLIC MARKET DATA</span>
        <span id="connection-badge" class="connection-badge offline" role="status" aria-live="polite"><i></i><b>Offline</b></span>
        <span class="last-stream-update">Last update <b id="last-stream-update">—</b></span>
        <button id="theme-toggle" class="icon-button" type="button" aria-label="Switch to light theme" title="Toggle light and dark theme">☼</button>
        <button id="refresh-button" class="button button-primary" type="button"><span aria-hidden="true">↻</span> Refresh scan</button>
      </div>
    </header>

    <main>
      <section class="disclaimer-banner" role="note">
        <span class="banner-icon" aria-hidden="true">!</span>
        <div><strong>Analysis only. No trades are placed.</strong><span>Binary options carry high risk, may be restricted in your country, and past results do not predict future results.</span></div>
      </section>

      <section class="intro-row">
        <div><p class="eyebrow">BINANCE SPOT · USDT MARKETS</p><h1>Market dashboard</h1><p class="intro-copy">Clear, rule-based market signals and historical context — all in your browser.</p></div>
        <div class="update-card"><span class="eyebrow">LAST UPDATED</span><strong id="last-updated">Waiting for first scan</strong><span id="scan-status" role="status" aria-live="polite">Ready to scan public market data</span></div>
      </section>

      <details class="how-to-panel">
        <summary><span class="how-icon" aria-hidden="true">?</span><span><strong>How to read this</strong><small>A quick guide to the dashboard</small></span><span class="details-chevron" aria-hidden="true">⌄</span></summary>
        <ul>
          <li><b>Bullish</b> = the rule expects price to go up on the next candle (<b>CALL</b>).</li>
          <li><b>Bearish</b> = the rule expects price to go down on the next candle (<b>PUT</b>).</li>
          <li><b>Timeframe</b> = the length of one candle; a signal uses that candle size.</li>
          <li><b>Win rate</b> = how often the rule was right in the past 500 candles. It is not a promise.</li>
          <li><b>Break-even</b> = the win rate needed to break even at your selected payout.</li>
        </ul>
        <div class="glossary" aria-label="Plain-language glossary">
          <details class="glossary-term"><summary aria-label="What does RSI mean?" title="Open the RSI definition"><span>RSI</span></summary><p><b>RSI:</b> A momentum score from 0 to 100; at or below 30 is oversold and at or above 70 is overbought.</p></details>
          <details class="glossary-term"><summary aria-label="What does ATR mean?" title="Open the ATR definition"><span>ATR</span></summary><p><b>ATR:</b> The average recent candle range, used here to compare market movement with price.</p></details>
          <details class="glossary-term"><summary aria-label="What does EMA mean?" title="Open the EMA definition"><span>EMA</span></summary><p><b>EMA:</b> A moving average that gives more weight to recent prices; the optional filter checks price against its 50-candle value.</p></details>
          <details class="glossary-term"><summary aria-label="What does volatility mean?" title="Open the volatility definition"><span>Volatility</span></summary><p><b>Volatility:</b> How much price has moved recently; this label is based on 1-minute ATR as a percent of price.</p></details>
          <details class="glossary-term"><summary aria-label="What does payout mean?" title="Open the payout definition"><span>Payout</span></summary><p><b>Payout:</b> The percentage return on a winning outcome used to calculate the break-even rate.</p></details>
          <details class="glossary-term"><summary aria-label="What does sample size mean?" title="Open the sample size definition"><span>Sample size</span></summary><p><b>Sample size:</b> The number of historical signals counted in the win rate; small samples can be misleading.</p></details>
        </div>
      </details>

      <section class="data-panel live-panel" aria-labelledby="live-title">
        <div class="section-heading"><div><p class="eyebrow">STREAMING BINANCE CANDLES</p><h2 id="live-title">Live signals</h2></div><span id="live-summary" class="muted" role="status" aria-live="polite">Waiting for WebSocket data</span></div>
        <div id="live-signal-feed" class="live-signal-feed"><div class="empty-state">Developing warnings appear near candle close; confirmed signals appear after a candle closes.</div></div>
      </section>

      <section class="rule-panel" aria-labelledby="rule-title">
        <div class="rule-icon" aria-hidden="true">↗</div>
        <div><h2 id="rule-title">How we recommend a candle size</h2><p>Based on 1m ATR as % of price: <b>High</b> volatility (&gt; ${ATR_HIGH_THRESHOLD_PERCENT}%) → 1m · <b>Medium</b> (${ATR_LOW_THRESHOLD_PERCENT}%–${ATR_HIGH_THRESHOLD_PERCENT}%) → 5m · <b>Low</b> (&lt; ${ATR_LOW_THRESHOLD_PERCENT}%) → 15m. This is a rule of thumb, not a forecast.</p></div>
        <span class="rule-tag">CONFIGURABLE IN SRC/CONFIG.TS</span>
      </section>

      <section class="summary-grid" aria-label="Signal summary">
        <article class="metric-card bullish-summary"><span class="metric-label">BULLISH SIGNALS <button class="term-tip" type="button" aria-label="About bullish signal count" title="Pairs whose recommended timeframe currently meets the bullish signal rule.">?</button></span><strong id="bullish-count" title="Current bullish signals on the recommended candle timeframe">—</strong><span>▲ Rule expects price up · CALL</span></article>
        <article class="metric-card bearish-summary"><span class="metric-label">BEARISH SIGNALS <button class="term-tip" type="button" aria-label="About bearish signal count" title="Pairs whose recommended timeframe currently meets the bearish signal rule.">?</button></span><strong id="bearish-count" title="Current bearish signals on the recommended candle timeframe">—</strong><span>▼ Rule expects price down · PUT</span></article>
        <article class="metric-card"><span class="metric-label">PAIRS ANALYZED</span><strong id="analyzed-count" tabindex="0" title="Number of top-ranked USDT pairs analyzed">—</strong><span id="universe-summary">Ranked by 24h range</span></article>
        <article class="metric-card top-pairs-card"><span class="metric-label">TOP 3 BY 24H PRICE RANGE <button class="term-tip" type="button" aria-label="About 24-hour pair ranking" title="Ranked by the high-to-low price range during the last 24 hours, relative to the open.">?</button></span><div id="top-pairs"><span class="muted">Waiting for scan</span></div></article>
      </section>

      <section class="controls-panel" aria-label="Dashboard controls">
        <label class="search-control"><span class="sr-only">Search trading pairs</span><span aria-hidden="true">⌕</span><input id="search-input" type="search" placeholder="Search pair…" autocomplete="off" aria-label="Search trading pairs"></label>
        <label class="select-control">Sort by<select id="sort-select" aria-label="Sort pairs"><option value="volatility">Volatility</option><option value="rsi">RSI</option><option value="win-rate">Win rate</option></select></label>
        <label class="select-control">Volatility<select id="volatility-filter" aria-label="Filter by volatility"><option value="all">All levels</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></label>
        <div class="payout-control"><label class="number-control">Payout % <button class="term-tip" type="button" aria-label="What is payout?" title="The percentage return on a winning outcome. Break-even is 100 / (100 + payout) × 100.">?</button><input id="payout-input" type="number" min="0" max="1000" step="1" value="${DEFAULT_PAYOUT_PERCENT}" aria-label="Binary payout percentage" title="Enter the payout percentage to update the break-even calculation."></label><span id="payout-summary" class="payout-explainer" aria-live="polite">You need to win about 55.6% of outcomes to break even at 80%.</span></div>
        <label class="select-control">Early warning<select id="early-warning" aria-label="Early warning lead time"><option value="${DEFAULT_EARLY_WARNING_MINUTES}">${DEFAULT_EARLY_WARNING_MINUTES} minutes</option><option value="5">5 minutes</option></select></label>
        <label class="number-control">Pairs to analyze<input id="pair-limit" type="number" min="1" max="100" step="1" value="${DEFAULT_PAIR_LIMIT}" aria-label="Number of top pairs to analyze" title="Analyze this many of the pairs with the largest 24-hour range"></label>
        <label class="toggle-control"><input id="ema-toggle" type="checkbox" checked aria-label="Require EMA 50 trend alignment"><span class="toggle-track"></span><span>EMA(50) filter</span><button class="term-tip" type="button" aria-label="About the EMA filter" title="When on, Bullish signals require price above EMA(50); Bearish signals require price below it.">?</button></label>
        <label class="toggle-control notification-toggle"><input id="notification-toggle" type="checkbox" aria-label="Enable browser notifications"><span class="toggle-track"></span><span>Browser notifications</span></label>
        <p class="early-warning-note">An early warning is based on a candle that is still forming. It can change before close. Check the early-warning win rate before relying on it.</p>
      </section>

      <div id="error-state" class="error-state" role="alert" hidden></div>
      <section class="data-panel" aria-labelledby="pairs-title">
        <div class="section-heading"><div><p class="eyebrow">LIVE SCAN · CLOSED CANDLES</p><h2 id="pairs-title">Pair signals</h2></div><span id="table-summary" class="muted">Waiting for data</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">PAIR</th><th scope="col">PRICE</th><th scope="col">24H CHANGE</th><th scope="col">VOLATILITY</th><th scope="col">CANDLE TIMEFRAME</th><th scope="col">RSI</th><th scope="col">SIGNAL</th><th scope="col">HISTORICAL WIN RATE</th><th scope="col">BREAK-EVEN</th><th scope="col">SAMPLE SIZE</th></tr></thead>
            <tbody id="pairs-body"><tr><td colspan="10"><div class="skeleton-row"><i></i><i></i><i></i><i></i><i></i></div></td></tr></tbody>
          </table>
        </div>
        <div class="table-footnote">Volatility uses 1m ATR as a percent of price. Hover or focus a number for its meaning. Win rate replays up to 500 closed candles, one candle ahead.</div>
      </section>

      <div class="lower-grid">
        <section class="data-panel signal-panel" aria-labelledby="signals-title">
          <div class="section-heading"><div><p class="eyebrow">NEWEST FIRST · SAVED IN THIS BROWSER</p><h2 id="signals-title">Recent signal feed</h2></div><span id="feed-count" class="muted">0 saved</span></div>
          <div id="signal-feed" class="signal-feed"><div class="empty-state">Signals will appear here when the RSI rules are met.</div></div>
        </section>
        <section class="data-panel backtest-panel" aria-labelledby="backtest-title">
          <div class="section-heading"><div><p class="eyebrow">UP TO 500 CANDLES · CLOSE-TO-CLOSE REPLAY</p><h2 id="backtest-title">Past results by signal state</h2></div><span class="muted">pair · candle size</span></div>
          <div class="warning-note"><span aria-hidden="true">⚠</span><p><strong>Historical results do not predict future results.</strong> Backtests are simplified and exclude fees, slippage, and execution.</p></div>
          <div class="table-wrap compact-table"><table><thead><tr><th scope="col">PAIR</th><th scope="col">TIMEFRAME</th><th scope="col">CONFIRMED</th><th scope="col">EARLY WARNING</th><th scope="col">CANCELLED WARNINGS</th><th scope="col">BREAK-EVEN</th></tr></thead><tbody id="backtest-body"><tr><td colspan="6" class="empty-cell">Backtest results appear after scanning.</td></tr></tbody></table></div>
        </section>
      </div>
      <footer><span>Market data: Binance public spot API</span><span>Analysis only · No broker connections · No trades placed</span></footer>
    </main>
  </div>`;

const elements = {
  status: document.querySelector<HTMLElement>("#scan-status")!,
  connection: document.querySelector<HTMLElement>("#connection-badge")!,
  lastStreamUpdate: document.querySelector<HTMLElement>("#last-stream-update")!,
  liveSummary: document.querySelector<HTMLElement>("#live-summary")!,
  liveFeed: document.querySelector<HTMLElement>("#live-signal-feed")!,
  error: document.querySelector<HTMLElement>("#error-state")!,
  updated: document.querySelector<HTMLElement>("#last-updated")!,
  analyzed: document.querySelector<HTMLElement>("#analyzed-count")!,
  bullish: document.querySelector<HTMLElement>("#bullish-count")!,
  bearish: document.querySelector<HTMLElement>("#bearish-count")!,
  topPairs: document.querySelector<HTMLElement>("#top-pairs")!,
  universeSummary: document.querySelector<HTMLElement>("#universe-summary")!,
  payoutSummary: document.querySelector<HTMLElement>("#payout-summary")!,
  summary: document.querySelector<HTMLElement>("#table-summary")!,
  pairsBody: document.querySelector<HTMLTableSectionElement>("#pairs-body")!,
  feed: document.querySelector<HTMLElement>("#signal-feed")!,
  feedCount: document.querySelector<HTMLElement>("#feed-count")!,
  backtestBody: document.querySelector<HTMLTableSectionElement>("#backtest-body")!,
  refresh: document.querySelector<HTMLButtonElement>("#refresh-button")!,
  search: document.querySelector<HTMLInputElement>("#search-input")!,
  sort: document.querySelector<HTMLSelectElement>("#sort-select")!,
  filter: document.querySelector<HTMLSelectElement>("#volatility-filter")!,
  payout: document.querySelector<HTMLInputElement>("#payout-input")!,
  earlyWarning: document.querySelector<HTMLSelectElement>("#early-warning")!,
  notifications: document.querySelector<HTMLInputElement>("#notification-toggle")!,
  pairLimit: document.querySelector<HTMLInputElement>("#pair-limit")!,
  ema: document.querySelector<HTMLInputElement>("#ema-toggle")!,
  theme: document.querySelector<HTMLButtonElement>("#theme-toggle")!,
};

let pairs: PairAnalysis[] = [];
let universeCount = 0;
let isScanning = false;
let storageWarning: string | null = null;
let recentSignals = loadSignals();
const candleBuffers = new Map<string, CandleBuffer>();
const activeSignals = new Map<string, ActiveSignal>();
const lastPairUpdate = new Map<string, number>();
const pendingPairUpdates = new Map<string, number>();
const sockets: WebSocket[] = [];
let socketStates: boolean[] = [];
const reconnectAttempts: number[] = [];
const connectionTimers: number[] = [];
let selectedSymbols: string[] = [];
let websocketGeneration = 0;
let streamLastReceivedAt = 0;
let notificationPermission: NotificationPermission =
  "Notification" in window ? Notification.permission : "denied";

function loadSignals(): SignalRecord[] {
  try {
    const stored = localStorage.getItem(SIGNAL_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isSignalRecord)
      .map((signal) => ({
        ...signal,
        state: signal.state ?? "CONFIRMED",
      }))
      .slice(0, SIGNAL_STORAGE_LIMIT);
  } catch {
    storageWarning =
      "Recent signals could not be read from this browser's local storage.";
    return [];
  }
}

function isSignalRecord(value: unknown): value is SignalRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SignalRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.symbol === "string" &&
    typeof record.timeframe === "string" &&
    TIMEFRAMES.includes(record.timeframe as Timeframe) &&
    (record.direction === "CALL" || record.direction === "PUT") &&
    (record.state === undefined ||
      record.state === "DEVELOPING" ||
      record.state === "CONFIRMED" ||
      record.state === "CANCELLED") &&
    typeof record.rsi === "number" &&
    Number.isFinite(record.rsi) &&
    typeof record.atrPercent === "number" &&
    Number.isFinite(record.atrPercent) &&
    typeof record.entryPrice === "number" &&
    Number.isFinite(record.entryPrice) &&
    (record.emaFilterEnabled === undefined ||
      typeof record.emaFilterEnabled === "boolean") &&
    (record.priceAboveEma === undefined ||
      record.priceAboveEma === null ||
      typeof record.priceAboveEma === "boolean") &&
    typeof record.generatedAt === "string"
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatPrice(value: number): string {
  return value >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value.toLocaleString(undefined, { maximumSignificantDigits: 7 });
}

function getPayout(): number {
  const value = Number(elements.payout.value);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_PAYOUT_PERCENT;
}

function bufferKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol}:${timeframe}`;
}

function calculateFrame(
  candles: Candle[],
  requireEma: boolean,
  timeframe: Timeframe,
  oneMinuteCandles: Candle[],
  existing?: TimeframeAnalysis,
): TimeframeAnalysis {
  const closed = candles.filter((candle) => candle.closed);
  const closes = closed.map((candle) => candle.close);
  const highs = closed.map((candle) => candle.high);
  const lows = closed.map((candle) => candle.low);
  const lastClose = closes.length ? closes[closes.length - 1] : null;
  const frameRsi = rsi(closes, RSI_PERIOD);
  const frameAtr = atr(highs, lows, closes, ATR_PERIOD);
  const frameEma = ema(closes, EMA_PERIOD);
  let direction = signalDirection(frameRsi);

  if (
    requireEma &&
    (frameEma === null ||
      (direction === "CALL" && (lastClose === null || lastClose <= frameEma)) ||
      (direction === "PUT" && (lastClose === null || lastClose >= frameEma)))
  ) {
    direction = null;
  }

  const lastClosedOpenTime = closed[closed.length - 1]?.openTime;
  const oneMinuteLastOpenTime =
    oneMinuteCandles[oneMinuteCandles.length - 1]?.openTime ?? null;
  const reuseConfirmedBacktest =
    existing !== undefined &&
    existing.candles[existing.candles.length - 1]?.openTime ===
      lastClosedOpenTime &&
    existing.backtestEmaFilter === requireEma;
  const leadMinutes: 2 | 5 =
    Number(elements.earlyWarning.value) === 5 ? 5 : 2;
  const reuseDevelopingBacktest =
    reuseConfirmedBacktest &&
    existing.oneMinuteLastOpenTime === oneMinuteLastOpenTime &&
    existing.developingEmaFilter === requireEma &&
    existing.developingLeadMinutes === leadMinutes;

  return {
    candles: closed,
    oneMinuteLastOpenTime,
    rsi: frameRsi,
    atrPercent:
      frameAtr !== null && lastClose !== null && lastClose > 0
        ? (frameAtr / lastClose) * 100
        : null,
    ema: frameEma,
    direction,
    backtest: reuseConfirmedBacktest
      ? existing.backtest
      : backtestSignals(highs, lows, closes, requireEma),
    backtestEmaFilter: requireEma,
    developingBacktest: reuseDevelopingBacktest
      ? existing.developingBacktest
      : replayDevelopingSignals(
          closed,
          oneMinuteCandles,
          timeframe,
          leadMinutes,
          requireEma,
        ),
    developingEmaFilter: requireEma,
    developingLeadMinutes: leadMinutes,
  };
}

function storeSignal(signal: SignalRecord): void {
  recentSignals = [
    signal,
    ...recentSignals.filter((saved) => saved.id !== signal.id),
  ].slice(0, SIGNAL_STORAGE_LIMIT);
  try {
    localStorage.setItem(SIGNAL_STORAGE_KEY, JSON.stringify(recentSignals));
  } catch {
    storageWarning =
      "Signals are visible for this session, but could not be saved in local storage.";
    elements.error.textContent = storageWarning;
    elements.error.hidden = false;
  }
}

function currentSignalRecord(id: string): SignalRecord | undefined {
  return recentSignals.find((signal) => signal.id === id);
}

function notifyDevelopingSignal(signal: SignalRecord): void {
  if (
    !elements.notifications.checked ||
    notificationPermission !== "granted" ||
    !("Notification" in window)
  ) {
    return;
  }
  const direction = signal.direction === "CALL" ? "Bullish" : "Bearish";
  new Notification(`${direction} developing · ${signal.symbol}`, {
    body: `${signal.timeframe} candle · RSI ${signal.rsi.toFixed(1)} · closes soon`,
    tag: signal.id,
  });
}

function buildSignalRecord(
  pair: PairAnalysis,
  timeframe: Timeframe,
  candle: Candle,
  id: string,
  direction: SignalDirection,
  state: SignalState,
  signalRsi: number,
  signalEma: number | null,
  entryPrice: number,
): SignalRecord {
  const frame = pair.frames[timeframe];
  return {
    id,
    symbol: pair.ticker.symbol,
    timeframe,
    direction,
    state,
    rsi: signalRsi,
    atrPercent: frame?.atrPercent ?? 0,
    entryPrice,
    generatedAt: currentSignalRecord(id)?.generatedAt ?? new Date().toISOString(),
    emaFilterEnabled: elements.ema.checked,
    priceAboveEma: signalEma === null ? null : entryPrice > signalEma,
    closeTime: candle.closeTime,
  };
}

function updateSignalState(
  pair: PairAnalysis,
  timeframe: Timeframe,
  candle: Candle,
  transition: SignalTransition,
  signalRsi: number | null,
  signalEma: number | null,
  entryPrice: number,
  notify: boolean,
  reuseId?: string,
): SignalRecord | undefined {
  if (!transition.state || !transition.direction) return undefined;
  const baseId = `${pair.ticker.symbol}:${timeframe}:${candle.openTime}:${transition.direction}`;
  const previousBase = currentSignalRecord(baseId);
  const id =
    reuseId ??
    (previousBase?.state === "CANCELLED" && transition.state === "DEVELOPING"
      ? `${baseId}:${Date.now()}`
      : baseId);
  const existing = currentSignalRecord(id);
  const wasDeveloping = existing?.state === "DEVELOPING";
  const signal = buildSignalRecord(
    pair,
    timeframe,
    candle,
    id,
    transition.direction,
    transition.state,
    signalRsi ?? existing?.rsi ?? 50,
    signalEma,
    existing?.entryPrice ?? entryPrice,
  );
  storeSignal(signal);
  if (notify && transition.state === "DEVELOPING" && !wasDeveloping) {
    notifyDevelopingSignal(signal);
  }
  return signal;
}

function calculateDirection(
  closed: Candle[],
  forming: Candle | null,
  requireEma: boolean,
): { direction: SignalDirection | null; value: number | null; average: number | null } {
  const closes = closed.map((candle) => candle.close);
  if (forming) closes.push(forming.close);
  const value = rsi(closes, RSI_PERIOD);
  const average = ema(closes, EMA_PERIOD);
  let direction = signalDirection(value);
  const currentPrice = forming?.close ?? closed[closed.length - 1]?.close;

  if (
    requireEma &&
    (average === null ||
      currentPrice === undefined ||
      (direction === "CALL" && currentPrice <= average) ||
      (direction === "PUT" && currentPrice >= average))
  ) {
    direction = null;
  }
  return { direction, value, average };
}

function evaluateSignalState(
  pair: PairAnalysis,
  timeframe: Timeframe,
  notify: boolean,
): void {
  const buffer = candleBuffers.get(bufferKey(pair.ticker.symbol, timeframe));
  if (!buffer) return;
  const closed = buffer.getClosed();
  const forming = buffer.getForming();
  const candle = forming ?? closed[closed.length - 1];
  if (!candle) return;

  const key = bufferKey(pair.ticker.symbol, timeframe);
  const tracked = activeSignals.get(key);
  const previous =
    tracked?.candleOpenTime === candle.openTime && tracked.state === "DEVELOPING"
      ? { state: tracked.state, direction: tracked.direction }
      : null;
  const inWarningWindow =
    forming !== null &&
    isWithinEarlyWarningWindow(
      forming.closeTime,
      Date.now(),
      Number(elements.earlyWarning.value) === 5 ? 5 : 2,
    );
  const computed = calculateDirection(closed, forming, elements.ema.checked);
  const currentDirection =
    forming && !inWarningWindow ? null : computed.direction;
  const transition = transitionSignalState(
    previous,
    currentDirection,
    forming === null,
  );

  if (transition.state === "CANCELLED" && tracked) {
    const oldRecord = currentSignalRecord(tracked.id);
    if (oldRecord) storeSignal({ ...oldRecord, state: "CANCELLED" });
    activeSignals.set(key, {
      ...tracked,
      state: "CANCELLED",
    });
    if (currentDirection && forming && inWarningWindow) {
      const next = transitionSignalState(null, currentDirection, false);
      const nextSignal = updateSignalState(
        pair,
        timeframe,
        forming,
        next,
        computed.value,
        computed.average,
        forming.close,
        notify,
      );
      if (next.direction && next.state && nextSignal) {
        activeSignals.set(key, {
          candleOpenTime: candle.openTime,
          direction: next.direction,
          state: next.state,
          id: nextSignal.id,
        });
      }
    }
    return;
  }

  if (transition.state && transition.direction) {
    const signal = updateSignalState(
      pair,
      timeframe,
      candle,
      transition,
      computed.value,
      computed.average,
      forming?.close ?? candle.close,
      notify,
      tracked?.candleOpenTime === candle.openTime &&
        tracked.direction === transition.direction &&
        tracked.state === "DEVELOPING"
        ? tracked.id
        : undefined,
    );
    if (signal) {
      activeSignals.set(key, {
        candleOpenTime: candle.openTime,
        direction: transition.direction,
        state: transition.state,
        id: signal.id,
      });
    }
  } else if (tracked?.state === "DEVELOPING") {
    const oldRecord = currentSignalRecord(tracked.id);
    if (oldRecord) storeSignal({ ...oldRecord, state: "CANCELLED" });
    activeSignals.set(key, { ...tracked, state: "CANCELLED" });
  } else if (
    tracked?.state === "CONFIRMED" &&
    tracked.candleOpenTime !== candle.openTime &&
    forming === null
  ) {
    activeSignals.delete(key);
  }
}

function addNewSignals(analyses: PairAnalysis[]): void {
  const currentIds = new Set(recentSignals.map((signal) => signal.id));
  const candidates: SignalRecord[] = [];

  for (const pair of analyses) {
    for (const timeframe of TIMEFRAMES) {
      const frame = pair.frames[timeframe];
      const frameCandles = frame?.candles;
      const candle = frameCandles?.[frameCandles.length - 1];
      if (!frame?.direction || !candle || frame.rsi === null || frame.atrPercent === null) {
        continue;
      }
      const id = `${pair.ticker.symbol}:${timeframe}:${candle.openTime}:${frame.direction}`;
      activeSignals.set(bufferKey(pair.ticker.symbol, timeframe), {
        candleOpenTime: candle.openTime,
        direction: frame.direction,
        state: "CONFIRMED",
        id,
      });
      if (currentIds.has(id)) continue;
      candidates.push({
        id,
        symbol: pair.ticker.symbol,
        timeframe,
        direction: frame.direction,
        state: "CONFIRMED",
        rsi: frame.rsi,
        atrPercent: frame.atrPercent,
        entryPrice: candle.close,
        generatedAt: new Date().toISOString(),
        emaFilterEnabled: elements.ema.checked,
        priceAboveEma:
          frame.ema === null ? null : candle.close > frame.ema,
        closeTime: candle.closeTime,
      });
      currentIds.add(id);
    }
  }

  candidates.sort(
    (left, right) =>
      Date.parse(right.generatedAt) - Date.parse(left.generatedAt),
  );
  for (const signal of candidates) storeSignal(signal);
}

function volatilityFor(atrPercent: number | null): PairAnalysis["volatility"] {
  if (atrPercent === null) return "Unknown";
  if (atrPercent > ATR_HIGH_THRESHOLD_PERCENT) return "High";
  if (atrPercent < ATR_LOW_THRESHOLD_PERCENT) return "Low";
  return "Medium";
}

function explainSignal(signal: SignalRecord): string {
  const value = signal.rsi.toFixed(1);
  const oversold = signal.direction === "CALL";
  if (
    signal.emaFilterEnabled &&
    typeof signal.priceAboveEma === "boolean"
  ) {
    return `RSI ${value} is ${oversold ? "oversold" : "overbought"} and price is ${oversold ? "above" : "below"} its 50-period average, so the rule expects a move ${oversold ? "up" : "down"} on the next candle.`;
  }
  return `RSI ${value} is ${oversold ? "oversold" : "overbought"}, so the rule expects price to move ${oversold ? "up" : "down"} on the next candle.`;
}

function signalMarkup(
  direction: SignalDirection | null,
  className = "signal-pill",
): string {
  if (!direction) return `<span class="neutral-signal">— No signal</span>`;
  const bullish = direction === "CALL";
  return `<span class="${className} ${bullish ? "bullish" : "bearish"}" aria-label="${bullish ? "Bullish signal, CALL" : "Bearish signal, PUT"}"><span aria-hidden="true">${bullish ? "▲" : "▼"}</span> ${bullish ? "BULLISH" : "BEARISH"} <small>· ${direction}</small></span>`;
}

function getVisiblePairs(): PairAnalysis[] {
  const query = elements.search.value.trim().toUpperCase();
  const filter = elements.filter.value;
  const visible = pairs.filter(
    (pair) =>
      pair.ticker.symbol.includes(query) &&
      (filter === "all" || pair.volatility === filter),
  );

  if (elements.sort.value === "rsi") {
    visible.sort(
      (a, b) =>
        (a.recommendation ? a.frames[a.recommendation]?.rsi ?? 101 : 101) -
        (b.recommendation ? b.frames[b.recommendation]?.rsi ?? 101 : 101),
    );
  } else if (elements.sort.value === "win-rate") {
    visible.sort(
      (a, b) =>
        (b.recommendation
          ? b.frames[b.recommendation]?.backtest.winRate ?? -1
          : -1) -
        (a.recommendation
          ? a.frames[a.recommendation]?.backtest.winRate ?? -1
          : -1),
    );
  } else {
    visible.sort((a, b) => b.ticker.rangePercent - a.ticker.rangePercent);
  }
  return visible;
}

function renderPairs(): void {
  const visible = getVisiblePairs();
  const breakEven = breakEvenWinRate(getPayout());
  elements.pairsBody.innerHTML =
    visible.length === 0
      ? `<tr><td colspan="10" class="empty-cell">No pairs match these filters.</td></tr>`
      : visible
          .map((pair) => {
            const recommended = pair.recommendation
              ? pair.frames[pair.recommendation]
              : undefined;
            const result = recommended?.backtest;
            const signal = recommended?.direction ?? null;
            const rsiValue = recommended?.rsi ?? null;
            const hasData = Boolean(recommended && rsiValue !== null);
            const status = !hasData
              ? "Not enough data"
              : signal === "CALL"
                ? "Bullish signal active"
                : signal === "PUT"
                  ? "Bearish signal active"
                  : "Waiting for signal";
            const rowTone = signal
              ? signal === "CALL"
                ? "row-bullish"
                : "row-bearish"
              : "row-neutral";
            const sampleCount = result?.samples ?? 0;
            const insufficient = sampleCount < 30;
            const winRate = result?.winRate ?? null;
            const hasWinRate = winRate !== null;
            const beats = winRate !== null && winRate >= breakEven;
            const frameAtr = recommended?.atrPercent;
            const atrDetailValues = TIMEFRAMES.map((timeframe) => {
              const value = pair.frames[timeframe]?.atrPercent;
              return { timeframe, value };
            });
            const atrDetails = atrDetailValues
              .map(({ timeframe, value }) =>
                `${timeframe}: ${value === null || value === undefined ? "not available" : `${value.toFixed(3)}%`}`,
              )
              .join(" · ");
            const atrDetailMarkup = atrDetailValues
              .map(
                ({ timeframe, value }) =>
                  `<span title="${timeframe} ATR(14) divided by last closed price.">${timeframe} <b>${value === null || value === undefined ? "—" : `${value.toFixed(3)}%`}</b></span>`,
              )
              .join("");
            const volatilityDescription =
              frameAtr === null || frameAtr === undefined
                ? "Volatility not available: not enough candle data."
                : `${pair.volatility} volatility. ATR as percent of price: ${atrDetails}.`;
            const priceChangeTitle = `24-hour price change: ${pair.ticker.changePercent.toFixed(2)}%.`;
            const rsiTitle =
              rsiValue === null
                ? "RSI is unavailable: not enough closed candles."
                : `RSI ${rsiValue.toFixed(1)}: ${rsiValue <= RSI_OVERSOLD ? `at or below ${RSI_OVERSOLD}, which is oversold and meets the bullish rule` : rsiValue >= RSI_OVERBOUGHT ? `at or above ${RSI_OVERBOUGHT}, which is overbought and meets the bearish rule` : "between the signal thresholds, so there is no RSI signal"}.`;

            const active =
              pair.recommendation
                ? activeSignals.get(bufferKey(pair.ticker.symbol, pair.recommendation))
                : undefined;
            const displayedDirection =
              active && active.state !== "CANCELLED"
                ? active.direction
                : signal;
            const displayedStatus =
              active?.state === "DEVELOPING"
                ? `${active.direction === "CALL" ? "Bullish" : "Bearish"} signal developing`
                : active?.state === "CONFIRMED"
                  ? `${active.direction === "CALL" ? "Bullish" : "Bearish"} signal active`
                  : status;
            return `<tr class="${displayedDirection ? displayedDirection === "CALL" ? "row-bullish" : "row-bearish" : rowTone}" data-pair="${escapeHtml(pair.ticker.symbol)}">
              <td><span class="pair-cell"><strong>${escapeHtml(pair.ticker.symbol.replace(/USDT$/, ""))}</strong><small>/ USDT</small></span></td>
              <td class="price-cell realtime-price" tabindex="0" title="Latest Binance candle price.">${formatPrice(pair.ticker.last)}</td>
              <td><strong class="change-value ${pair.ticker.changePercent >= 0 ? "positive-change" : "negative-change"}" tabindex="0" aria-label="${priceChangeTitle}" title="${priceChangeTitle}">${pair.ticker.changePercent >= 0 ? "▲" : "▼"} ${Math.abs(pair.ticker.changePercent).toFixed(2)}%</strong></td>
              <td><span class="volatility-badge ${frameAtr === null || frameAtr === undefined ? "unknown" : pair.volatility.toLowerCase()}" tabindex="0" title="${escapeHtml(volatilityDescription)}">${hasData ? pair.volatility : "Unknown"}</span><span class="volatility-detail" tabindex="0" title="${escapeHtml(`${atrDetails} · 24-hour range ${pair.ticker.rangePercent.toFixed(2)}%`)}">${frameAtr === null || frameAtr === undefined ? "ATR% unavailable" : `1m ATR ${frameAtr.toFixed(3)}%`}</span><details class="atr-details"><summary>ATR% details</summary><div>${atrDetailMarkup}</div></details></td>
              <td>${pair.recommendation ? `<span class="timeframe-chip" tabindex="0" title="Recommended candle length based on 1m volatility">${pair.recommendation}</span>` : `<span class="muted" title="Not enough candle data to recommend a timeframe">Not available</span>`}</td>
              <td class="realtime-rsi-cell">${rsiValue === null ? `<span class="muted" tabindex="0" title="${rsiTitle}">—</span>` : `<span class="rsi-value ${rsiValue <= RSI_OVERSOLD ? "bullish-text" : rsiValue >= RSI_OVERBOUGHT ? "bearish-text" : ""}" tabindex="0" title="${rsiTitle}">${rsiValue.toFixed(1)}</span><button class="number-help" type="button" title="${rsiTitle}" aria-label="${rsiTitle}">?</button>`}</td>
              <td class="realtime-signal-cell">${signalMarkup(displayedDirection)}<span class="pair-status ${displayedDirection ? displayedDirection === "CALL" ? "bullish-text" : "bearish-text" : ""}">${displayedStatus}</span></td>
              <td>${hasWinRate ? `<span class="rate-value ${insufficient ? "insufficient-rate" : beats ? "positive" : "negative"}" tabindex="0" title="Historical win rate over ${sampleCount} signal${sampleCount === 1 ? "" : "s"}; one-candle-ahead replay.">${winRate.toFixed(1)}%</span>` : `<span class="muted" tabindex="0" title="No historical signals were found">—</span>`}${insufficient ? `<span class="sample-warning">Insufficient sample</span>` : ""}</td>
              <td><span class="break-even-value" tabindex="0" title="At ${getPayout()}% payout, break-even is 100 / (100 + payout) × 100.">${breakEven.toFixed(1)}%</span></td>
              <td><span class="sample-count ${insufficient ? "insufficient-sample" : ""}" tabindex="0" title="Number of historical signals counted in the win rate.">${sampleCount}</span>${insufficient ? `<span class="sample-warning">Insufficient sample</span>` : ""}</td>
            </tr>`;
          })
          .join("");
  elements.summary.textContent = `${visible.length} of ${pairs.length} analyzed pairs`;
  elements.analyzed.textContent = String(pairs.length);
  const recommendedSignals = pairs.map((pair) =>
    pair.recommendation ? pair.frames[pair.recommendation]?.direction : null,
  );
  elements.bullish.textContent = String(
    recommendedSignals.filter((direction) => direction === "CALL").length,
  );
  elements.bearish.textContent = String(
    recommendedSignals.filter((direction) => direction === "PUT").length,
  );
}

function updateSummarySignalCounts(): void {
  const directions = pairs.map((pair) => {
    if (!pair.recommendation) return null;
    const active = activeSignals.get(
      bufferKey(pair.ticker.symbol, pair.recommendation),
    );
    return active && active.state !== "CANCELLED"
      ? active.direction
      : pair.frames[pair.recommendation]?.direction ?? null;
  });
  elements.bullish.textContent = String(
    directions.filter((direction) => direction === "CALL").length,
  );
  elements.bearish.textContent = String(
    directions.filter((direction) => direction === "PUT").length,
  );
}

function renderLiveSignals(): void {
  const activeIds = new Set(
    Array.from(activeSignals.values())
      .filter(
        (signal) =>
          signal.state === "DEVELOPING" || signal.state === "CONFIRMED",
      )
      .map((signal) => signal.id),
  );
  const live = recentSignals
    .filter(
      (signal) =>
        activeIds.has(signal.id) &&
        (signal.state === "DEVELOPING" || signal.state === "CONFIRMED"),
    )
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    .slice(0, 24);
  elements.liveFeed.innerHTML = live.length
    ? live
        .map((signal) => {
          const developing = signal.state === "DEVELOPING";
          const remaining = Math.max(0, (signal.closeTime ?? 0) - Date.now());
          const directionText =
            signal.direction === "CALL" ? "Bullish · CALL" : "Bearish · PUT";
          return `<article class="live-signal-card ${signal.direction === "CALL" ? "bullish" : "bearish"}">
            <div class="live-card-heading"><strong>${escapeHtml(signal.symbol)}</strong><span>${escapeHtml(signal.timeframe)}</span></div>
            <p class="signal-state">${developing ? `${directionText} developing, closes in ${Math.floor(remaining / 60_000)}:${String(Math.floor((remaining % 60_000) / 1_000)).padStart(2, "0")}` : `${directionText} · Confirmed`}</p>
            <dl><div><dt>RSI</dt><dd>${signal.rsi.toFixed(1)}</dd></div><div><dt>Entry price</dt><dd>${formatPrice(signal.entryPrice)}</dd></div><div><dt>State</dt><dd>${developing ? "Developing" : "Confirmed"}</dd></div></dl>
            <p class="why-signal">${escapeHtml(explainSignal(signal))}</p>
          </article>`;
        })
        .join("")
    : `<p class="empty-state">No developing or confirmed signals at the moment.</p>`;
}

function updateConnectionStatus(status: "Live" | "Reconnecting" | "Offline"): void {
  elements.connection.querySelector("b")!.textContent = status;
  elements.connection.className = `connection-badge ${status.toLowerCase()}`;
  elements.connection.setAttribute("aria-label", `Market data connection: ${status}`);
}

function updatePairRow(pair: PairAnalysis): void {
  const row = Array.from(elements.pairsBody.querySelectorAll<HTMLTableRowElement>("tr[data-pair]"))
    .find((candidate) => candidate.dataset.pair === pair.ticker.symbol);
  if (!row) return;
  const timeframe = pair.recommendation;
  const frame = timeframe ? pair.frames[timeframe] : undefined;
  const active = timeframe
    ? activeSignals.get(bufferKey(pair.ticker.symbol, timeframe))
    : undefined;
  const direction =
    active && active.state !== "CANCELLED" ? active.direction : frame?.direction ?? null;
  row.className = direction
    ? direction === "CALL"
      ? "row-bullish"
      : "row-bearish"
    : "row-neutral";
  const priceCell = row.querySelector<HTMLElement>(".realtime-price");
  if (priceCell) priceCell.textContent = formatPrice(pair.ticker.last);

  const rsiCell = row.querySelector<HTMLElement>(".realtime-rsi-cell");
  if (rsiCell) {
    const value = frame?.rsi;
    const title =
      value === null || value === undefined
        ? "Not enough closed candles to calculate RSI."
        : `RSI ${value.toFixed(1)}: ${value <= RSI_OVERSOLD ? "below 30 suggests an oversold market." : value >= RSI_OVERBOUGHT ? "above 70 suggests an overbought market." : "between the signal thresholds."}`;
    rsiCell.innerHTML =
      value === null || value === undefined
        ? `<span class="muted" title="${escapeHtml(title)}">—</span>`
        : `<span class="rsi-value ${value <= RSI_OVERSOLD ? "bullish-text" : value >= RSI_OVERBOUGHT ? "bearish-text" : ""}" title="${escapeHtml(title)}">${value.toFixed(1)}</span><button class="number-help" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">?</button>`;
  }
  const signalCell = row.querySelector<HTMLElement>(".realtime-signal-cell");
  if (signalCell) {
    const stateText =
      active?.state === "DEVELOPING"
        ? `${active.direction === "CALL" ? "Bullish" : "Bearish"} signal developing`
        : active?.state === "CONFIRMED"
          ? `${active.direction === "CALL" ? "Bullish" : "Bearish"} signal active`
          : direction
            ? `${direction === "CALL" ? "Bullish" : "Bearish"} signal active`
            : frame?.rsi === null || frame?.rsi === undefined
              ? "Not enough data"
              : "Waiting for signal";
    signalCell.innerHTML = `${signalMarkup(direction)}<span class="pair-status ${direction ? direction === "CALL" ? "bullish-text" : "bearish-text" : ""}">${stateText}</span>`;
  }
}

function renderFeed(): void {
  elements.feedCount.textContent = `${recentSignals.length} saved`;
  elements.feed.innerHTML =
    recentSignals.length === 0
      ? `<div class="empty-state">Signals will appear here when the RSI rules are met.</div>`
      : recentSignals
          .slice(0, 30)
          .map((signal) => {
            const historical = pairs
              .find((pair) => pair.ticker.symbol === signal.symbol)
              ?.frames[signal.timeframe]?.backtest;
            const historicalText =
              historical?.winRate === null || historical?.winRate === undefined
                ? "Historical rate unavailable"
                : `Historical ${historical.winRate.toFixed(1)}% · n=${historical.samples}${historical.samples < 30 ? " · insufficient sample" : ""}`;
            const why = explainSignal(signal);
            const stateLabel =
              signal.state === "DEVELOPING"
                ? "Developing"
                : signal.state === "CANCELLED"
                  ? "Cancelled"
                  : "Confirmed";
            return `<article class="feed-card">
              ${signalMarkup(signal.direction, "feed-direction")}<span class="feed-state ${signal.state.toLowerCase()}">${stateLabel}</span>
              <div class="feed-main"><strong>${escapeHtml(signal.symbol.replace(/USDT$/, ""))}<small>/ USDT</small></strong><span title="Suggested candle length for this signal; not a guaranteed expiry.">${signal.timeframe} suggested candle timeframe · RSI ${signal.rsi.toFixed(1)}</span><span class="feed-why"><b>Why this signal?</b> ${why}</span><span class="feed-history" title="${historicalText}">${historicalText}</span></div>
              <div class="feed-meta"><strong title="Entry price when this signal was generated.">${formatPrice(signal.entryPrice)}</strong><span title="Time when the signal was first detected.">${new Date(signal.generatedAt).toLocaleString()}</span></div>
              <span class="feed-atr" title="ATR(14) as a percentage of the last closed price.">Volatility ${signal.atrPercent.toFixed(3)}%</span>
            </article>`;
          })
          .join("");
}

function renderBacktest(): void {
  const visible = getVisiblePairs();
  const breakEven = breakEvenWinRate(getPayout());
  elements.backtestBody.innerHTML =
    visible.length === 0
      ? `<tr><td colspan="6" class="empty-cell">No pairs match these filters.</td></tr>`
      : visible
          .flatMap((pair) =>
            TIMEFRAMES.map((timeframe) => {
              const frame = pair.frames[timeframe];
              if (!frame) return "";
              const confirmed = frame.backtest;
              const early = frame.developingBacktest;
              const rateCell = (
                rate: number | null,
                samples: number,
                title: string,
              ): string => {
                const insufficient = samples < 30 || rate === null;
                const above = rate !== null && rate >= breakEven;
                return `<span class="backtest-rate ${insufficient ? "insufficient-rate" : above ? "positive" : "negative"}" title="${title}">${rate === null ? "—" : `${rate.toFixed(1)}%`} · n=${samples}</span>${insufficient ? `<span class="sample-warning">Insufficient sample</span>` : ""}`;
              };
              return `<tr><td>${escapeHtml(pair.ticker.symbol)}</td><td>${timeframe}</td><td>${rateCell(confirmed.winRate, confirmed.samples, "Confirmed signals: rule replayed on closed candles; outcome is the next closed candle.")}</td><td>${rateCell(early.winRate, early.samples, "Early warnings: replayed at the selected lead time using available 1-minute candle snapshots.")}</td><td>${early.cancelledPercent === null ? "—" : `${early.cancelledPercent.toFixed(1)}% · ${early.cancelled}/${early.samples}`}</td><td><span class="break-even-value">${breakEven.toFixed(1)}%</span></td></tr>`;
            }),
          )
          .join("");
}

function renderAll(): void {
  const breakEven = breakEvenWinRate(getPayout());
  elements.payoutSummary.textContent = `You need to win about ${breakEven.toFixed(1)}% of outcomes to break even at ${getPayout()}%.`;
  elements.universeSummary.textContent = `${universeCount.toLocaleString()} active USDT pairs · ranked by 24h range`;
  const top = [...pairs]
    .sort((left, right) => right.ticker.rangePercent - left.ticker.rangePercent)
    .slice(0, 3);
  elements.topPairs.innerHTML =
    top.length === 0
      ? `<span class="muted">Waiting for scan</span>`
      : top
          .map(
            (pair, index) =>
              `<span class="top-pair" title="${pair.ticker.rangePercent.toFixed(2)}% 24-hour high-to-low range"><b>${index + 1}.</b> ${escapeHtml(pair.ticker.symbol.replace(/USDT$/, ""))}<small>${pair.ticker.rangePercent.toFixed(2)}% · ${pair.recommendation ?? "No timeframe"}</small></span>`,
          )
          .join("");
  renderPairs();
  renderFeed();
  renderLiveSignals();
  renderBacktest();
}

function setStatus(message: string): void {
  elements.status.textContent = message;
}

function renderSkeleton(): void {
  elements.pairsBody.innerHTML = Array.from(
    { length: 8 },
    () => `<tr><td colspan="10"><div class="skeleton-row"><i></i><i></i><i></i><i></i><i></i></div></td></tr>`,
  ).join("");
}

function schedulePairUpdate(pair: PairAnalysis, historicalChanged: boolean): void {
  const symbol = pair.ticker.symbol;
  const now = Date.now();
  const elapsed = now - (lastPairUpdate.get(symbol) ?? 0);
  const update = (): void => {
    pendingPairUpdates.delete(symbol);
    lastPairUpdate.set(symbol, Date.now());
    updatePairRow(pair);
    updateSummarySignalCounts();
    renderLiveSignals();
    renderFeed();
    if (historicalChanged) renderBacktest();
    const developingCount = recentSignals.filter(
      (signal) => signal.state === "DEVELOPING",
    ).length;
    elements.liveSummary.textContent = `${developingCount} developing · live updates`;
  };
  if (elapsed >= UI_UPDATE_INTERVAL_MS) {
    const existing = pendingPairUpdates.get(symbol);
    if (existing !== undefined) window.clearTimeout(existing);
    update();
    return;
  }
  if (!pendingPairUpdates.has(symbol)) {
    const timer = window.setTimeout(update, UI_UPDATE_INTERVAL_MS - elapsed);
    pendingPairUpdates.set(symbol, timer);
  }
}

function applyCandleUpdate(
  symbol: string,
  timeframe: Timeframe,
  candle: Candle,
): void {
  const pair = pairs.find((candidate) => candidate.ticker.symbol === symbol);
  const key = bufferKey(symbol, timeframe);
  const buffer = candleBuffers.get(key);
  if (!pair || !buffer) return;
  buffer.update(candle);

  if (timeframe === "1m") pair.ticker.last = candle.close;
  const oneMinute = candleBuffers.get(bufferKey(symbol, "1m"))?.getClosed() ?? [];
  const previous = pair.frames[timeframe];
  const updated = calculateFrame(
    buffer.getClosed(),
    elements.ema.checked,
    timeframe,
    oneMinute,
    previous,
  );
  pair.frames[timeframe] = updated;

  if (timeframe === "1m") {
    const oneMinuteAtr = updated.atrPercent;
    pair.recommendation =
      oneMinuteAtr === null
        ? null
        : recommendTimeframe(
            oneMinuteAtr,
            ATR_LOW_THRESHOLD_PERCENT,
            ATR_HIGH_THRESHOLD_PERCENT,
          );
    pair.volatility = volatilityFor(oneMinuteAtr);
  }

  const before = currentSignalRecord(
    `${symbol}:${timeframe}:${candle.openTime}:CALL`,
  );
  evaluateSignalState(pair, timeframe, true);
  const afterCall = currentSignalRecord(
    `${symbol}:${timeframe}:${candle.openTime}:CALL`,
  );
  const afterPut = currentSignalRecord(
    `${symbol}:${timeframe}:${candle.openTime}:PUT`,
  );
  const historicalChanged =
    candle.closed &&
    (previous?.candles[previous.candles.length - 1]?.openTime !==
      updated.candles[updated.candles.length - 1]?.openTime ||
      before?.state !== afterCall?.state ||
      afterPut?.state === "CONFIRMED");
  if (candle.closed) {
    elements.updated.textContent = new Date().toLocaleTimeString();
  }
  schedulePairUpdate(pair, historicalChanged);
}

function reconnectBatch(index: number, generation: number): void {
  if (generation !== websocketGeneration) return;
  const old = sockets[index];
  if (old) {
    old.onclose = null;
    old.onerror = null;
    old.onmessage = null;
    old.onopen = null;
    old.close();
  }
  socketStates[index] = false;
  connectStreamBatch(index, generation);
}

function connectStreamBatch(index: number, generation: number): void {
  if (generation !== websocketGeneration) return;
  const batch = streamBatches[index];
  if (!batch?.length) return;
  updateConnectionStatus("Reconnecting");
  const url = `wss://stream.binance.com:9443/stream?streams=${batch.join("/")}`;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleReconnect(index, generation);
    return;
  }
  sockets[index] = socket;
  socket.onopen = () => {
    if (generation !== websocketGeneration) {
      socket.close();
      return;
    }
    socketStates[index] = true;
    reconnectAttempts[index] = 0;
    updateConnectionStatus(
      socketStates.every(Boolean) ? "Live" : "Reconnecting",
    );
    if (connectionTimers[index] !== undefined) {
      window.clearTimeout(connectionTimers[index]);
    }
    connectionTimers[index] = window.setTimeout(
      () => reconnectBatch(index, generation),
      WEBSOCKET_ROTATE_MS,
    );
  };
  socket.onmessage = (event: MessageEvent<string>) => {
    if (generation !== websocketGeneration || typeof event.data !== "string") return;
    let message: StreamKlineMessage;
    try {
      message = JSON.parse(event.data) as StreamKlineMessage;
    } catch {
      return;
    }
    if (!message?.data?.k || !message.data.s) return;
    const kline = message.data.k;
    const timeframe = kline.i as Timeframe;
    if (!TIMEFRAMES.includes(timeframe)) return;
    const candle: Candle = {
      openTime: Number(kline.t),
      closeTime: Number(kline.T),
      open: Number(kline.o),
      high: Number(kline.h),
      low: Number(kline.l),
      close: Number(kline.c),
      closed: kline.x,
    };
    if (
      !Number.isFinite(candle.openTime) ||
      !Number.isFinite(candle.closeTime) ||
      !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low)
    ) {
      return;
    }
    streamLastReceivedAt = Date.now();
    elements.lastStreamUpdate.textContent = new Date(streamLastReceivedAt).toLocaleTimeString();
    applyCandleUpdate(message.data.s, timeframe, candle);
  };
  socket.onerror = () => socket.close();
  socket.onclose = () => {
    if (generation !== websocketGeneration) return;
    socketStates[index] = false;
    updateConnectionStatus(socketStates.some(Boolean) ? "Reconnecting" : "Offline");
    scheduleReconnect(index, generation);
  };
}

function scheduleReconnect(index: number, generation: number): void {
  if (generation !== websocketGeneration) return;
  const attempt = reconnectAttempts[index] ?? 0;
  const delay = Math.min(
    WEBSOCKET_RECONNECT_BASE_MS * 2 ** attempt,
    WEBSOCKET_RECONNECT_MAX_MS,
  );
  reconnectAttempts[index] = attempt + 1;
  updateConnectionStatus("Reconnecting");
  elements.liveSummary.textContent = `Reconnecting · retry in ${Math.ceil(delay / 1000)}s`;
  if (connectionTimers[index] !== undefined) {
    window.clearTimeout(connectionTimers[index]);
  }
  connectionTimers[index] = window.setTimeout(
    () => connectStreamBatch(index, generation),
    delay,
  );
}

let streamBatches: string[][] = [];
function startWebSockets(symbols: string[]): void {
  if (
    symbols.length === selectedSymbols.length &&
    symbols.every((symbol, index) => symbol === selectedSymbols[index]) &&
    sockets.length > 0
  ) {
    return;
  }
  websocketGeneration += 1;
  const generation = websocketGeneration;
  for (const timer of connectionTimers) window.clearTimeout(timer);
  for (const socket of sockets) {
    socket.onclose = null;
    socket.close();
  }
  sockets.length = 0;
  connectionTimers.length = 0;
  reconnectAttempts.length = 0;
  selectedSymbols = [...symbols];
  socketStates = [];
  const streams = symbols.flatMap((symbol) =>
    TIMEFRAMES.map(
      (timeframe) => `${symbol.toLowerCase()}@kline_${timeframe}`,
    ),
  );
  streamBatches = [];
  for (let start = 0; start < streams.length; start += WEBSOCKET_MAX_STREAMS) {
    streamBatches.push(streams.slice(start, start + WEBSOCKET_MAX_STREAMS));
  }
  if (streamBatches.length === 0) {
    updateConnectionStatus("Offline");
    return;
  }
  if (!("WebSocket" in window)) {
    updateConnectionStatus("Offline");
    elements.liveSummary.textContent =
      "WebSocket is unavailable; using periodic REST refresh instead";
    return;
  }
  socketStates = streamBatches.map(() => false);
  streamBatches.forEach((_, index) => connectStreamBatch(index, generation));
}

async function scan(): Promise<void> {
  if (isScanning) return;
  isScanning = true;
  elements.refresh.disabled = true;
  elements.refresh.innerHTML = `<span class="spinner" aria-hidden="true"></span> Scanning`;
  elements.error.hidden = !storageWarning;
  if (pairs.length === 0) renderSkeleton();
  setStatus("Loading USDT market universe…");

  try {
    const universe = await fetchUsdtUniverse();
    universeCount = universe.length;
    setStatus(`Loaded ${universeCount.toLocaleString()} USDT pairs · fetching 24h ranges…`);
    const tickers = await fetch24hTickers(new Set(universe));
    const ranked = volatilityRank(tickers);
    const limit = Math.max(
      1,
      Math.min(100, Math.floor(Number(elements.pairLimit.value) || DEFAULT_PAIR_LIMIT)),
    );
    elements.pairLimit.value = String(limit);
    const selected = ranked.slice(0, limit);
    const candleData = await fetchAnalysisCandles(
      selected.map((ticker) => ticker.symbol),
      (completed, total) => setStatus(`Analyzing candles · ${completed} / ${total}`),
    );

    const requireEma = elements.ema.checked;
    const previousPairs = new Map(
      pairs.map((pair) => [pair.ticker.symbol, pair]),
    );
    pairs = selected.map((ticker) => {
      const frames: PairAnalysis["frames"] = {};
      const oneMinuteCandles =
        candleData.get(ticker.symbol)?.["1m"] ?? [];
      for (const timeframe of TIMEFRAMES) {
        const candles = candleData.get(ticker.symbol)?.[timeframe];
        if (candles) {
          frames[timeframe] = calculateFrame(
            candles,
            requireEma,
            timeframe,
            oneMinuteCandles,
            previousPairs.get(ticker.symbol)?.frames[timeframe],
          );
          const buffer = new CandleBuffer(CANDLES_TO_ANALYZE + 1);
          buffer.seed(candles);
          candleBuffers.set(bufferKey(ticker.symbol, timeframe), buffer);
        }
      }
      const oneMinuteAtr = frames["1m"]?.atrPercent ?? null;
      return {
        ticker,
        frames,
        recommendation:
          oneMinuteAtr === null
            ? null
            : recommendTimeframe(
                oneMinuteAtr,
                ATR_LOW_THRESHOLD_PERCENT,
                ATR_HIGH_THRESHOLD_PERCENT,
              ),
        volatility: volatilityFor(oneMinuteAtr),
      };
    });
    const analyzedSymbols = new Set(pairs.map((pair) => pair.ticker.symbol));
    for (const key of activeSignals.keys()) {
      if (!analyzedSymbols.has(key.slice(0, key.indexOf(":"))) ) {
        activeSignals.delete(key);
      }
    }
    addNewSignals(pairs);
    for (const pair of pairs) {
      for (const timeframe of TIMEFRAMES) {
        evaluateSignalState(pair, timeframe, false);
      }
    }
    elements.updated.textContent = new Date().toLocaleTimeString();
    setStatus(`Scan complete · ${new Date().toLocaleTimeString()}`);
    renderAll();
    renderLiveSignals();
    startWebSockets(selected.map((ticker) => ticker.symbol));
    if (storageWarning) {
      elements.error.textContent = storageWarning;
      elements.error.hidden = false;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.error.textContent = storageWarning
      ? `Unable to complete scan: ${message}. ${storageWarning}`
      : `Unable to complete scan: ${message}`;
    elements.error.hidden = false;
    setStatus("Scan failed · refresh to retry");
    if (pairs.length === 0) {
      elements.pairsBody.innerHTML = `<tr><td colspan="10" class="empty-cell">Market data could not be loaded. Check your connection and refresh.</td></tr>`;
    }
  } finally {
    isScanning = false;
    elements.refresh.disabled = false;
    elements.refresh.innerHTML = `<span aria-hidden="true">↻</span> Refresh scan`;
  }
}

setMarketStatusHandler(setStatus);
elements.refresh.addEventListener("click", () => void scan());
elements.search.addEventListener("input", renderAll);
elements.sort.addEventListener("change", renderAll);
elements.filter.addEventListener("change", renderAll);
elements.payout.addEventListener("input", renderAll);
elements.pairLimit.addEventListener("change", () => void scan());
elements.ema.addEventListener("change", () => {
  for (const [key, active] of activeSignals) {
    if (active.state === "DEVELOPING") {
      const record = currentSignalRecord(active.id);
      if (record) storeSignal({ ...record, state: "CANCELLED" });
    }
    activeSignals.delete(key);
  }
  void scan();
});
elements.earlyWarning.addEventListener("change", () => void scan());
elements.notifications.addEventListener("change", async () => {
  if (!elements.notifications.checked) return;
  if (!("Notification" in window)) {
    elements.liveSummary.textContent = "Browser notifications are not supported here";
    elements.notifications.checked = false;
    return;
  }
  try {
    notificationPermission = await Notification.requestPermission();
  } catch (error) {
    elements.notifications.checked = false;
    elements.liveSummary.textContent =
      error instanceof Error
        ? `Could not request notification permission: ${error.message}`
        : "Could not request notification permission";
    return;
  }
  if (notificationPermission !== "granted") {
    elements.notifications.checked = false;
    elements.liveSummary.textContent =
      "Browser notifications are off until permission is granted";
  } else {
    elements.liveSummary.textContent = "Browser notifications enabled";
  }
});
elements.theme.addEventListener("click", () => {
  const light = document.documentElement.classList.toggle("light-theme");
  elements.theme.setAttribute(
    "aria-label",
    light ? "Switch to dark theme" : "Switch to light theme",
  );
});

renderFeed();
renderAll();
void scan();
window.setInterval(() => {
  if (socketStates.length === 0 || socketStates.every((connected) => !connected)) {
    void scan();
  }
}, REST_FALLBACK_INTERVAL_MS);
window.setInterval(() => void scan(), REFRESH_INTERVAL_MS);
window.setInterval(() => {
  renderLiveSignals();
}, 1000);
