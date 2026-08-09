"use client";

import { useState } from "react";
import { useAccount, useConfig } from "wagmi";
import {
  writeContract,
  waitForTransactionReceipt,
  readContract,
  getBytecode,
} from "wagmi/actions";
import { parseUnits } from "viem";
import { LENDING_POOL_ABI, LENDING_POOL_ADDRESS, ERC20_ABI } from "@/lib/contracts";
import { useTxStore } from "@/lib/txStore";

async function assertPoolDeployed(config: Parameters<typeof getBytecode>[0]) {
  const code = await getBytecode(config, { address: LENDING_POOL_ADDRESS });
  if (!code || code === "0x") {
    throw new Error(
      `Lending pool is not deployed at ${LENDING_POOL_ADDRESS}. Deploy ArcFlowLendingPool, list assets, then paste the address in src/lib/contracts.ts.`
    );
  }
}

async function waitSuccess(
  config: Parameters<typeof waitForTransactionReceipt>[0],
  hash: `0x${string}`
) {
  const receipt = await waitForTransactionReceipt(config, { hash });
  if (receipt.status !== "success") {
    throw new Error("Transaction reverted on-chain");
  }
  return receipt;
}

export function useLendingActions() {
  const { address } = useAccount();
  const config = useConfig();
  const { addTransaction } = useTxStore();
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const supply = async (
    tokenAddress: `0x${string}`,
    amountStr: string,
    decimals: number,
    symbol: string
  ): Promise<`0x${string}`> => {
    if (!address) throw new Error("Wallet not connected");
    setSubmitting(true);
    try {
      await assertPoolDeployed(config);
      const parsedAmount = parseUnits(amountStr, decimals);
      if (parsedAmount <= BigInt(0)) throw new Error("Invalid amount");

      setStatusMessage(`Checking ${symbol} balance...`);
      const walletBal = (await readContract(config, {
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      if (walletBal < parsedAmount) {
        throw new Error(`Insufficient ${symbol} balance (ERC-20 view)`);
      }

      setStatusMessage(`Checking ${symbol} allowance...`);
      const currentAllowance = (await readContract(config, {
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, LENDING_POOL_ADDRESS],
      })) as bigint;

      if (currentAllowance < parsedAmount) {
        setStatusMessage(`Approving ${symbol} for Lending Pool...`);
        const approveTx = await writeContract(config, {
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [LENDING_POOL_ADDRESS, parsedAmount],
        });
        await waitSuccess(config, approveTx);
      }

      setStatusMessage(`Supplying ${amountStr} ${symbol}...`);
      const supplyTx = await writeContract(config, {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "supply",
        args: [tokenAddress, parsedAmount],
      });
      await waitSuccess(config, supplyTx);

      addTransaction({
        type: "supply",
        amount: amountStr,
        token: symbol,
        status: "success",
        txHash: supplyTx,
      });

      return supplyTx;
    } catch (err: unknown) {
      addTransaction({
        type: "supply",
        amount: amountStr,
        token: symbol,
        status: "failed",
      });
      throw err;
    } finally {
      setSubmitting(false);
      setStatusMessage("");
    }
  };

  const withdraw = async (
    tokenAddress: `0x${string}`,
    amountStr: string,
    decimals: number,
    symbol: string
  ): Promise<`0x${string}`> => {
    if (!address) throw new Error("Wallet not connected");
    setSubmitting(true);
    try {
      await assertPoolDeployed(config);
      const parsedAmount = parseUnits(amountStr, decimals);

      setStatusMessage(`Withdrawing ${amountStr} ${symbol}...`);
      const withdrawTx = await writeContract(config, {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "withdraw",
        args: [tokenAddress, parsedAmount],
      });
      await waitSuccess(config, withdrawTx);

      addTransaction({
        type: "withdraw",
        amount: amountStr,
        token: symbol,
        status: "success",
        txHash: withdrawTx,
      });

      return withdrawTx;
    } catch (err: unknown) {
      addTransaction({
        type: "withdraw",
        amount: amountStr,
        token: symbol,
        status: "failed",
      });
      throw err;
    } finally {
      setSubmitting(false);
      setStatusMessage("");
    }
  };

  const borrow = async (
    tokenAddress: `0x${string}`,
    amountStr: string,
    decimals: number,
    symbol: string
  ): Promise<`0x${string}`> => {
    if (!address) throw new Error("Wallet not connected");
    setSubmitting(true);
    try {
      await assertPoolDeployed(config);
      const parsedAmount = parseUnits(amountStr, decimals);

      setStatusMessage(`Borrowing ${amountStr} ${symbol}...`);
      const borrowTx = await writeContract(config, {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "borrow",
        args: [tokenAddress, parsedAmount],
      });
      await waitSuccess(config, borrowTx);

      addTransaction({
        type: "borrow",
        amount: amountStr,
        token: symbol,
        status: "success",
        txHash: borrowTx,
      });

      return borrowTx;
    } catch (err: unknown) {
      addTransaction({
        type: "borrow",
        amount: amountStr,
        token: symbol,
        status: "failed",
      });
      throw err;
    } finally {
      setSubmitting(false);
      setStatusMessage("");
    }
  };

  const repay = async (
    tokenAddress: `0x${string}`,
    amountStr: string,
    decimals: number,
    symbol: string
  ): Promise<`0x${string}`> => {
    if (!address) throw new Error("Wallet not connected");
    setSubmitting(true);
    try {
      await assertPoolDeployed(config);
      const parsedAmount = parseUnits(amountStr, decimals);

      setStatusMessage(`Checking ${symbol} allowance...`);
      const currentAllowance = (await readContract(config, {
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, LENDING_POOL_ADDRESS],
      })) as bigint;

      if (currentAllowance < parsedAmount) {
        setStatusMessage(`Approving ${symbol} for Repayment...`);
        const approveTx = await writeContract(config, {
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [LENDING_POOL_ADDRESS, parsedAmount],
        });
        await waitSuccess(config, approveTx);
      }

      setStatusMessage(`Repaying ${amountStr} ${symbol}...`);
      const repayTx = await writeContract(config, {
        address: LENDING_POOL_ADDRESS,
        abi: LENDING_POOL_ABI,
        functionName: "repay",
        args: [tokenAddress, parsedAmount],
      });
      await waitSuccess(config, repayTx);

      addTransaction({
        type: "repay",
        amount: amountStr,
        token: symbol,
        status: "success",
        txHash: repayTx,
      });

      return repayTx;
    } catch (err: unknown) {
      addTransaction({
        type: "repay",
        amount: amountStr,
        token: symbol,
        status: "failed",
      });
      throw err;
    } finally {
      setSubmitting(false);
      setStatusMessage("");
    }
  };

  return {
    supply,
    withdraw,
    borrow,
    repay,
    submitting,
    statusMessage,
  };
}
