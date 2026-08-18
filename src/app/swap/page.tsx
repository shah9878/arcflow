"use client";

import { useState, useMemo, useCallback } from "react";
import { useAccount, useBalance } from "wagmi";
import {
  Settings, ArrowUpDown, ChevronDown, X, Search,
  AlertTriangle, CheckCircle, Loader2, ExternalLink, Zap,
} from "lucide-react";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { SWAPPABLE_TOKENS, Token } from "@/lib/tokenList";
import { swapRouteLabel, useSwapQuote } from "@/hooks/useSwapQuote";
import { useArcNetwork } from "@/hooks/useArcNetwork";
import { DEFAULT_SLIPPAGE, ARC_EXPLORER } from "@/lib/constants";
import { useTxStore } from "@/lib/txStore";
import { useSwap } from "@/hooks/useSwap";
import { useTokenBalance } from "@/hooks/useTokenBalance";

function validateAmount(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) return parts[0] + "." + parts[1];
  if (parts[1] && parts[1].length > 6) return parts[0] + "." + parts[1].slice(0, 6);
  return cleaned;
}

interface ToastMessage {
  type: "pending" | "success" | "error";
  message: string;
  txHash?: string;
}

function TokenOptionItem({
  token,
  userAddress,
  onSelect,
}: {
  token: Token;
  userAddress?: `0x${string}`;
  onSelect: (token: Token) => void;
}) {
  const { balance } = useTokenBalance(token.address, userAddress, token.symbol);

  return (
    <button
      onClick={() => onSelect(token)}
      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors min-h-[60px]"
    >
      <div className="flex items-center gap-3">
        <TokenLogo symbol={token.symbol} size={36} />
        <div className="text-left">
          <div className="text-white font-medium text-sm">{token.name}</div>
          <div className="text-gray-500 text-xs">{token.symbol}</div>
        </div>
      </div>
      <div className="text-right">
        {userAddress && (
          <div className="text-sm font-medium text-gray-200 mb-0.5">
            {balance}
          </div>
        )}
        <div className="flex items-center justify-end gap-1 text-xs text-blue-400/60 bg-blue-500/5 px-2 py-0.5 rounded-full">
          <Zap size={9} />
          AppKit
        </div>
      </div>
    </button>
  );
}

export default function SwapPage() {
  const { isConnected, address } = useAccount();
  const { isCorrectNetwork, switchToArc } = useArcNetwork();
  const { transactions } = useTxStore();
  const { swap, isLoading: swapLoading } = useSwap();

  const defaultTokenIn = SWAPPABLE_TOKENS[0]; // USDC
  const [tokenIn, setTokenIn] = useState<Token>(defaultTokenIn);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);
  const [amountIn, setAmountIn] = useState("");

  const { balance: payTokenBalance, refetch: refetchTokenIn } = useTokenBalance(tokenIn.address, address, tokenIn.symbol);
  const { balance: receiveTokenBalance, refetch: refetchTokenOut } = useTokenBalance(tokenOut?.address, address, tokenOut?.symbol);

  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [deadline, setDeadline] = useState(20);
  const [customSlippage, setCustomSlippage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokenModalFor, setTokenModalFor] = useState<"in" | "out" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);

  // AppKit and DEX Router quotes race in parallel; AppKit wins when both succeed.
  const { amountOut, priceImpact, minimumReceived, gasFee, loading: quoteLoading, error: quoteError, source: quoteSource } =
    useSwapQuote(tokenIn.symbol, tokenOut?.symbol, amountIn, slippage, address);

  const filteredTokens = useMemo(
    () =>
      SWAPPABLE_TOKENS.filter(
        (t) =>
          t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
          t.name.toLowerCase().includes(tokenSearch.toLowerCase())
      ),
    [tokenSearch]
  );

  const handleSwapDirection = useCallback(() => {
    if (!tokenOut) return;
    const prev = tokenIn;
    setTokenIn(tokenOut);
    setTokenOut(prev);
    setAmountIn(amountOut || "");
  }, [tokenIn, tokenOut, amountOut]);

  const handleSelectToken = (token: Token) => {
    if (tokenModalFor === "in") {
      if (tokenOut?.address === token.address) setTokenOut(tokenIn);
      setTokenIn(token);
    } else {
      if (tokenIn.address === token.address) {
        if (tokenOut) {
          setTokenIn(tokenOut);
        } else {
          const fallbackToken = SWAPPABLE_TOKENS.find(t => t.address !== token.address);
          if (fallbackToken) setTokenIn(fallbackToken);
        }
      }
      setTokenOut(token);
    }
    setTokenModalFor(null);
    setTokenSearch("");
  };

  const showToast = (msg: ToastMessage) => {
    setToast(msg);
    if (msg.type !== "pending") setTimeout(() => setToast(null), 5000);
  };

  const handleSwap = async () => {
    if (!tokenOut) return;
    setConfirmOpen(false);
    showToast({
      type: "pending",
      message: `Swap pending via ${swapRouteLabel(quoteSource)}...`,
    });
    try {
      const hash = await swap({
        tokenIn,
        tokenOut,
        amountIn,
        slippage,
        deadlineMinutes: deadline,
        preferredRoute: quoteSource,
        onStatus: (status) => {
          if (status === "appkit") {
            showToast({ type: "pending", message: "Swap pending via Arc AppKit..." });
          } else if (status === "dex-router") {
            showToast({ type: "pending", message: "AppKit unavailable — swapping via DEX Router..." });
          } else if (status === "approving") {
            showToast({ type: "pending", message: "Approve token spend in your wallet..." });
          }
        },
      });
      showToast({
        type: "success",
        message: `Swapped ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}!`,
        txHash: hash,
      });
      setAmountIn("");
      refetchTokenIn();
      if (refetchTokenOut) refetchTokenOut();
      setTimeout(() => {
        refetchTokenIn();
        if (refetchTokenOut) refetchTokenOut();
      }, 2000);
    } catch (err: unknown) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Swap failed",
      });
    }
  };

  const ctaButton = () => {
    if (!isConnected) {
      return {
        label: "Connect Wallet",
        action: () => setConnectOpen(true),
        disabled: false,
        variant: "blue",
      };
    }
    if (!isCorrectNetwork) return { label: "Switch to Arc Testnet", action: switchToArc, disabled: false, variant: "red" };
    if (swapLoading) return { label: "Swapping...", action: () => {}, disabled: true, variant: "gray" };
    if (!amountIn || parseFloat(amountIn) === 0) return { label: "Enter an amount", action: () => {}, disabled: true, variant: "gray" };
    if (!tokenOut) return { label: "Select a token", action: () => {}, disabled: true, variant: "gray" };
    if (quoteLoading) return { label: "Fetching quote...", action: () => {}, disabled: true, variant: "gray" };
    if (quoteError || !amountOut) return { label: "No route available", action: () => {}, disabled: true, variant: "gray" };
    return { label: "Swap", action: () => setConfirmOpen(true), disabled: false, variant: "blue" };
  };

  const cta = ctaButton();
  const impactWarning = priceImpact > 5 ? "red" : priceImpact > 1 ? "yellow" : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-start px-4 pt-8 pb-24" style={{ background: "#0a0a0f" }}>
      <div className="w-full max-w-[480px]">
        <h1 className="text-2xl font-bold text-white mb-2 text-center">Swap Tokens</h1>

        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
            quoteSource === "dex-router"
              ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
              : "bg-blue-500/10 border-blue-500/20 text-blue-400"
          }`}>
            <Zap size={11} />
            {quoteSource === "dex-router" ? "Fallback: DEX Router" : "Powered by Arc AppKit"}
          </div>
        </div>

        {/* Swap Card */}
        <div className="rounded-2xl border border-[#2a2a3a] p-5 shadow-2xl" style={{ background: "#13131a" }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <span className="text-lg font-semibold text-white">Swap</span>
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <Settings size={18} />
            </button>
          </div>

          {/* You Pay */}
          <div className="rounded-xl p-4 mb-1" style={{ background: "#1c1c26" }}>
            <p className="text-xs text-gray-500 mb-2 font-medium">You Pay</p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amountIn}
                onChange={(e) => setAmountIn(validateAmount(e.target.value))}
                className="flex-1 bg-transparent text-2xl font-bold text-white placeholder-gray-600 outline-none focus:ring-0 border-none min-w-0"
                style={{ WebkitAppearance: "none" }}
              />
              <button
                onClick={() => setTokenModalFor("in")}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#2a2a3a] hover:bg-[#333344] transition-colors flex-shrink-0 min-h-[44px]"
              >
                <TokenLogo symbol={tokenIn.symbol} size={24} />
                <span className="font-semibold text-white text-sm">{tokenIn.symbol}</span>
                <ChevronDown size={14} className="text-gray-400" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-gray-600">
                Balance: {isConnected ? payTokenBalance : "0.0000"} {tokenIn.symbol}
              </p>
              {isConnected && parseFloat(payTokenBalance) > 0 && (
                <button
                  onClick={() => setAmountIn(payTokenBalance)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors px-1.5 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20"
                >
                  MAX
                </button>
              )}
            </div>
          </div>

          {/* Swap Toggle */}
          <div className="flex justify-center my-1 relative z-10">
            <button
              onClick={handleSwapDirection}
              className="w-10 h-10 rounded-xl bg-[#13131a] border border-[#2a2a3a] hover:border-blue-500/40 flex items-center justify-center text-gray-400 hover:text-blue-400 transition-all hover:scale-110"
            >
              <ArrowUpDown size={18} />
            </button>
          </div>

          {/* You Receive */}
          <div className="rounded-xl p-4 mt-1" style={{ background: "#1c1c26" }}>
            <p className="text-xs text-gray-500 mb-2 font-medium">You Receive</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-2xl font-bold text-white min-w-0">
                {quoteLoading ? (
                  <div className="w-24 h-8 rounded-lg bg-gray-800 animate-pulse" />
                ) : (
                  <span className={amountOut ? "text-white" : "text-gray-600"}>{amountOut || "0.0"}</span>
                )}
              </div>
              {tokenOut ? (
                <button
                  onClick={() => setTokenModalFor("out")}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#2a2a3a] hover:bg-[#333344] transition-colors flex-shrink-0 min-h-[44px]"
                >
                  <TokenLogo symbol={tokenOut.symbol} size={24} />
                  <span className="font-semibold text-white text-sm">{tokenOut.symbol}</span>
                  <ChevronDown size={14} className="text-gray-400" />
                </button>
              ) : (
                <button
                  onClick={() => setTokenModalFor("out")}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors flex-shrink-0 min-h-[44px]"
                >
                  Select Token
                </button>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-2">
              Balance: {isConnected && tokenOut ? receiveTokenBalance : "0.0000"} {tokenOut?.symbol ?? ""}
            </p>
          </div>

          {/* Quote Error */}
          {quoteError && !quoteLoading && (
            <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertTriangle size={14} className="flex-shrink-0" />
              {quoteError}
            </div>
          )}

          {/* Price Info */}
          {tokenOut && amountOut && !quoteLoading && (
            <div className="mt-3 rounded-xl p-3 border border-[#2a2a3a] space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Rate</span>
                <span className="text-gray-300">
                  1 {tokenIn.symbol} ≈ {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(4)} {tokenOut.symbol}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Price Impact</span>
                <span className={impactWarning === "red" ? "text-red-400 font-semibold" : impactWarning === "yellow" ? "text-yellow-400" : "text-gray-300"}>
                  {priceImpact.toFixed(4)}%
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Min. Received</span>
                <span className="text-gray-300">{minimumReceived} {tokenOut.symbol}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Est. Gas Fee</span>
                <span className="text-gray-300">{gasFee || "~0.001 USDC"}</span>
              </div>
            </div>
          )}

          {impactWarning === "red" && (
            <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertTriangle size={14} />
              High price impact! You may receive significantly less than expected.
            </div>
          )}

          {/* CTA Button */}
          <button
            onClick={cta.action}
            disabled={cta.disabled}
            className={`mt-4 w-full py-4 rounded-xl font-semibold text-base transition-all min-h-[52px] ${
              cta.variant === "blue"
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
                : cta.variant === "red"
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-[#2a2a3a] text-gray-500 cursor-not-allowed"
            }`}
          >
            {swapLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin" />{" "}
                {`Swapping via ${swapRouteLabel(quoteSource)}...`}
              </span>
            ) : (
              cta.label
            )}
          </button>
        </div>

        {/* Transaction History */}
        {transactions.length > 0 && (
          <div className="mt-6 rounded-2xl border border-[#2a2a3a] p-4" style={{ background: "#13131a" }}>
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Recent Transactions</h3>
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`capitalize font-medium ${
                      tx.status === "success" ? "text-green-400" : tx.status === "failed" ? "text-red-400" : "text-yellow-400"
                    }`}>
                      {tx.type}
                    </span>
                    <span className="text-gray-500">{tx.amount} {tx.token}</span>
                  </div>
                  {tx.txHash && (
                    <a href={`${ARC_EXPLORER}/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                      View <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSettingsOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative w-full sm:w-[380px] rounded-2xl border border-[#2a2a3a] p-5 shadow-2xl z-10" style={{ background: "#13131a" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">Transaction Settings</h2>
              <button onClick={() => setSettingsOpen(false)} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Slippage Tolerance</p>
                <div className="flex gap-2 flex-wrap">
                  {[0.1, 0.5, 1.0].map((v) => (
                    <button
                      key={v}
                      onClick={() => { setSlippage(v); setCustomSlippage(""); }}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all min-h-[40px] ${
                        slippage === v && !customSlippage ? "bg-blue-600 text-white" : "bg-[#2a2a3a] text-gray-400 hover:text-white"
                      }`}
                    >
                      {v}%
                    </button>
                  ))}
                  <div className="flex items-center gap-1 flex-1 min-w-[80px]">
                    <input
                      type="text"
                      placeholder="Custom"
                      value={customSlippage}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        setCustomSlippage(v);
                        if (v) setSlippage(parseFloat(v));
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-[#2a2a3a] text-white text-sm outline-none border border-[#2a2a3a] focus:border-blue-500/50 min-h-[40px]"
                    />
                    <span className="text-gray-400 text-sm">%</span>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-300 mb-2">Transaction Deadline</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={deadline}
                    onChange={(e) => setDeadline(parseInt(e.target.value) || 20)}
                    className="w-24 px-3 py-2 rounded-lg bg-[#2a2a3a] text-white text-sm outline-none border border-[#2a2a3a] focus:border-blue-500/50 min-h-[40px]"
                  />
                  <span className="text-gray-400 text-sm">minutes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Token Selector Modal */}
      {tokenModalFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => { setTokenModalFor(null); setTokenSearch(""); }}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative w-full sm:w-[420px] rounded-t-2xl sm:rounded-2xl border border-[#2a2a3a] shadow-2xl z-10 overflow-hidden"
            style={{ background: "#13131a", maxHeight: "85dvh" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-[#2a2a3a]">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Select Token</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Arc Testnet supported tokens</p>
                </div>
                <button onClick={() => { setTokenModalFor(null); setTokenSearch(""); }} className="text-gray-400 hover:text-white p-1">
                  <X size={18} />
                </button>
              </div>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search tokens..."
                  value={tokenSearch}
                  onChange={(e) => setTokenSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#1c1c26] border border-[#2a2a3a] text-white text-sm placeholder-gray-600 outline-none focus:border-blue-500/50 min-h-[44px]"
                  autoFocus
                />
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "calc(85dvh - 140px)" }}>
              {filteredTokens.map((token) => (
                <TokenOptionItem
                  key={token.address}
                  token={token}
                  userAddress={address}
                  onSelect={handleSelectToken}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Swap Modal */}
      {confirmOpen && tokenOut && amountOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <div
            className="relative w-full sm:w-[400px] rounded-2xl border border-[#2a2a3a] p-5 shadow-2xl z-10"
            style={{ background: "#13131a" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">Confirm Swap</h2>
              <button onClick={() => setConfirmOpen(false)} className="text-gray-400 hover:text-white p-1"><X size={18} /></button>
            </div>

            <div className="space-y-3 mb-5">
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: "#1c1c26" }}>
                <div className="flex items-center gap-2">
                  <TokenLogo symbol={tokenIn.symbol} size={28} />
                  <div>
                    <div className="text-xs text-gray-500">You Pay</div>
                    <div className="text-white font-semibold">{amountIn} {tokenIn.symbol}</div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: "#1c1c26" }}>
                <div className="flex items-center gap-2">
                  <TokenLogo symbol={tokenOut.symbol} size={28} />
                  <div>
                    <div className="text-xs text-gray-500">You Receive (est.)</div>
                    <div className="text-white font-semibold">{amountOut} {tokenOut.symbol}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5 mb-5 p-3 rounded-xl border border-[#2a2a3a]">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Price Impact</span>
                <span className={impactWarning === "red" ? "text-red-400" : "text-gray-300"}>{priceImpact.toFixed(4)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Min. Received</span>
                <span className="text-gray-300">{minimumReceived} {tokenOut.symbol}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Gas Fee</span>
                <span className="text-gray-300">{gasFee || "~0.001 USDC"}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Slippage</span>
                <span className="text-gray-300">{slippage}%</span>
              </div>
            </div>

            {impactWarning && (
              <div className={`mb-4 flex items-center gap-2 p-3 rounded-xl text-xs ${
                impactWarning === "red"
                  ? "bg-red-500/10 border border-red-500/20 text-red-400"
                  : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"
              }`}>
                <AlertTriangle size={14} />
                {impactWarning === "red" ? "High price impact! Proceed with caution." : "Price impact exceeds 1%"}
              </div>
            )}

            <div className={`mb-4 flex items-center gap-2 p-2.5 rounded-xl text-xs ${
              quoteSource === "dex-router"
                ? "bg-amber-500/5 border border-amber-500/15 text-amber-400/80"
                : "bg-blue-500/5 border border-blue-500/15 text-blue-400/80"
            }`}>
              <Zap size={12} />
              {quoteSource === "dex-router"
                ? "AppKit has no route — executing via DEX Router. Your wallet will prompt to approve if needed."
                : "Executed via Arc AppKit — your wallet will prompt for approval"}
            </div>

            <button
              onClick={handleSwap}
              className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors min-h-[52px]"
            >
              Confirm Swap
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm max-w-sm w-full mx-4 ${
          toast.type === "success"
            ? "bg-green-500/10 border-green-500/30 text-green-300"
            : toast.type === "error"
            ? "bg-red-500/10 border-red-500/30 text-red-300"
            : "bg-blue-500/10 border-blue-500/30 text-blue-300"
        }`}>
          {toast.type === "pending" && <Loader2 size={16} className="animate-spin flex-shrink-0" />}
          {toast.type === "success" && <CheckCircle size={16} className="flex-shrink-0" />}
          {toast.type === "error" && <AlertTriangle size={16} className="flex-shrink-0" />}
          <span className="flex-1">{toast.message}</span>
          {toast.txHash && (
            <a href={`${ARC_EXPLORER}/tx/${toast.txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs opacity-70 hover:opacity-100 flex-shrink-0">
              Arcscan <ExternalLink size={10} />
            </a>
          )}
          <button onClick={() => setToast(null)} className="text-current opacity-50 hover:opacity-100 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <ConnectModal isOpen={connectOpen} onClose={() => setConnectOpen(false)} />
    </div>
  );
}
