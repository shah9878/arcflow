import { NextRequest, NextResponse } from "next/server";
import { parseUnits } from "viem";
import { getTokenBySymbol } from "@/lib/tokenList";
import { DEX_ROUTER_QUOTE_API, slippageToBps, toAchSwapToken } from "@/lib/achSwap";
import { HttpError, withRetry } from "@/lib/retry";

/**
 * Proxies the DEX Router quote API. Amounts stay in adapter units
 * (native USDC = address(0), 18 decimals).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenInSymbol = searchParams.get("tokenIn");
  const tokenOutSymbol = searchParams.get("tokenOut");
  const amount = searchParams.get("amount");
  const slippage = parseFloat(searchParams.get("slippage") || "0.5");

  const tokenIn = tokenInSymbol ? getTokenBySymbol(tokenInSymbol) : undefined;
  const tokenOut = tokenOutSymbol ? getTokenBySymbol(tokenOutSymbol) : undefined;

  if (!tokenIn || !tokenOut || !amount) {
    return NextResponse.json(
      { error: "tokenIn, tokenOut, and amount are required" },
      { status: 400 }
    );
  }

  const inToken = toAchSwapToken(tokenIn);
  const outToken = toAchSwapToken(tokenOut);
  const amountIn = parseUnits(amount, inToken.decimals);
  const slippageBps = slippageToBps(Number.isFinite(slippage) ? slippage : 0.5);

  const url = new URL("/quote", DEX_ROUTER_QUOTE_API);
  url.searchParams.set("tokenIn", inToken.address);
  url.searchParams.set("tokenOut", outToken.address);
  url.searchParams.set("amountIn", amountIn.toString());
  url.searchParams.set("slippageBps", String(slippageBps));

  try {
    const upstream = await withRetry(
      async () => {
        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429 || res.status >= 500) {
          throw new HttpError(`DEX Router quote HTTP ${res.status}`, res.status);
        }
        return res;
      },
      { retries: 2, baseDelayMs: 300 }
    );

    const body = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: body?.error ?? body?.message ?? "No DEX Router route for this pair" },
        { status: upstream.status === 404 ? 404 : upstream.status }
      );
    }

    return NextResponse.json({
      expectedOut: String(body.expectedOut),
      minOut: String(body.minOut),
      amountIn: String(body.amountIn ?? amountIn.toString()),
      routeData: body.routeData,
      source: "dex-router",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not reach DEX Router quote service";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
