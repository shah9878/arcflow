"use client";

import { useReadContract, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { ARC_USDC_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { getTokenByAddress, getTokenBySymbol } from "@/lib/tokenList";

/**
 * Arc USDC: ERC-20 at 0x3600… uses 6 decimals (approve / transferFrom / balanceOf).
 * Native eth_getBalance uses 18-dec view of the same balance — do not mix with supply amounts.
 * Lending supply always uses ERC-20 6-dec units, so wallet balance here uses balanceOf.
 */

function getTokenDecimals(tokenAddress?: string, tokenSymbol?: string): number {
  if (
    tokenSymbol?.toUpperCase() === "USDC" ||
    tokenAddress?.toLowerCase() === ARC_USDC_ADDRESS.toLowerCase()
  ) {
    return 6;
  }
  const token =
    (tokenAddress ? getTokenByAddress(tokenAddress) : undefined) ||
    (tokenSymbol ? getTokenBySymbol(tokenSymbol) : undefined);
  return token?.decimals ?? 18;
}

export function useTokenBalance(
  tokenAddress: `0x${string}` | undefined,
  userAddress: `0x${string}` | undefined,
  tokenSymbol?: string
) {
  const decimals = getTokenDecimals(tokenAddress, tokenSymbol);

  const { data: readData, isLoading, error, refetch } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!tokenAddress && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const data = readData as bigint | undefined;
  const formatted = data !== undefined ? formatUnits(data, decimals) : "0.00";
  const displayBalance = parseFloat(formatted).toFixed(4);

  return {
    balance: displayBalance,
    rawBalance: data,
    isLoading,
    error,
    refetch,
  };
}

/** Navbar chip: native USDC gas balance (18-dec). Same funds as ERC-20 balanceOf (6-dec). */
export function useNativeUsdcBalance(userAddress: `0x${string}` | undefined) {
  const { data: balanceData, isLoading, error, refetch } = useBalance({
    address: userAddress,
    query: {
      enabled: !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const data = balanceData?.value;
  // Arc native USDC uses 18 decimals of precision for eth_getBalance
  const formatted = data !== undefined ? formatUnits(data, 18) : "0.00";
  const displayBalance = parseFloat(formatted).toFixed(4);

  return {
    balance: displayBalance,
    rawBalance: data,
    isLoading,
    error,
    refetch,
  };
}

export function useTokenBalanceWithDecimals(
  tokenAddress: `0x${string}` | undefined,
  userAddress: `0x${string}` | undefined,
  decimals: number,
  _tokenSymbol?: string
) {
  const { data: readData, isLoading, error, refetch } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!tokenAddress && !!userAddress,
      refetchInterval: 10_000,
    },
  });

  const data = readData as bigint | undefined;
  const formatted = data !== undefined ? formatUnits(data, decimals) : "0.00";
  const displayBalance = parseFloat(formatted).toFixed(4);

  return {
    balance: displayBalance,
    rawBalance: data,
    isLoading,
    error,
    refetch,
  };
}
