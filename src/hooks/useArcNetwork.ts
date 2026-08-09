"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/constants";

const ARC_CHAIN_HEX = "0x4CEF52"; // 5042002 in hex

const ARC_CHAIN_PARAMS = {
  chainId: ARC_CHAIN_HEX,
  chainName: "Arc Testnet",
  rpcUrls: ["https://rpc.testnet.arc.network"],
  nativeCurrency: {
    name: "USD Coin",
    // Arc native gas: 18-dec eth_getBalance; ERC-20 USDC interface: 6-dec
    symbol: "USDC",
    decimals: 18,
  },
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
  }
}

async function addAndSwitchToArc() {
  if (typeof window === "undefined" || !window.ethereum) return;

  try {
    // First, try to add the chain (idempotent — safe if already added)
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [ARC_CHAIN_PARAMS],
    });
  } catch {
    // Some wallets throw if the chain already exists; that's fine — continue to switch
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN_HEX }],
    });
  } catch (switchError: any) {
    console.error("Failed to switch to Arc Testnet:", switchError);
    throw switchError;
  }
}

export function useArcNetwork() {
  const { isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  // wagmiConfig.ts only registers Arc Testnet in `chains`, and wagmi's
  // useChainId()/store deliberately refuses to sync state.chainId to any
  // chain outside that list (see @wagmi/core createConfig.js — "If chain is
  // not configured, then don't switch over to it"). That means useChainId()
  // stays frozen on Arc Testnet's id even when the wallet is actually on a
  // different chain, which is exactly backwards for "detect the wrong chain."
  // Read the real chain id straight from the injected provider instead.
  const [rawChainId, setRawChainId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    let cancelled = false;

    window.ethereum
      .request({ method: "eth_chainId" })
      .then((hex: string) => {
        if (!cancelled) setRawChainId(parseInt(hex, 16));
      })
      .catch(() => {});

    const onChainChanged = (hex: string) => setRawChainId(parseInt(hex, 16));
    window.ethereum.on?.("chainChanged", onChainChanged);

    return () => {
      cancelled = true;
      window.ethereum?.removeListener?.("chainChanged", onChainChanged);
    };
  }, [isConnected]);

  const isCorrectNetwork = !isConnected || rawChainId === null || rawChainId === ARC_TESTNET_CHAIN_ID;

  const switchToArc = async () => {
    try {
      if (typeof window !== "undefined" && window.ethereum) {
        await addAndSwitchToArc();
      } else if (switchChain) {
        // Non-injected sessions (e.g. WalletConnect) — wagmi can still switch
        // to Arc Testnet directly since it IS in `chains`; it just can't track
        // arbitrary other chains, which is the part we work around above.
        switchChain({ chainId: ARC_TESTNET_CHAIN_ID });
      }
    } catch (error) {
      console.error("Failed to switch network:", error);
    }
  };

  // Auto-trigger on wallet connect or chain change
  useEffect(() => {
    if (isConnected && rawChainId !== null && rawChainId !== ARC_TESTNET_CHAIN_ID) {
      switchToArc();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, rawChainId]);

  return { isCorrectNetwork, switchToArc, chainId: rawChainId };
}
