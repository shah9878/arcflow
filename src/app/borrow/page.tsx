"use client";

import { useState, useMemo } from "react";
import { useAccount } from "wagmi";
import { X, AlertTriangle, CheckCircle, Loader2, ExternalLink, ArrowDownLeft, RefreshCw } from "lucide-react";
import { TokenLogo } from "@/components/ui/TokenLogo";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { useLendingMarket, MarketAsset } from "@/hooks/useLendingMarket";
import { useLendingActions } from "@/hooks/useLendingActions";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useRefreshLending } from "@/hooks/useRefreshLending";
import { ARC_EXPLORER } from "@/lib/constants";

function validateAmount(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) return parts[0] + "." + parts[1];
  if (parts[1] && parts[1].length > 6) return parts[0] + "." + parts[1].slice(0, 6);
  return cleaned;
}

type ToastMsg = { type: "pending" | "success" | "error"; message: string; txHash?: string };

export default function BorrowPage() {
  const { isConnected, address } = useAccount();
  const { healthFactor, totalCollateralUSD, totalDebtUSD, availableBorrowUSD, isLoading: hfLoading } = useHealthFactor();
  const { markets, isLoading: marketLoading } = useLendingMarket();
  const { borrow, repay, submitting, statusMessage } = useLendingActions();
  const refreshLending = useRefreshLending();

  const [borrowModal, setBorrowModal] = useState<MarketAsset | null>(null);
  const [repayModal, setRepayModal] = useState<MarketAsset | null>(null);
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [toast, setToast] = useState<ToastMsg | null>(null);

  // User wallet balance for token in repay modal
  const { balance: walletBalance } = useTokenBalance(
    repayModal?.token.address,
    address,
    repayModal?.token.symbol
  );

  const borrowLimitUsed = useMemo(() => {
    if (!totalCollateralUSD || totalCollateralUSD === 0) return 0;
    return Math.min((totalDebtUSD / (totalCollateralUSD * 0.8)) * 100, 100);
  }, [totalCollateralUSD, totalDebtUSD]);

  const previewHF = useMemo(() => {
    if (!borrowAmount || !borrowModal) return healthFactor;
    const add = parseFloat(borrowAmount) || 0;
    if (!add) return healthFactor;
    const newDebt = totalDebtUSD + add;
    if (!totalCollateralUSD) return null;
    const res = (totalCollateralUSD * 0.8) / newDebt;
    return res > 100 ? null : res;
  }, [borrowAmount, borrowModal, healthFactor, totalCollateralUSD, totalDebtUSD]);

  const showToast = (msg: ToastMsg) => {
    setToast(msg);
    if (msg.type !== "pending") setTimeout(() => setToast(null), 5000);
  };

  const handleRefetchAll = async () => {
    await refreshLending();
  };

  const handleBorrowSubmit = async () => {
    if (!borrowModal || !borrowAmount || parseFloat(borrowAmount) === 0) return;
    const asset = borrowModal;
    const amt = borrowAmount;
    try {
      showToast({ type: "pending", message: `Borrowing ${amt} ${asset.token.symbol}...` });
      const hash = await borrow(asset.token.address, amt, asset.token.decimals, asset.token.symbol);
      showToast({ type: "success", message: `Borrowed ${amt} ${asset.token.symbol} successfully!`, txHash: hash });
      setBorrowModal(null);
      setBorrowAmount("");
      void handleRefetchAll();
    } catch (err: unknown) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Borrow transaction failed",
      });
    }
  };

  const handleRepaySubmit = async () => {
    if (!repayModal || !repayAmount || parseFloat(repayAmount) === 0) return;
    const asset = repayModal;
    const amt = repayAmount;
    try {
      showToast({ type: "pending", message: `Repaying ${amt} ${asset.token.symbol}...` });
      const hash = await repay(asset.token.address, amt, asset.token.decimals, asset.token.symbol);
      showToast({ type: "success", message: `Repaid ${amt} ${asset.token.symbol} successfully!`, txHash: hash });
      setRepayModal(null);
      setRepayAmount("");
      void handleRefetchAll();
    } catch (err: unknown) {
      showToast({
        type: "error",
        message: err instanceof Error ? err.message : "Repay transaction failed",
      });
    }
  };

  const hfColor = (hf: number | null) =>
    hf === null ? "text-gray-500" : hf > 1.5 ? "text-green-400" : hf >= 1.0 ? "text-yellow-400" : "text-red-400";

  const borrowRisk = previewHF !== null && previewHF < 1.2;
  const borrowLiqRisk = previewHF !== null && previewHF < 1.0;

  return (
    <div className="min-h-screen px-4 pt-8 pb-24" style={{ background: "#0a0a0f" }}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Borrow Markets</h1>
            <p className="text-gray-400">Borrow assets against your supplied collateral on Arc Testnet.</p>
          </div>
          <button
            onClick={handleRefetchAll}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#13131a] border border-[#2a2a3a] text-gray-300 hover:text-white hover:border-blue-500/40 text-xs transition-colors"
          >
            <RefreshCw size={14} className={marketLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-2xl border border-[#2a2a3a] p-5" style={{ background: "#13131a" }}>
            <p className="text-xs text-gray-500 mb-1">Total Collateral</p>
            {hfLoading ? <div className="w-20 h-7 rounded-lg bg-gray-800 animate-pulse" /> : <p className="text-xl font-bold text-white">${totalCollateralUSD.toFixed(4)}</p>}
          </div>
          <div className="rounded-2xl border border-[#2a2a3a] p-5" style={{ background: "#13131a" }}>
            <p className="text-xs text-gray-500 mb-1">Total Debt</p>
            {hfLoading ? <div className="w-20 h-7 rounded-lg bg-gray-800 animate-pulse" /> : <p className="text-xl font-bold text-purple-400">${totalDebtUSD.toFixed(4)}</p>}
          </div>
          <div className="rounded-2xl border border-[#2a2a3a] p-5" style={{ background: "#13131a" }}>
            <p className="text-xs text-gray-500 mb-1">Available Borrow</p>
            {hfLoading ? <div className="w-20 h-7 rounded-lg bg-gray-800 animate-pulse" /> : <p className="text-xl font-bold text-emerald-400">${availableBorrowUSD.toFixed(4)}</p>}
          </div>
          <div className="rounded-2xl border border-[#2a2a3a] p-5" style={{ background: "#13131a" }}>
            <p className="text-xs text-gray-500 mb-1">Health Factor</p>
            {hfLoading ? (
              <div className="w-20 h-7 rounded-lg bg-gray-800 animate-pulse" />
            ) : (
              <div>
                <span className={`text-2xl font-bold ${hfColor(healthFactor)}`}>
                  {healthFactor !== null && healthFactor <= 100 ? healthFactor.toFixed(2) : "—"}
                </span>
                {healthFactor !== null && healthFactor < 1.0 && (
                  <div className="mt-1 flex items-center gap-1 text-red-400 text-xs"><AlertTriangle size={12} />Liquidation risk!</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Borrow Limit Bar */}
        <div className="rounded-2xl border border-[#2a2a3a] p-5 mb-8" style={{ background: "#13131a" }}>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Borrow Limit Used</span>
            <span className="text-white font-semibold">{borrowLimitUsed.toFixed(4)}%</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-[#2a2a3a] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${borrowLimitUsed > 80 ? "bg-red-500" : borrowLimitUsed > 50 ? "bg-yellow-500" : "bg-purple-500"}`}
              style={{ width: `${borrowLimitUsed}%` }}
            />
          </div>
        </div>

        {/* Borrow Markets Table */}
        <div className="rounded-2xl border border-[#2a2a3a] overflow-hidden" style={{ background: "#13131a" }}>
          <div className="p-5 border-b border-[#2a2a3a]">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ArrowDownLeft size={18} className="text-purple-400" /> Supported Borrow Assets
            </h2>
          </div>
          {!isConnected ? (
            <div className="p-8 text-center text-gray-500 text-sm">Connect wallet to view borrow positions and markets.</div>
          ) : (
            <div className="divide-y divide-[#1a1a2e]">
              {markets.map((m) => (
                <div key={m.token.address} className="flex flex-col sm:flex-row sm:items-center justify-between p-5 hover:bg-white/[0.02] transition-colors gap-4">
                  <div className="flex items-center gap-3">
                    <TokenLogo symbol={m.token.symbol} size={36} />
                    <div>
                      <div className="text-sm font-semibold text-white">{m.token.symbol}</div>
                      <div className="text-xs text-gray-500">{m.token.name}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-6 text-left sm:text-right">
                    <div>
                      <div className="text-xs text-gray-500">Borrow APY</div>
                      <div className="text-sm font-semibold text-purple-400">{m.borrowApy}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Total Borrowed</div>
                      <div className="text-sm font-medium text-gray-200">{m.totalBorrowedFormatted} {m.token.symbol}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Your Debt</div>
                      <div className="text-sm font-medium text-purple-300">{m.userBorrowFormatted} {m.token.symbol}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:justify-end">
                    <button
                      onClick={() => { setBorrowModal(m); setBorrowAmount(""); }}
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors min-h-[38px]"
                    >
                      Borrow
                    </button>
                    {m.userBorrowAmount > BigInt(0) && (
                      <button
                        onClick={() => { setRepayModal(m); setRepayAmount(""); }}
                        className="px-4 py-2 rounded-xl border border-purple-500/40 text-purple-300 hover:bg-purple-500/10 text-xs font-semibold transition-colors min-h-[38px]"
                      >
                        Repay
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Borrow Modal */}
      {borrowModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setBorrowModal(null)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative w-full sm:w-[420px] rounded-2xl border border-[#2a2a3a] p-5 shadow-2xl z-10" style={{ background: "#13131a" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">Borrow {borrowModal.token.symbol}</h2>
              <button onClick={() => setBorrowModal(null)} className="text-gray-400 hover:text-white p-1"><X size={18} /></button>
            </div>
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-gray-400 font-medium">Amount</label>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400">
                    Max Borrow Limit: ${availableBorrowUSD.toFixed(4)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl border border-[#2a2a3a] focus-within:border-purple-500/50" style={{ background: "#1c1c26" }}>
                <TokenLogo symbol={borrowModal.token.symbol} size={28} />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(validateAmount(e.target.value))}
                  className="flex-1 bg-transparent text-white text-lg font-semibold outline-none"
                  autoFocus
                />
                <span className="text-gray-400 text-sm">{borrowModal.token.symbol}</span>
              </div>
            </div>
            <div className="rounded-xl p-3 border border-[#2a2a3a] space-y-2 mb-4">
              <div className="flex justify-between text-sm"><span className="text-gray-500">Borrow APY</span><span className="text-purple-400 font-semibold">{borrowModal.borrowApy}%</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-500">Available USD</span><span className="text-gray-300">${availableBorrowUSD.toFixed(4)}</span></div>
              {borrowAmount && parseFloat(borrowAmount) > 0 && (
                <div className="flex justify-between text-sm border-t border-[#2a2a3a] pt-2">
                  <span className="text-gray-500">New Health Factor</span>
                  <span className={hfColor(previewHF)}>
                    {previewHF !== null && previewHF <= 100 ? previewHF.toFixed(2) : "—"}
                  </span>
                </div>
              )}
            </div>
            {borrowRisk && (
              <div className={`mb-4 flex items-center gap-2 p-3 rounded-xl text-xs ${borrowLiqRisk ? "bg-red-500/10 border border-red-500/20 text-red-400" : "bg-yellow-500/10 border border-yellow-500/20 text-yellow-400"}`}>
                <AlertTriangle size={14} />
                {borrowLiqRisk ? "This borrow would risk immediate liquidation!" : "Health factor would drop below 1.2."}
              </div>
            )}
            <button
              onClick={handleBorrowSubmit}
              disabled={!borrowAmount || parseFloat(borrowAmount) === 0 || borrowLiqRisk || submitting}
              className="w-full py-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-[#2a2a3a] disabled:text-gray-500 text-white font-semibold transition-colors min-h-[52px] flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>{statusMessage || "Borrowing..."}</span>
                </>
              ) : borrowLiqRisk ? (
                "Borrowing risks liquidation"
              ) : (
                `Borrow ${borrowModal.token.symbol}`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Repay Modal */}
      {repayModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setRepayModal(null)}>
          <div className="absolute inset-0 bg-black/70" />
          <div className="relative w-full sm:w-[420px] rounded-2xl border border-[#2a2a3a] p-5 shadow-2xl z-10" style={{ background: "#13131a" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-white">Repay {repayModal.token.symbol}</h2>
              <button onClick={() => setRepayModal(null)} className="text-gray-400 hover:text-white p-1"><X size={18} /></button>
            </div>
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-gray-400 font-medium">Amount</label>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400">
                    Debt: {repayModal.userBorrowFormatted} | Wallet: {walletBalance}
                  </span>
                  {parseFloat(repayModal.userBorrowFormatted) > 0 && (
                    <button
                      type="button"
                      onClick={() => setRepayAmount(repayModal.userBorrowFormatted)}
                      className="text-purple-400 font-semibold hover:text-purple-300 transition-colors"
                    >
                      MAX
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl border border-[#2a2a3a] focus-within:border-purple-500/50" style={{ background: "#1c1c26" }}>
                <TokenLogo symbol={repayModal.token.symbol} size={28} />
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(validateAmount(e.target.value))}
                  className="flex-1 bg-transparent text-white text-lg font-semibold outline-none"
                  autoFocus
                />
                <span className="text-gray-400 text-sm">{repayModal.token.symbol}</span>
              </div>
            </div>
            <button
              onClick={handleRepaySubmit}
              disabled={!repayAmount || parseFloat(repayAmount) === 0 || submitting}
              className="w-full py-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:bg-[#2a2a3a] disabled:text-gray-500 text-white font-semibold transition-colors min-h-[52px] flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>{statusMessage || "Repaying..."}</span>
                </>
              ) : (
                `Repay ${repayModal.token.symbol}`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border text-sm max-w-sm w-[calc(100%-2rem)] ${toast.type === "success" ? "bg-green-500/10 border-green-500/30 text-green-300" : toast.type === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-purple-500/10 border-purple-500/30 text-purple-300"}`}>
          {toast.type === "pending" && <Loader2 size={16} className="animate-spin flex-shrink-0" />}
          {toast.type === "success" && <CheckCircle size={16} className="flex-shrink-0" />}
          {toast.type === "error" && <AlertTriangle size={16} className="flex-shrink-0" />}
          <span className="flex-1">{toast.message}</span>
          {toast.txHash && <a href={`${ARC_EXPLORER}/tx/${toast.txHash}`} target="_blank" rel="noopener noreferrer" className="text-xs opacity-70 hover:opacity-100 flex-shrink-0 flex items-center gap-1">Arcscan <ExternalLink size={10} /></a>}
          <button onClick={() => setToast(null)} className="opacity-50 hover:opacity-100"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
