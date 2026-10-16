import {
  ATR_HIGH_THRESHOLD_PERCENT,
  ATR_LOW_THRESHOLD_PERCENT,
  ATR_PERIOD,
  DEFAULT_PAIR_LIMIT,
  DEFAULT_PAYOUT_PERCENT,
  EMA_PERIOD,
  REFRESH_INTERVAL_MS,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  RSI_PERIOD,
  SIGNAL_STORAGE_KEY,
  SIGNAL_STORAGE_LIMIT,
  TIMEFRAMES,
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
import "./style.css";

interface TimeframeAnalysis {
  candles: Candle[];
  rsi: number | null;
  atrPercent: number | null;
  ema: number | null;
  direction: SignalDirection | null;
  backtest: ReturnType<typeof backtestSignals>;
}

interface PairAnalysis {
  ticker: Ticker24h;
  recommendation: Timeframe;
  volatility: "Low" | "Medium" | "High";
  frames: Partial<Record<Timeframe, TimeframeAnalysis>>;
}

interface SignalRecord {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  rsi: number;
  atrPercent: number;
  entryPrice: number;
  generatedAt: string;
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
        <button id="theme-toggle" class="icon-button" type="button" aria-label="Switch to light theme" title="Toggle light and dark theme">☼</button>
        <button id="refresh-button" class="button button-primary" type="button"><span aria-hidden="true">↻</span> Refresh scan</button>
      </div>
    </header>

    <main>
      <section class="disclaimer-banner" role="note">
        <span class="banner-icon" aria-hidden="true">!</span>
        <div><strong>Analysis only — no trades are placed.</strong><span>Binary options carry high risk and may be restricted in your country. This dashboard does not connect to brokers.</span></div>
      </section>

      <section class="intro-row">
        <div><p class="eyebrow">BINANCE SPOT · USDT MARKETS</p><h1>Market dashboard</h1><p class="intro-copy">Volatility-ranked pairs, technical signals and historical context — all in your browser.</p></div>
        <div class="update-card"><span class="eyebrow">LAST UPDATED</span><strong id="last-updated">Waiting for first scan</strong><span id="scan-status" role="status" aria-live="polite">Ready to scan public market data</span></div>
      </section>

      <section class="rule-panel" aria-labelledby="rule-title">
        <div class="rule-icon" aria-hidden="true">↗</div>
        <div><h2 id="rule-title">Timeframe recommendation rule</h2><p>Based on 1m ATR as % of last close: <b>High</b> volatility (&gt; ${ATR_HIGH_THRESHOLD_PERCENT}%) → 1m · <b>Medium</b> (${ATR_LOW_THRESHOLD_PERCENT}%–${ATR_HIGH_THRESHOLD_PERCENT}%) → 5m · <b>Low</b> (&lt; ${ATR_LOW_THRESHOLD_PERCENT}%) → 15m. ATR is a measure of recent range, not a forecast.</p></div>
        <span class="rule-tag">CONFIGURABLE IN SRC/CONFIG.TS</span>
      </section>

      <section class="metrics-grid" aria-label="Market overview">
        <article class="metric-card"><span class="metric-label">PAIRS IN UNIVERSE</span><strong id="universe-count">—</strong><span>USDT · TRADING</span></article>
        <article class="metric-card"><span class="metric-label">PAIRS ANALYZED</span><strong id="analyzed-count">—</strong><span>Ranked by 24h range</span></article>
        <article class="metric-card"><span class="metric-label">ACTIVE SIGNALS</span><strong id="signal-count">—</strong><span>RSI rule on closed candles</span></article>
        <article class="metric-card"><span class="metric-label">BREAK-EVEN WIN RATE</span><strong id="break-even-value">—</strong><span id="payout-summary">At selected payout</span></article>
      </section>

      <section class="controls-panel" aria-label="Dashboard controls">
        <label class="search-control"><span class="sr-only">Search trading pairs</span><span aria-hidden="true">⌕</span><input id="search-input" type="search" placeholder="Search pair…" autocomplete="off" aria-label="Search trading pairs"></label>
        <label class="select-control">Sort by<select id="sort-select" aria-label="Sort pairs"><option value="volatility">Volatility</option><option value="rsi">RSI</option><option value="win-rate">Historical win rate</option></select></label>
        <label class="select-control">Volatility<select id="volatility-filter" aria-label="Filter by volatility"><option value="all">All levels</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select></label>
        <label class="number-control">Payout %<input id="payout-input" type="number" min="0" max="1000" step="1" value="${DEFAULT_PAYOUT_PERCENT}" aria-label="Binary payout percentage"></label>
        <label class="number-control">Pairs to analyze<input id="pair-limit" type="number" min="1" max="100" step="1" value="${DEFAULT_PAIR_LIMIT}" aria-label="Number of top pairs to analyze"></label>
        <label class="toggle-control"><input id="ema-toggle" type="checkbox" checked aria-label="Require EMA 50 trend alignment"><span class="toggle-track"></span><span>EMA(50) filter</span><span class="help-tip" title="CALL only above EMA(50); PUT only below EMA(50). Applies to live signals and backtests." aria-label="EMA(50) trend filter: CALL only above EMA, PUT only below EMA">i</span></label>
      </section>

      <div id="error-state" class="error-state" role="alert" hidden></div>
      <section class="data-panel" aria-labelledby="pairs-title">
        <div class="section-heading"><div><p class="eyebrow">LIVE SCAN</p><h2 id="pairs-title">Top volatile pairs</h2></div><span id="table-summary" class="muted">Waiting for data</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">PAIR</th><th scope="col">PRICE</th><th scope="col">24H RANGE</th><th scope="col">ATR % <span class="th-sub">1m · 5m · 15m · 1h</span></th><th scope="col">RECOMMENDED</th><th scope="col">RSI</th><th scope="col">SIGNAL</th><th scope="col">HISTORICAL WIN RATE</th></tr></thead>
            <tbody id="pairs-body"><tr><td colspan="8"><div class="skeleton-row"><i></i><i></i><i></i><i></i><i></i></div></td></tr></tbody>
          </table>
        </div>
        <div class="table-footnote">The win rate shown is for the recommended timeframe. Sample size is shown beside every rate; fewer than 30 signals is marked insufficient.</div>
      </section>

      <div class="lower-grid">
        <section class="data-panel signal-panel" aria-labelledby="signals-title">
          <div class="section-heading"><div><p class="eyebrow">NEWEST FIRST · SAVED IN THIS BROWSER</p><h2 id="signals-title">Recent signal feed</h2></div><span id="feed-count" class="muted">0 saved</span></div>
          <div id="signal-feed" class="signal-feed"><div class="empty-state">Signals will appear here when the RSI rules are met.</div></div>
        </section>
        <section class="data-panel backtest-panel" aria-labelledby="backtest-title">
          <div class="section-heading"><div><p class="eyebrow">500 CLOSED CANDLES · ONE-CANDLE OUTCOME</p><h2 id="backtest-title">Historical edge</h2></div><span class="muted">by pair / timeframe</span></div>
          <div class="warning-note"><span aria-hidden="true">⚠</span><p><strong>Historical results do not predict future results.</strong> Backtests are simplified and exclude fees, slippage, and execution.</p></div>
          <div class="table-wrap compact-table"><table><thead><tr><th scope="col">PAIR</th><th scope="col">TIMEFRAME</th><th scope="col">WIN RATE</th><th scope="col">SAMPLE</th><th scope="col">VS BREAK-EVEN</th></tr></thead><tbody id="backtest-body"><tr><td colspan="5" class="empty-cell">Backtest results appear after scanning.</td></tr></tbody></table></div>
        </section>
      </div>
      <footer><span>Data: Binance public spot market API</span><span>Analysis only · No broker connections · No trades placed</span></footer>
    </main>
  </div>`;

const elements = {
  status: document.querySelector<HTMLElement>("#scan-status")!,
  error: document.querySelector<HTMLElement>("#error-state")!,
  updated: document.querySelector<HTMLElement>("#last-updated")!,
  universe: document.querySelector<HTMLElement>("#universe-count")!,
  analyzed: document.querySelector<HTMLElement>("#analyzed-count")!,
  signalCount: document.querySelector<HTMLElement>("#signal-count")!,
  breakEven: document.querySelector<HTMLElement>("#break-even-value")!,
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
  pairLimit: document.querySelector<HTMLInputElement>("#pair-limit")!,
  ema: document.querySelector<HTMLInputElement>("#ema-toggle")!,
  theme: document.querySelector<HTMLButtonElement>("#theme-toggle")!,
};

let pairs: PairAnalysis[] = [];
let universeCount = 0;
let isScanning = false;
let storageWarning: string | null = null;
let recentSignals = loadSignals();

function loadSignals(): SignalRecord[] {
  try {
    const stored = localStorage.getItem(SIGNAL_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSignalRecord).slice(0, SIGNAL_STORAGE_LIMIT);
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
    typeof record.rsi === "number" &&
    Number.isFinite(record.rsi) &&
    typeof record.atrPercent === "number" &&
    Number.isFinite(record.atrPercent) &&
    typeof record.entryPrice === "number" &&
    Number.isFinite(record.entryPrice) &&
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

function calculateFrame(candles: Candle[], requireEma: boolean): TimeframeAnalysis {
  const closed = candles.slice(0, -1);
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

  return {
    candles: closed,
    rsi: frameRsi,
    atrPercent:
      frameAtr !== null && lastClose !== null && lastClose > 0
        ? (frameAtr / lastClose) * 100
        : null,
    ema: frameEma,
    direction,
    backtest: backtestSignals(highs, lows, closes, requireEma),
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
      if (currentIds.has(id)) continue;
      candidates.push({
        id,
        symbol: pair.ticker.symbol,
        timeframe,
        direction: frame.direction,
        rsi: frame.rsi,
        atrPercent: frame.atrPercent,
        entryPrice: candle.close,
        generatedAt: new Date().toISOString(),
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
  if (atrPercent === null) return "Medium";
  if (atrPercent > ATR_HIGH_THRESHOLD_PERCENT) return "High";
  if (atrPercent < ATR_LOW_THRESHOLD_PERCENT) return "Low";
  return "Medium";
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
        (a.frames[a.recommendation]?.rsi ?? 101) -
        (b.frames[b.recommendation]?.rsi ?? 101),
    );
  } else if (elements.sort.value === "win-rate") {
    visible.sort(
      (a, b) =>
        (b.frames[b.recommendation]?.backtest.winRate ?? -1) -
        (a.frames[a.recommendation]?.backtest.winRate ?? -1),
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
      ? `<tr><td colspan="8" class="empty-cell">No pairs match these filters.</td></tr>`
      : visible
          .map((pair) => {
            const recommended = pair.frames[pair.recommendation];
            const result = recommended?.backtest;
            const signal = recommended?.direction;
            const rsiValue = recommended?.rsi;
            const beats = result?.winRate !== null &&
              result?.winRate !== undefined &&
              result.winRate >= breakEven;
            const atrCells = TIMEFRAMES.map((timeframe) => {
              const value = pair.frames[timeframe]?.atrPercent;
              return `<span class="atr-value">${value === null || value === undefined ? "—" : `${value.toFixed(3)}%`}</span>`;
            }).join("");

            return `<tr>
              <td><span class="pair-cell"><strong>${escapeHtml(pair.ticker.symbol.replace(/USDT$/, ""))}</strong><small>USDT</small></span></td>
              <td class="price-cell">${formatPrice(pair.ticker.last)}</td>
              <td><strong>${pair.ticker.rangePercent.toFixed(2)}%</strong><span class="volatility-badge ${pair.volatility.toLowerCase()}">${pair.volatility}</span></td>
              <td><div class="atr-grid">${atrCells}</div></td>
              <td><span class="timeframe-chip">${pair.recommendation}</span></td>
              <td>${rsiValue === null || rsiValue === undefined ? "—" : `<span class="rsi-value ${rsiValue <= RSI_OVERSOLD ? "call-text" : rsiValue >= RSI_OVERBOUGHT ? "put-text" : ""}">${rsiValue.toFixed(1)}</span>`}</td>
              <td>${signal ? `<span class="signal-pill ${signal.toLowerCase()}">${signal}</span>` : `<span class="neutral-signal">—</span>`}</td>
              <td>${result?.winRate === null || result?.winRate === undefined ? `<span class="muted">—</span><span class="sample-count">0 signals</span><span class="sample-warning">Insufficient sample</span>` : `<span class="rate-value ${beats ? "positive" : "negative"}">${result.winRate.toFixed(1)}%</span><span class="sample-count">${result.wins} / ${result.samples} wins</span>${result.samples < 30 ? `<span class="sample-warning">Insufficient sample</span>` : ""}`}</td>
            </tr>`;
          })
          .join("");
  elements.summary.textContent = `${visible.length} of ${pairs.length} analyzed pairs`;
  elements.analyzed.textContent = String(pairs.length);
  elements.signalCount.textContent = String(
    pairs.reduce(
      (count, pair) =>
        count +
        TIMEFRAMES.filter((timeframe) => Boolean(pair.frames[timeframe]?.direction))
          .length,
      0,
    ),
  );
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
            return `<article class="feed-card">
              <span class="feed-direction ${signal.direction.toLowerCase()}">${signal.direction}</span>
              <div class="feed-main"><strong>${escapeHtml(signal.symbol.replace(/USDT$/, ""))}<small>/ USDT</small></strong><span>${signal.timeframe} suggested candle timeframe (not a guaranteed expiry) · RSI ${signal.rsi.toFixed(1)}</span><span class="feed-history">${historicalText}</span></div>
              <div class="feed-meta"><strong>${formatPrice(signal.entryPrice)}</strong><span>${new Date(signal.generatedAt).toLocaleString()}</span></div>
              <span class="feed-atr">ATR ${signal.atrPercent.toFixed(3)}%</span>
            </article>`;
          })
          .join("");
}

function renderBacktest(): void {
  const visible = getVisiblePairs();
  const breakEven = breakEvenWinRate(getPayout());
  elements.backtestBody.innerHTML =
    visible.length === 0
      ? `<tr><td colspan="5" class="empty-cell">No pairs match these filters.</td></tr>`
      : visible
          .flatMap((pair) =>
            TIMEFRAMES.map((timeframe) => {
              const result = pair.frames[timeframe]?.backtest;
              if (!result || result.samples === 0 || result.winRate === null) {
                return `<tr><td>${escapeHtml(pair.ticker.symbol)}</td><td>${timeframe}</td><td>—<span class="sample-warning">Insufficient sample</span></td><td>0</td><td class="muted">No signals</td></tr>`;
              }
              const above = result.winRate >= breakEven;
              return `<tr><td>${escapeHtml(pair.ticker.symbol)}</td><td>${timeframe}</td><td><strong class="${above ? "call-text" : "put-text"}">${result.winRate.toFixed(1)}%</strong></td><td>${result.samples}${result.samples < 30 ? `<span class="sample-warning">Insufficient sample</span>` : ""}</td><td><span class="edge-badge ${above ? "above" : "below"}">${above ? "Above" : "Below"} ${breakEven.toFixed(1)}%</span></td></tr>`;
            }),
          )
          .join("");
}

function renderAll(): void {
  elements.universe.textContent = universeCount
    ? universeCount.toLocaleString()
    : "—";
  elements.breakEven.textContent = `${breakEvenWinRate(getPayout()).toFixed(1)}%`;
  elements.payoutSummary.textContent = `At ${getPayout()}% payout`;
  renderPairs();
  renderFeed();
  renderBacktest();
}

function setStatus(message: string): void {
  elements.status.textContent = message;
}

function renderSkeleton(): void {
  elements.pairsBody.innerHTML = Array.from(
    { length: 8 },
    () => `<tr><td colspan="8"><div class="skeleton-row"><i></i><i></i><i></i><i></i><i></i></div></td></tr>`,
  ).join("");
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
    pairs = selected.map((ticker) => {
      const frames: PairAnalysis["frames"] = {};
      for (const timeframe of TIMEFRAMES) {
        const candles = candleData.get(ticker.symbol)?.[timeframe];
        if (candles) frames[timeframe] = calculateFrame(candles, requireEma);
      }
      const oneMinuteAtr = frames["1m"]?.atrPercent ?? null;
      return {
        ticker,
        frames,
        recommendation: recommendTimeframe(
          oneMinuteAtr ?? ATR_LOW_THRESHOLD_PERCENT,
          ATR_LOW_THRESHOLD_PERCENT,
          ATR_HIGH_THRESHOLD_PERCENT,
        ),
        volatility: volatilityFor(oneMinuteAtr),
      };
    });
    addNewSignals(pairs);
    elements.updated.textContent = new Date().toLocaleTimeString();
    setStatus(`Scan complete · ${new Date().toLocaleTimeString()}`);
    renderAll();
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
      elements.pairsBody.innerHTML = `<tr><td colspan="8" class="empty-cell">Market data could not be loaded. Check your connection and refresh.</td></tr>`;
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
elements.ema.addEventListener("change", () => void scan());
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
window.setInterval(() => void scan(), REFRESH_INTERVAL_MS);
