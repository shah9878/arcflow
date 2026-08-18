import { NextRequest, NextResponse } from "next/server";
import { getTokenBySymbol } from "@/lib/tokenList";
import { HttpError, withRetry } from "@/lib/retry";

const STABLECOIN_SERVICE_BASE_URL = "https://api.circle.com";
const QUOTE_PATH = "/v1/stablecoinKits/quote";
// Used only when no wallet is connected yet — the quote endpoint prices a
// pair/amount regardless of who's asking, so any well-formed address works.
const PLACEHOLDER_FROM_ADDRESS = "0x000000000000000000000000000000000000dEaD";

/**
 * Proxies Circle's stablecoin-kit quote endpoint server-side. This runs
 * read-only pricing (no signing, no fund movement) so it's safe to move off
 * the browser — unlike swap execution, which needs the user's wallet adapter
 * and can't be proxied the same way. Routing it through our own origin means
 * browser extensions/firewalls that block third-party fetches to api.circle.com
 * no longer break quotes.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenInSymbol = searchParams.get("tokenIn");
  const tokenOutSymbol = searchParams.get("tokenOut");
  const amount = searchParams.get("amount");
  const fromAddress = searchParams.get("fromAddress") || PLACEHOLDER_FROM_ADDRESS;

  const tokenIn = tokenInSymbol ? getTokenBySymbol(tokenInSymbol) : undefined;
  const tokenOut = tokenOutSymbol ? getTokenBySymbol(tokenOutSymbol) : undefined;

  if (!tokenIn || !tokenOut || !amount) {
    return NextResponse.json(
      { error: "tokenIn, tokenOut, and amount (base units) are required" },
      { status: 400 }
    );
  }

  const url = new URL(QUOTE_PATH, STABLECOIN_SERVICE_BASE_URL);
  url.searchParams.set("tokenInAddress", tokenIn.address);
  url.searchParams.set("tokenInChain", "Arc_Testnet");
  url.searchParams.set("tokenOutAddress", tokenOut.address);
  url.searchParams.set("fromAddress", fromAddress);
  url.searchParams.set("amount", amount);

  try {
    const upstream = await withRetry(
      async () => {
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new HttpError(`AppKit quote HTTP ${res.status}`, res.status);
        }
        return res;
      },
      { retries: 2, baseDelayMs: 300 }
    );
    const body = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return NextResponse.json(
        { error: body?.message ?? `Upstream returned HTTP ${upstream.status}`, code: body?.code },
        { status: upstream.status }
      );
    }

    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      { error: "Could not reach Arc AppKit quote service" },
      { status: 502 }
    );
  }
}
