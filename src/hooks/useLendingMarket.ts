"use client";

import { useAccount, useReadContracts } from "wagmi";
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

function calculateApy(aprPercent: number): number {
  if (!aprPercent || aprPercent <= 0) return 0;
  const ratePerDay = aprPercent / 100 / 365;
  const apy = (Math.pow(1 + ratePerDay, 365) - 1) * 100;
  return Number(apy.toFixed(2));
}

/** Extract bigint from heterogeneous useReadContracts results (union includes address[]). */
function asBigInt(result: unknown): bigint {
  return typeof result === "bigint" ? result : BigInt(0);
}

type AssetStruct = readonly [
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

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

export function useLendingMarket() {
  const { address, isConnected } = useAccount();

  // Create contract queries for each token in TOKEN_LIST
  const contracts = TOKEN_LIST.flatMap((t) => [
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
      args: address ? ([address, t.address] as const) : undefined,
    },
    {
      address: LENDING_POOL_ADDRESS,
      abi: LENDING_POOL_ABI,
      functionName: "borrowShares" as const,
      args: address ? ([address, t.address] as const) : undefined,
    },
  ]);

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts,
    query: {
      enabled: true,
      refetchInterval: 10_000,
    },
  });

  // Second pass queries for supplySharesToAmount and borrowSharesToAmount
  const shareConversionContracts = TOKEN_LIST.flatMap((t, idx) => {
    const baseIdx = idx * 5;
    const userSupplyShares = asBigInt(data?.[baseIdx + 3]?.result);
    const userBorrowShares = asBigInt(data?.[baseIdx + 4]?.result);

    return [
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "supplySharesToAmount" as const,
        args: [t.address, userSupplyShares] as const,
      },
      {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "borrowSharesToAmount" as const,
        args: [t.address, userBorrowShares] as const,
      },
    ];
  });

  const { data: shareData, isLoading: shareLoading, refetch: refetchShares } = useReadContracts({
    contracts: shareConversionContracts,
    query: {
      enabled: !!data && data.length > 0,
      refetchInterval: 10_000,
    },
  });

  const markets: MarketAsset[] = TOKEN_LIST.map((t, idx) => {
    const baseIdx = idx * 5;
    const assetData = asAssetStruct(data?.[baseIdx]?.result);
    const supplyRateRaw = asBigInt(data?.[baseIdx + 1]?.result);
    const borrowRateRaw = asBigInt(data?.[baseIdx + 2]?.result);

    const shareIdx = idx * 2;
    const userSupplyAmount = asBigInt(shareData?.[shareIdx]?.result);
    const userBorrowAmount = asBigInt(shareData?.[shareIdx + 1]?.result);

    // Default unsupported when pool missing / call failed (do not fake markets)
    const isSupported = assetData ? assetData[0] : false;
    const totalSupplied = assetData ? assetData[1] : BigInt(0);
    const totalBorrowed = assetData ? assetData[2] : BigInt(0);
    // assets[4]=baseRate, assets[5]=rateMultiplier — used if rate calls empty
    const baseRateFromAsset = assetData ? assetData[4] : BigInt(0);

    // Rates are 18-dec fractions (0.02e18 = 2%). Prefer live getSupplyRate / getBorrowRate.
    const supplyRate = supplyRateRaw > BigInt(0) ? supplyRateRaw : BigInt(0);
    const borrowRate =
      borrowRateRaw > BigInt(0) ? borrowRateRaw : isSupported ? baseRateFromAsset : BigInt(0);

    const supplyAprPercent = parseFloat(formatUnits(supplyRate, 18)) * 100;
    const borrowAprPercent = parseFloat(formatUnits(borrowRate, 18)) * 100;

    const supplyApy = calculateApy(supplyAprPercent);
    const borrowApy = calculateApy(borrowAprPercent);

    return {
      token: t,
      isSupported,
      totalSupplied,
      totalBorrowed,
      totalSuppliedFormatted: parseFloat(formatUnits(totalSupplied, t.decimals)).toFixed(4),
      totalBorrowedFormatted: parseFloat(formatUnits(totalBorrowed, t.decimals)).toFixed(4),
      supplyApr: Number(supplyAprPercent.toFixed(2)),
      supplyApy,
      borrowApr: Number(borrowAprPercent.toFixed(2)),
      borrowApy,
      userSupplyAmount,
      userSupplyFormatted: parseFloat(formatUnits(userSupplyAmount, t.decimals)).toFixed(4),
      userBorrowAmount,
      userBorrowFormatted: parseFloat(formatUnits(userBorrowAmount, t.decimals)).toFixed(4),
    };
  });

  const refetchAll = () => {
    refetch();
    refetchShares();
  };

  return {
    markets,
    isLoading: isLoading || shareLoading,
    error,
    refetch: refetchAll,
  };
}
