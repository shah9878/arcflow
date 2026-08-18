"use client";

import { useState, useEffect, useRef } from "react";
import { parseUnits, formatUnits } from "viem";
import { getTokenBySymbol } from "@/lib/tokenList";
import { quoteDexRouter } from "@/lib/achSwap";
import { HttpError, isAbortError, mergeAbortSignals, withRetry } from "@/lib/retry";

export type SwapQuoteSource = "appkit" | "dex-router";

interface SwapQuoteResult {
  amountOut: string;
  priceImpact: number;
  minimumReceived: string;
  gasFee: string;
  loading: boolean;
  error: string | null;
  source: SwapQuoteSource | null;
}

export function swapRouteLabel(source: SwapQuoteSource | null | undefined): string {
  return source === "dex-router" ? "DEX Router" : "Arc AppKit";
}

/**
 * Maps our /api/swap/quote proxy's HTTP status back to an actionable message.
 * The proxy runs server-side, so a failure here is either "no liquidity route"
 * (expected on Arc Testnet — see docs.arc.io/app-kit/quickstarts) or a real
 * outage of Circle's service, never a browser-side network/extension block.
 */
function describeQuoteError(status: number, apiMessage?: string): string {
  if (status === 404 || apiMessage?.toLowerCase().includes("no route")) {
    return "No swap route found for this pair on Arc Testnet right now — testnet liquidity can be thin or imbalanced. Try a different pair, a smaller amount, or try again shortly.";
  }
  if (status === 429) {
    return "Arc AppKit is rate-limiting quote requests. Please wait a moment and try again.";
  }
  if (status === 502) {
    return "Arc AppKit Swap Service is currently unavailable. Please try again later.";
  }
  return apiMessage ?? `Quote request failed (HTTP ${status})`;
}

function toQuoteResult(
  amountOut: string,
  minimumReceived: string,
  source: SwapQuoteSource
): SwapQuoteResult {
  const amountOutNum = parseFloat(amountOut);
  const minReceivedNum = parseFloat(minimumReceived);
  const priceImpact =
    amountOutNum > 0 ? Math.abs(((amountOutNum - minReceivedNum) / amountOutNum) * 100) : 0;
  return {
    amountOut,
    priceImpact: parseFloat(priceImpact.toFixed(4)),
    minimumReceived,
    gasFee: "~0.001 USDC",
    loading: false,
    error: null,
    source,
  };
}

async function fetchAppKitQuote(
  tokenInSymbol: string,
  tokenOutSymbol: string,
  amountInBaseUnits: string,
  tokenOutDecimals: number,
  fromAddress: string | undefined,
  signal?: AbortSignal
): Promise<SwapQuoteResult> {
  const params = new URLSearchParams({
    tokenIn: tokenInSymbol,
    tokenOut: tokenOutSymbol,
    amount: amountInBaseUnits,
  });
  if (fromAddress) params.set("fromAddress", fromAddress);

  const res = await fetch(`/api/swap/quote?${params.toString()}`, {
    cache: "no-store",
    signal: mergeAbortSignals(signal, AbortSignal.timeout(10_000)),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new HttpError(describeQuoteError(res.status, body?.error), res.status);
  }

  const estimatedAmount = BigInt(body.quote.estimatedAmount);
  const minAmount = BigInt(body.quote.minAmount);
  return toQuoteResult(
    parseFloat(formatUnits(estimatedAmount, tokenOutDecimals)).toFixed(4),
    parseFloat(formatUnits(minAmount, tokenOutDecimals)).toFixed(4),
    "appkit"
  );
}

/**
 * Quotes AppKit and the DEX Router in parallel. AppKit wins when both
 * succeed; otherwise the first healthy fallback is used.
 */
export function useSwapQuote(
  tokenInSymbol: string | undefined,
  tokenOutSymbol: string | undefined,
  amountIn: string,
  slippage: number = 0.5,
  fromAddress?: string
): SwapQuoteResult {
  const [result, setResult] = useState<SwapQuoteResult>({
    amountOut: "",
    priceImpact: 0,
    minimumReceived: "",
    gasFee: "",
    loading: false,
    error: null,
    source: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const empty: SwapQuoteResult = {
      amountOut: "",
      priceImpact: 0,
      minimumReceived: "",
      gasFee: "",
      loading: false,
      error: null,
      source: null,
    };

    if (!tokenInSymbol || !tokenOutSymbol || !amountIn || parseFloat(amountIn) === 0) {
      setResult(empty);
      return;
    }

    if (tokenInSymbol === tokenOutSymbol) {
      setResult(empty);
      return;
    }

    const amount = parseFloat(amountIn);
    if (isNaN(amount) || amount <= 0) {
      setResult(empty);
      return;
    }

    const tokenIn = getTokenBySymbol(tokenInSymbol);
    const tokenOut = getTokenBySymbol(tokenOutSymbol);
    if (!tokenIn || !tokenOut) {
      setResult(empty);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setResult((prev) => ({ ...prev, loading: true, error: null }));

    const fetchEstimate = async () => {
      const amountInBaseUnits = parseUnits(amountIn, tokenIn.decimals).toString();

      const [appKitResult, dexResult] = await Promise.allSettled([
        withRetry(
          () =>
            fetchAppKitQuote(
              tokenIn.symbol,
              tokenOut.symbol,
              amountInBaseUnits,
              tokenOut.decimals,
              fromAddress,
              controller.signal
            ),
          { retries: 1, signal: controller.signal }
        ),
        quoteDexRouter(tokenIn, tokenOut, amountIn, slippage, controller.signal),
      ]);

      if (controller.signal.aborted) return;

      if (appKitResult.status === "fulfilled") {
        setResult(appKitResult.value);
        return;
      }

      if (dexResult.status === "fulfilled") {
        const fallback = dexResult.value;
        setResult(
          toQuoteResult(fallback.amountOutFormatted, fallback.minReceivedFormatted, "dex-router")
        );
        return;
      }

      const appKitError = appKitResult.reason;
      const dexError = dexResult.reason;
      if (isAbortError(appKitError) || isAbortError(dexError)) return;

      const message =
        (appKitError instanceof Error && appKitError.message) ||
        (dexError instanceof Error && dexError.message) ||
        "No swap route found for this pair";

      setResult({
        amountOut: "",
        priceImpact: 0,
        minimumReceived: "",
        gasFee: "",
        loading: false,
        error: message,
        source: null,
      });
    };

    const debounceTimer = setTimeout(() => {
      if (controller.signal.aborted) return;
      fetchEstimate().catch((err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setResult({
          amountOut: "",
          priceImpact: 0,
          minimumReceived: "",
          gasFee: "",
          loading: false,
          error: err instanceof Error ? err.message : "Estimate failed",
          source: null,
        });
      });
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(debounceTimer);
    };
  }, [tokenInSymbol, tokenOutSymbol, amountIn, slippage, fromAddress]);

  return result;
}
