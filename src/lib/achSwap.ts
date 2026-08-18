import {
  createPublicClient,
  encodeFunctionData,
  decodeFunctionResult,
  http,
  parseUnits,
  formatUnits,
  zeroAddress,
} from "viem";
import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
} from "wagmi/actions";
import type { Config } from "wagmi";
import { ARC_TESTNET_RPC } from "@/lib/constants";
import { ACHSWAP_ADAPTER_ADDRESS, ARC_USDC_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import type { Token } from "@/lib/tokenList";
import { HttpError, mergeAbortSignals, withRetry } from "@/lib/retry";

export { ACHSWAP_ADAPTER_ADDRESS };

export const DEX_ROUTER_QUOTE_API = "https://swap-api.achswap.app";

/**
 * On-chain DEX router used as a fallback when Circle AppKit is unavailable.
 * Native USDC is address(0) at 18 decimals (not the 6-dec ERC-20 at 0x3600…).
 */

export const ACHSWAP_ADAPTER_ABI = [
  {
    name: "quote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "expectedOut", type: "uint256" },
      { name: "routeData", type: "bytes" },
    ],
  },
  {
    name: "swap",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "routeData", type: "bytes" },
    ],
    outputs: [{ name: "totalOut", type: "uint256" }],
  },
  {
    name: "minOut",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "quotedOut", type: "uint256" },
      { name: "slippageBps", type: "uint16" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type AchSwapQuote = {
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  expectedOut: bigint;
  amountOutMin: bigint;
  routeData: `0x${string}`;
  isNativeIn: boolean;
  amountOutFormatted: string;
  minReceivedFormatted: string;
};

const publicClient = createPublicClient({
  transport: http(ARC_TESTNET_RPC, { timeout: 10_000, retryCount: 0 }),
});

export function isNativeUsdc(token: Token): boolean {
  return (
    token.symbol.toUpperCase() === "USDC" ||
    token.address.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase()
  );
}

/** Adapter token encoding: native USDC → address(0) / 18 decimals. */
export function toAchSwapToken(token: Token): {
  address: `0x${string}`;
  decimals: number;
  isNative: boolean;
} {
  if (isNativeUsdc(token)) {
    return { address: zeroAddress, decimals: 18, isNative: true };
  }
  return { address: token.address, decimals: token.decimals, isNative: false };
}

export function slippageToBps(slippagePercent: number): number {
  const bps = Math.round(slippagePercent * 100);
  return Math.min(10_000, Math.max(0, bps));
}

export function applySlippage(quotedOut: bigint, slippageBps: number): bigint {
  return (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

export function isUserRejected(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request") ||
    lower.includes("request rejected")
  );
}

function formatDexQuote(
  inToken: ReturnType<typeof toAchSwapToken>,
  outToken: ReturnType<typeof toAchSwapToken>,
  amountIn: bigint,
  expectedOut: bigint,
  amountOutMin: bigint,
  routeData: `0x${string}`
): AchSwapQuote {
  return {
    tokenIn: inToken.address,
    tokenOut: outToken.address,
    amountIn,
    expectedOut,
    amountOutMin,
    routeData,
    isNativeIn: inToken.isNative,
    amountOutFormatted: parseFloat(formatUnits(expectedOut, outToken.decimals)).toFixed(4),
    minReceivedFormatted: parseFloat(formatUnits(amountOutMin, outToken.decimals)).toFixed(4),
  };
}

/** On-chain quote via eth_call. No wallet, no gas. */
export async function quoteDexRouterOnChain(
  tokenIn: Token,
  tokenOut: Token,
  amountInHuman: string,
  slippagePercent: number
): Promise<AchSwapQuote> {
  const inToken = toAchSwapToken(tokenIn);
  const outToken = toAchSwapToken(tokenOut);
  const amountIn = parseUnits(amountInHuman, inToken.decimals);
  if (amountIn <= 0n) throw new Error("Invalid swap amount");

  const data = encodeFunctionData({
    abi: ACHSWAP_ADAPTER_ABI,
    functionName: "quote",
    args: [inToken.address, outToken.address, amountIn],
  });

  const ret = await publicClient.call({
    to: ACHSWAP_ADAPTER_ADDRESS,
    data,
  });

  if (!ret.data || ret.data === "0x") {
    throw new Error("No DEX Router route for this pair");
  }

  const decoded = decodeFunctionResult({
    abi: ACHSWAP_ADAPTER_ABI,
    functionName: "quote",
    data: ret.data,
  });

  const [expectedOut, routeData] = decoded as [bigint, `0x${string}`];
  if (expectedOut <= 0n) {
    throw new Error("No DEX Router route for this pair");
  }

  const amountOutMin = applySlippage(expectedOut, slippageToBps(slippagePercent));
  return formatDexQuote(inToken, outToken, amountIn, expectedOut, amountOutMin, routeData);
}

/** REST quote (proxied through our API from the browser to avoid CORS). */
export async function quoteDexRouterHttp(
  tokenIn: Token,
  tokenOut: Token,
  amountInHuman: string,
  slippagePercent: number,
  signal?: AbortSignal
): Promise<AchSwapQuote> {
  const params = new URLSearchParams({
    tokenIn: tokenIn.symbol,
    tokenOut: tokenOut.symbol,
    amount: amountInHuman,
    slippage: String(slippagePercent),
  });

  const timeout = AbortSignal.timeout(10_000);
  const res = await fetch(`/api/swap/dex-quote?${params.toString()}`, {
    cache: "no-store",
    signal: mergeAbortSignals(signal, timeout),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new HttpError(body?.error ?? `DEX Router quote failed (HTTP ${res.status})`, res.status);
  }

  const expectedOut = BigInt(body.expectedOut);
  const amountOutMin = BigInt(body.minOut);
  if (expectedOut <= 0n) {
    throw new Error("No DEX Router route for this pair");
  }

  const inToken = toAchSwapToken(tokenIn);
  const outToken = toAchSwapToken(tokenOut);
  return formatDexQuote(
    inToken,
    outToken,
    BigInt(body.amountIn),
    expectedOut,
    amountOutMin,
    body.routeData as `0x${string}`
  );
}

/**
 * Race the on-chain adapter quote and the DEX HTTP quote. Uses the better
 * expectedOut when both succeed; falls back to whichever search returned.
 */
export async function quoteDexRouter(
  tokenIn: Token,
  tokenOut: Token,
  amountInHuman: string,
  slippagePercent: number,
  signal?: AbortSignal
): Promise<AchSwapQuote> {
  const searches = await Promise.allSettled([
    withRetry(
      () => quoteDexRouterOnChain(tokenIn, tokenOut, amountInHuman, slippagePercent),
      { retries: 2, signal }
    ),
    withRetry(
      () => quoteDexRouterHttp(tokenIn, tokenOut, amountInHuman, slippagePercent, signal),
      { retries: 2, signal }
    ),
  ]);

  const quotes = searches
    .filter((result): result is PromiseFulfilledResult<AchSwapQuote> => result.status === "fulfilled")
    .map((result) => result.value);

  if (quotes.length === 0) {
    const firstError = searches.find((result) => result.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    const reason = firstError?.reason;
    throw reason instanceof Error ? reason : new Error("No DEX Router route for this pair");
  }

  return quotes.reduce((best, quote) => (quote.expectedOut > best.expectedOut ? quote : best));
}

/** @deprecated Use quoteDexRouter — kept so existing imports keep compiling. */
export const quoteAchSwap = quoteDexRouter;

/**
 * Approve (if needed) then swap through the DEX router.
 * Same 4-step flow as the official ethers reference:
 *   1. quote  2. minOut  3. approve ERC-20  4. swap (+ msg.value for native USDC)
 */
export async function executeAchSwap(params: {
  config: Config;
  account: `0x${string}`;
  tokenIn: Token;
  tokenOut: Token;
  amountInHuman: string;
  slippagePercent: number;
  onStatus?: (status: "quoting" | "approving" | "swapping") => void;
}): Promise<`0x${string}`> {
  const { config, account, tokenIn, tokenOut, amountInHuman, slippagePercent, onStatus } =
    params;

  onStatus?.("quoting");
  const quote = await quoteDexRouter(tokenIn, tokenOut, amountInHuman, slippagePercent);

  // Prefer the on-chain minOut helper so execution matches the adapter exactly.
  const amountOutMin = await withRetry(
    () =>
      readContract(config, {
        address: ACHSWAP_ADAPTER_ADDRESS,
        abi: ACHSWAP_ADAPTER_ABI,
        functionName: "minOut",
        args: [quote.expectedOut, slippageToBps(slippagePercent)],
      }) as Promise<bigint>,
    { retries: 2 }
  );

  if (!quote.isNativeIn) {
    const allowance = await withRetry(
      () =>
        readContract(config, {
          address: quote.tokenIn,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [account, ACHSWAP_ADAPTER_ADDRESS],
        }) as Promise<bigint>,
      { retries: 2 }
    );

    if (allowance < quote.amountIn) {
      onStatus?.("approving");
      const approveHash = await writeContract(config, {
        address: quote.tokenIn,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [ACHSWAP_ADAPTER_ADDRESS, quote.amountIn],
      });
      const approveReceipt = await waitForTransactionReceipt(config, { hash: approveHash });
      if (approveReceipt.status !== "success") {
        throw new Error("Token approval reverted");
      }
    }
  }

  onStatus?.("swapping");
  const hash = await writeContract(config, {
    address: ACHSWAP_ADAPTER_ADDRESS,
    abi: ACHSWAP_ADAPTER_ABI,
    functionName: "swap",
    args: [
      quote.tokenIn,
      quote.tokenOut,
      quote.amountIn,
      amountOutMin,
      account,
      quote.routeData,
    ],
    value: quote.isNativeIn ? quote.amountIn : 0n,
  });

  const receipt = await waitForTransactionReceipt(config, { hash });
  if (receipt.status !== "success") {
    throw new Error("DEX Router transaction reverted");
  }

  return hash;
}
