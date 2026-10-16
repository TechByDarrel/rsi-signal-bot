import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUsdtUniverse } from "../src/market";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Binance request errors", () => {
  it("explains network failures and likely network or regional blocking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(fetchUsdtUniverse()).rejects.toThrow(
      "Could not reach Binance market data (network error: Failed to fetch). Your network or region may block this.",
    );
  });

  it("includes the HTTP status for unsuccessful Binance responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", { status: 403, statusText: "Forbidden" }),
      ),
    );

    await expect(fetchUsdtUniverse()).rejects.toThrow(
      "Could not reach Binance market data (HTTP 403 Forbidden). Your network or region may block this.",
    );
  });
});
