"use client";

import { useState } from "react";
import { createPublicClient, http } from "viem";
import { useAccount, useConfig } from "wagmi";
import { SwapKit } from "@circle-fin/swap-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { useTxStore } from "@/lib/txStore";
import { describeSwapError } from "@/lib/utils";
import { getInjectedWalletProvider } from "@/lib/walletProvider";
import { ARC_TESTNET_RPC } from "@/lib/constants";
import { executeAchSwap, isUserRejected } from "@/lib/achSwap";
import type { Token } from "@/lib/tokenList";
import type { SwapQuoteSource } from "@/hooks/useSwapQuote";

export type SwapStatus = "appkit" | "dex-router" | "approving";

export type SwapArgs = {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;
  slippage?: number;
  deadlineMinutes?: number;
  /** When the live quote already came from the DEX Router, skip a doomed AppKit attempt. */
  preferredRoute?: SwapQuoteSource | null;
  onStatus?: (status: SwapStatus) => void;
};

async function swapViaAppKit(args: {
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountIn: string;
  slippage: number;
}): Promise<string> {
  const kitKey = process.env.NEXT_PUBLIC_ARC_KIT_KEY;
  if (!kitKey || kitKey === "your_kit_key_here") {
    throw new Error("Arc AppKit key not configured. Add NEXT_PUBLIC_ARC_KIT_KEY to .env.local");
  }

  // Discover the wallet via EIP-6963 rather than window.ethereum directly —
  // avoids silently picking the wrong extension when multiple wallets are installed.
  const provider = await getInjectedWalletProvider();
  await provider.request({ method: "eth_requestAccounts", params: undefined });

  // Pin the RPC transport instead of the SDK's default endpoint, which
  // docs.arc.io/app-kit/tutorials/adapter-setups notes "may be rate-limited
  // or unreliable" — confirmed firsthand while debugging this integration.
  const adapter = await createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }) => createPublicClient({ chain, transport: http(ARC_TESTNET_RPC) }),
  });
  const kit = new SwapKit();

  const result = await kit.swap({
    from: { adapter, chain: "Arc_Testnet" },
    tokenIn: args.tokenInSymbol,
    tokenOut: args.tokenOutSymbol,
    amountIn: args.amountIn,
    config: {
      kitKey: kitKey as string,
      slippageBps: Math.floor(args.slippage * 100),
      allowanceStrategy: "approve", // Arc Testnet needs approve (no ecrecover)
    },
  });

  if (!result.txHash) throw new Error("AppKit swap returned no transaction hash");
  return result.txHash;
}

export function useSwap() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [txHash, setTxHash] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<SwapQuoteSource | null>(null);
  const { addTransaction } = useTxStore();
  const { address } = useAccount();
  const config = useConfig();

  const swap = async ({
    tokenIn,
    tokenOut,
    amountIn,
    slippage = 0.5,
    preferredRoute,
    onStatus,
  }: SwapArgs): Promise<string | undefined> => {
    setError(null);
    setIsLoading(true);
    setIsSuccess(false);
    setRoute(null);

    const tokenInSymbol = tokenIn.appKitSymbol ?? tokenIn.symbol;
    const tokenOutSymbol = tokenOut.appKitSymbol ?? tokenOut.symbol;

    try {
      let hash: string;
      let source: SwapQuoteSource = "appkit";

      const runDexRouter = async () => {
        if (!address) throw new Error("Wallet not connected");
        source = "dex-router";
        onStatus?.("dex-router");
        return executeAchSwap({
          config,
          account: address,
          tokenIn,
          tokenOut,
          amountInHuman: amountIn,
          slippagePercent: slippage,
          onStatus: (status) => {
            if (status === "approving") onStatus?.("approving");
            if (status === "swapping") onStatus?.("dex-router");
          },
        });
      };

      if (preferredRoute === "dex-router") {
        hash = await runDexRouter();
      } else {
        try {
          onStatus?.("appkit");
          hash = await swapViaAppKit({
            tokenInSymbol,
            tokenOutSymbol,
            amountIn,
            slippage,
          });
        } catch (appKitErr: unknown) {
          if (isUserRejected(appKitErr)) throw appKitErr;
          console.warn("[useSwap] AppKit failed, falling back to DEX Router:", appKitErr);
          hash = await runDexRouter();
        }
      }

      setTxHash(hash);
      setIsSuccess(true);
      setRoute(source);

      addTransaction({
        type: "swap",
        amount: amountIn,
        token: tokenIn.symbol,
        status: "success",
        txHash: hash,
      });

      return hash;
    } catch (err: unknown) {
      console.error("[useSwap] swap failed:", err);
      const message = describeSwapError(err);
      setError(message);
      addTransaction({
        type: "swap",
        amount: amountIn,
        token: tokenIn.symbol,
        status: "failed",
      });
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return { swap, isLoading, isSuccess, txHash, error, route };
}
