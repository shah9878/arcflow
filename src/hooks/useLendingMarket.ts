"use client";

import { useCallback } from "react";
import { useAccount, useConfig } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readContracts } from "wagmi/actions";
import { formatUnits } from "viem";
import { LENDING_POOL_ABI, LENDING_POOL_ADDRESS } from "@/lib/contracts";
import { TOKEN_LIST, Token } from "@/lib/tokenList";

export interface MarketAsset {
  token: Token;
  isSupported: boolean;
  totalSupplied: bigint;
  totalBorrowed: bigint;
  totalSuppliedFormatted: string;
  totalBorrowedFormatted: string;
  supplyApr: number;
  supplyApy: number;
  borrowApr: number;
  borrowApy: number;
  userSupplyAmount: bigint;
  userSupplyFormatted: string;
  userBorrowAmount: bigint;
  userBorrowFormatted: string;
}

export const LENDING_MARKET_QUERY_KEY = "lendingMarket" as const;
export const LENDING_ACCOUNT_QUERY_KEY = "lendingAccount" as const;

function calculateApy(aprPercent: number): number {
  if (!aprPercent || aprPercent <= 0) return 0;
  const ratePerDay = aprPercent / 100 / 365;
  const apy = (Math.pow(1 + ratePerDay, 365) - 1) * 100;
  return Number(apy.toFixed(2));
}

function asBigInt(result: unknown): bigint {
  return typeof result === "bigint" ? result : BigInt(0);
}

type AssetStruct = readonly [boolean, bigint, bigint, bigint, bigint, bigint];

function asAssetStruct(result: unknown): AssetStruct | undefined {
  if (!Array.isArray(result) || result.length < 6) return undefined;
  if (typeof result[0] !== "boolean") return undefined;
  if (
    typeof result[1] !== "bigint" ||
    typeof result[2] !== "bigint" ||
    typeof result[3] !== "bigint" ||
    typeof result[4] !== "bigint" ||
    typeof result[5] !== "bigint"
  ) {
    return undefined;
  }
  return result as unknown as AssetStruct;
}

async function fetchMarkets(
  config: Parameters<typeof readContracts>[0],
  userAddress: `0x${string}` | undefined
): Promise<MarketAsset[]> {
  // Pass 1: asset meta, rates, and user share balances (single multicall)
  const primary = await readContracts(config, {
    allowFailure: true,
    contracts: TOKEN_LIST.flatMap((t) => [
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "assets" as const,
        args: [t.address] as const,
      },
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "getSupplyRate" as const,
        args: [t.address] as const,
      },
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "getBorrowRate" as const,
        args: [t.address] as const,
      },
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "supplyShares" as const,
        args: [userAddress ?? "0x0000000000000000000000000000000000000000", t.address] as const,
      },
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "borrowShares" as const,
        args: [userAddress ?? "0x0000000000000000000000000000000000000000", t.address] as const,
      },
    ]),
  });

  const supplyShares = TOKEN_LIST.map((_, idx) => asBigInt(primary[idx * 5 + 3]?.result));
  const borrowShares = TOKEN_LIST.map((_, idx) => asBigInt(primary[idx * 5 + 4]?.result));

  // Pass 2: convert shares → amounts using FRESH share values from pass 1
  const converted = await readContracts(config, {
    allowFailure: true,
    contracts: TOKEN_LIST.flatMap((t, idx) => [
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "supplySharesToAmount" as const,
        args: [t.address, supplyShares[idx]] as const,
      },
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "borrowSharesToAmount" as const,
        args: [t.address, borrowShares[idx]] as const,
      },
    ]),
  });

  return TOKEN_LIST.map((t, idx) => {
    const baseIdx = idx * 5;
    const assetData = asAssetStruct(primary[baseIdx]?.result);
    const supplyRateRaw = asBigInt(primary[baseIdx + 1]?.result);
    const borrowRateRaw = asBigInt(primary[baseIdx + 2]?.result);

    const userSupplyAmount = userAddress ? asBigInt(converted[idx * 2]?.result) : BigInt(0);
    const userBorrowAmount = userAddress ? asBigInt(converted[idx * 2 + 1]?.result) : BigInt(0);

    const isSupported = assetData ? assetData[0] : false;
    const totalSupplied = assetData ? assetData[1] : BigInt(0);
    const totalBorrowed = assetData ? assetData[2] : BigInt(0);
    const baseRateFromAsset = assetData ? assetData[4] : BigInt(0);

    const supplyRate = supplyRateRaw > BigInt(0) ? supplyRateRaw : BigInt(0);
    const borrowRate =
      borrowRateRaw > BigInt(0) ? borrowRateRaw : isSupported ? baseRateFromAsset : BigInt(0);

    const supplyAprPercent = parseFloat(formatUnits(supplyRate, 18)) * 100;
    const borrowAprPercent = parseFloat(formatUnits(borrowRate, 18)) * 100;

    return {
      token: t,
      isSupported,
      totalSupplied,
      totalBorrowed,
      totalSuppliedFormatted: parseFloat(formatUnits(totalSupplied, t.decimals)).toFixed(4),
      totalBorrowedFormatted: parseFloat(formatUnits(totalBorrowed, t.decimals)).toFixed(4),
      supplyApr: Number(supplyAprPercent.toFixed(2)),
      supplyApy: calculateApy(supplyAprPercent),
      borrowApr: Number(borrowAprPercent.toFixed(2)),
      borrowApy: calculateApy(borrowAprPercent),
      userSupplyAmount,
      userSupplyFormatted: parseFloat(formatUnits(userSupplyAmount, t.decimals)).toFixed(4),
      userBorrowAmount,
      userBorrowFormatted: parseFloat(formatUnits(userBorrowAmount, t.decimals)).toFixed(4),
    };
  });
}

export function useLendingMarket() {
  const { address } = useAccount();
  const config = useConfig();
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [LENDING_MARKET_QUERY_KEY, LENDING_POOL_ADDRESS, address ?? "none"],
    queryFn: () => fetchMarkets(config, address),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
  });

  const refetchAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: [LENDING_MARKET_QUERY_KEY] });
    return refetch();
  }, [queryClient, refetch]);

  return {
    markets: data ?? [],
    isLoading: isLoading || isFetching,
    error,
    refetch: refetchAll,
  };
}
