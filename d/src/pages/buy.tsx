'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  useAccount,
  useBalance,
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import {
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  type Hash,
} from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, TOKEN_ABI } from '@/config/abis';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────
type Currency = 'ETH' | 'USDC' | 'USDT' | 'DAI';
type Step = 'idle' | 'approving' | 'waitingApprove' | 'buying' | 'waitingBuy';

const CURRENCIES = [
  {
    value: 'ETH' as Currency,
    label: 'ETH',
    icon: '⟠',
    address: null as `0x${string}` | null,
    decimals: 18,
  },
  {
    value: 'USDC' as Currency,
    label: 'USDC',
    icon: '$',
    address: CURRENT_CONTRACTS.USDC as `0x${string}`,
    decimals: 6,
  },
  {
    value: 'USDT' as Currency,
    label: 'USDT',
    icon: '₮',
    address: CURRENT_CONTRACTS.USDT as `0x${string}`,
    decimals: 6,
  },
  {
    value: 'DAI' as Currency,
    label: 'DAI',
    icon: '◈',
    address: CURRENT_CONTRACTS.DAI as `0x${string}`,
    decimals: 18,
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatLargeNumber(value: bigint, decimals = 18): string {
  const num = parseFloat(formatUnits(value, decimals));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00:00';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseContractError(err: unknown): string {
  const msg = ((err as { shortMessage?: string; message?: string })?.shortMessage ||
    (err as { message?: string })?.message ||
    ''
  ).toLowerCase();

  if (msg.includes('user rejected') || msg.includes('denied')) return 'Transaction rejected by user.';
  if (msg.includes('insufficient')) return 'Insufficient balance.';
  if (msg.includes('cooldown')) return 'Please wait for cooldown period to end.';
  if (msg.includes('walletcap') || msg.includes('wallet cap') || msg.includes('exceedswallet'))
    return 'Purchase exceeds your wallet cap.';
  if (msg.includes('salecap') || msg.includes('sale cap') || msg.includes('exceedssale'))
    return 'Purchase exceeds the total sale cap.';
  if (msg.includes('minpurchase') || msg.includes('belowmin'))
    return 'Amount is below the minimum purchase.';
  if (msg.includes('salenotactive') || msg.includes('sale not active'))
    return 'Sale is not currently active.';
  if (msg.includes('insufficienttokensinvesting'))
    return 'Not enough tokens available in vesting pool.';
  if (msg.includes('currencynotsupported'))
    return 'Selected currency is not supported.';
  return 'Transaction failed. Please try again.';
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BuyPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient();

  const [currency, setCurrency] = useState<Currency>('ETH');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [approveTxHash, setApproveTxHash] = useState<Hash | null>(null);
  const [buyTxHash, setBuyTxHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const selected = CURRENCIES.find((c) => c.value === currency)!;
  const isLoading = step !== 'idle';

  // ── Contract Reads ──────────────────────────────────────────────────────────
  const { data: ethBalance } = useBalance({ address });

  const { data: tokenBalance, refetch: refetchTokenBalance } = useReadContract({
    address: selected.address ?? undefined,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!selected.address && !!address },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: selected.address ?? undefined,
    abi: TOKEN_ABI,
    functionName: 'allowance',
    args: address && selected.address ? [address, CURRENT_CONTRACTS.SALE as `0x${string}`] : undefined,
    query: { enabled: !!selected.address && !!address },
  });

  const { data: preview } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'previewTokenAmount',
    args:
      amount && parseFloat(amount) > 0
        ? [
            selected.address ?? '0x0000000000000000000000000000000000000000',
            currency === 'ETH'
              ? parseEther(amount)
              : parseUnits(amount, selected.decimals),
          ]
        : undefined,
    query: { enabled: !!amount && parseFloat(amount) > 0 },
  });

  // Sale global stats
  const { data: saleState } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'getSaleState',
  });

  const { data: totalSold, refetch: refetchTotalSold } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'totalSold',
  });

  const { data: saleCap } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'saleCap',
  });

  const { data: saleEnd } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'saleEnd',
  });

  const { data: totalBuyers } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'totalBuyers',
  });

  const { data: tokenPrice } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'tokenPrice',
  });

  // User-specific info
  const { data: purchaseInfo, refetch: refetchPurchaseInfo } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'getPurchaseInfo',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // ── Write Contracts ─────────────────────────────────────────────────────────
  const { writeContractAsync: approveToken } = useWriteContract();
  const { writeContractAsync: buyWithERC20 } = useWriteContract();
  const { writeContractAsync: buyWithEth } = useWriteContract();

  // ── Wait for Receipts ───────────────────────────────────────────────────────
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveTxHash ?? undefined,
    query: { enabled: !!approveTxHash },
  });

  const { isSuccess: buySuccess } = useWaitForTransactionReceipt({
    hash: buyTxHash ?? undefined,
    query: { enabled: !!buyTxHash },
  });

  // ── Effects ─────────────────────────────────────────────────────────────────

  // When approve confirmed → update step
  useEffect(() => {
    if (approveSuccess && step === 'waitingApprove') {
      setStep('idle');
      refetchAllowance();
      setSuccessMsg('Approval confirmed! You can now proceed to buy.');
    }
  }, [approveSuccess, step, refetchAllowance]);

  // When buy confirmed → success
  useEffect(() => {
    if (buySuccess && step === 'waitingBuy') {
      setStep('idle');
      setAmount('');
      refetchTotalSold();
      refetchPurchaseInfo();
      refetchTokenBalance();
      setSuccessMsg('Purchase successful! Tokens are now in your vesting schedule.');
    }
  }, [buySuccess, step, refetchTotalSold, refetchPurchaseInfo, refetchTokenBalance]);

  // Countdown timer for sale end
  useEffect(() => {
    if (!saleEnd) return;
    const endTime = Number(saleEnd as bigint);
    const update = () => {
      const remaining = endTime - Math.floor(Date.now() / 1000);
      setCountdown(Math.max(0, remaining));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [saleEnd]);

  // Cooldown timer for user
  useEffect(() => {
    if (!purchaseInfo) return;
    const [, , , cooldownRemaining] = purchaseInfo as [bigint, bigint, bigint, bigint];
    const update = () => {
      setCooldownLeft(Math.max(0, Number(cooldownRemaining)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [purchaseInfo]);

  // ── Derived Values ──────────────────────────────────────────────────────────
  const needsApproval = (): boolean => {
    if (currency === 'ETH') return false;
    if (!amount || parseFloat(amount) <= 0) return false;
    if (!allowance) return true;
    const needed = parseUnits(amount, selected.decimals);
    return (allowance as bigint) < needed;
  };

  const saleProgress =
    totalSold && saleCap && (saleCap as bigint) > 0n
      ? Math.min(100, (Number(formatUnits(totalSold as bigint, 18)) / Number(formatUnits(saleCap as bigint, 18))) * 100)
      : 0;

  const saleStateLabel = (() => {
    if (saleState === undefined) return { text: 'Loading...', color: 'text-zinc-400' };
    const s = Number(saleState);
    if (s === 0) return { text: 'Inactive', color: 'text-zinc-400' };
    if (s === 1) return { text: 'Active', color: 'text-emerald-400' };
    return { text: 'Ended', color: 'text-red-400' };
  })();

  const formatBalance = (): string => {
    if (currency === 'ETH') {
      return ethBalance ? parseFloat(formatEther(ethBalance.value)).toFixed(4) : '0.0000';
    }
    return tokenBalance
      ? parseFloat(formatUnits(tokenBalance as bigint, selected.decimals)).toFixed(4)
      : '0.0000';
  };

  const getButtonText = (): string => {
    if (!isConnected) return 'Connect Wallet';
    if (step === 'approving') return 'Sending Approval...';
    if (step === 'waitingApprove') return 'Waiting for Confirmation...';
    if (step === 'buying') return 'Sending Transaction...';
    if (step === 'waitingBuy') return 'Waiting for Confirmation...';
    if (needsApproval()) return `Approve ${currency}`;
    return 'Buy FOR Token';
  };

  const isButtonDisabled =
    isLoading ||
    !amount ||
    parseFloat(amount) <= 0 ||
    (isConnected && cooldownLeft > 0 && !needsApproval());

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleApprove = async () => {
    if (!isConnected || !selected.address) return;
    setError(null);
    setSuccessMsg(null);
    try {
      setStep('approving');
      const tokenAmount = parseUnits(amount, selected.decimals);
      const hash = await approveToken({
        address: selected.address,
        abi: TOKEN_ABI,
        functionName: 'approve',
        args: [CURRENT_CONTRACTS.SALE as `0x${string}`, tokenAmount],
      });
      setApproveTxHash(hash);
      setStep('waitingApprove');
    } catch (err) {
      setError(parseContractError(err));
      setStep('idle');
    }
  };

  const handleBuy = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (needsApproval()) {
      await handleApprove();
      return;
    }
    setError(null);
    setSuccessMsg(null);
    try {
      setStep('buying');
      let hash: Hash;
      if (currency === 'ETH') {
        hash = await buyWithEth({
          address: CURRENT_CONTRACTS.SALE as `0x${string}`,
          abi: SALE_ABI,
          functionName: 'purchaseWithEth',
          value: parseEther(amount),
        });
      } else {
        hash = await buyWithERC20({
          address: CURRENT_CONTRACTS.SALE as `0x${string}`,
          abi: SALE_ABI,
          functionName: 'purchaseWithERC20',
          args: [selected.address!, parseUnits(amount, selected.decimals)],
        });
      }
      setBuyTxHash(hash);
      setStep('waitingBuy');
    } catch (err) {
      setError(parseContractError(err));
      setStep('idle');
    }
  };

  const handleCurrencyChange = (c: Currency) => {
    setCurrency(c);
    setAmount('');
    setError(null);
    setSuccessMsg(null);
  };

  const handleMaxAmount = () => {
    if (currency === 'ETH' && ethBalance) {
      const max = Math.max(0, parseFloat(formatEther(ethBalance.value)) - 0.005);
      setAmount(max.toFixed(6));
    } else if (tokenBalance) {
      setAmount(formatUnits(tokenBalance as bigint, selected.decimals));
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="py-8 px-4">
      {/* ── Page Title ── */}
      <motion.h1
        className="text-3xl md:text-4xl font-bold text-teal-400 text-center mb-2"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Buy FOR Token
      </motion.h1>
      <motion.p
        className="text-zinc-400 text-center mb-8 text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.1 } }}
      >
        Participate in the token sale — tokens vest over 4 months
      </motion.p>

      <div className="max-w-lg mx-auto space-y-4">

        {/* ── Sale Stats Banner ── */}
        <motion.div
          className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.05 } }}
        >
          <div className="grid grid-cols-3 gap-4 mb-4">
            {/* Status */}
            <div className="text-center">
              <p className="text-xs text-zinc-500 mb-1">Status</p>
              <div className="flex items-center justify-center gap-1.5">
                {saleState !== undefined && Number(saleState) === 1 && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
                <span className={`text-sm font-semibold ${saleStateLabel.color}`}>
                  {saleStateLabel.text}
                </span>
              </div>
            </div>
            {/* Buyers */}
            <div className="text-center">
              <p className="text-xs text-zinc-500 mb-1">Participants</p>
              <p className="text-sm font-semibold text-white">
                {totalBuyers !== undefined ? Number(totalBuyers as bigint).toLocaleString() : '—'}
              </p>
            </div>
            {/* Countdown */}
            <div className="text-center">
              <p className="text-xs text-zinc-500 mb-1">Time Left</p>
              <p className="text-sm font-semibold text-teal-300 font-mono">
                {saleEnd ? formatCountdown(countdown) : '—'}
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
              <span>
                Sold:{' '}
                <span className="text-zinc-300">
                  {totalSold ? formatLargeNumber(totalSold as bigint) : '0'} FOR
                </span>
              </span>
              <span>
                Cap:{' '}
                <span className="text-zinc-300">
                  {saleCap ? formatLargeNumber(saleCap as bigint) : '—'} FOR
                </span>
              </span>
            </div>
            <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-teal-600 to-teal-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${saleProgress}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
            <p className="text-right text-xs text-zinc-500 mt-1">{saleProgress.toFixed(1)}% filled</p>
          </div>
        </motion.div>

        {/* ── Currency Selection ── */}
        <motion.div
          className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
        >
          <label className="block text-sm text-zinc-400 mb-3">Pay With</label>
          <div className="grid grid-cols-4 gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c.value}
                onClick={() => handleCurrencyChange(c.value)}
                className={`p-3 rounded-lg text-sm font-medium transition-all border ${
                  currency === c.value
                    ? 'bg-teal-500/20 text-teal-300 border-teal-500'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                <span className="block text-lg mb-1 font-mono">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* ── Amount Input ── */}
        <motion.div
          className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }}
        >
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-zinc-400">Amount ({currency})</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">
                Balance: <span className="text-zinc-300">{formatBalance()} {currency}</span>
              </span>
              <button
                onClick={handleMaxAmount}
                className="text-xs text-teal-400 hover:text-teal-300 border border-teal-700 hover:border-teal-500 px-2 py-0.5 rounded transition-colors"
              >
                MAX
              </button>
            </div>
          </div>

          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
                setSuccessMsg(null);
              }}
              placeholder="0.00"
              className="w-full p-4 pr-16 rounded-lg bg-zinc-950 text-white text-xl border border-zinc-700 focus:border-teal-500 focus:outline-none transition-colors"
              min="0"
              step="0.001"
              disabled={isLoading}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-medium">
              {currency}
            </span>
          </div>

          {/* Token Preview */}
          <AnimatePresence>
            {preview && parseFloat(amount) > 0 && (
              <motion.div
                className="mt-4 p-4 bg-teal-900/20 border border-teal-700/40 rounded-lg"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <p className="text-xs text-zinc-400 mb-1">You will receive</p>
                <p className="text-2xl font-bold text-teal-300">
                  {formatLargeNumber(preview as bigint)} FOR
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-zinc-800/60 rounded-lg p-2 text-center">
                    <p className="text-zinc-400">Immediately (25%)</p>
                    <p className="text-teal-400 font-semibold mt-0.5">
                      {formatLargeNumber((preview as bigint) / 4n)} FOR
                    </p>
                  </div>
                  <div className="bg-zinc-800/60 rounded-lg p-2 text-center">
                    <p className="text-zinc-400">Vested (75%)</p>
                    <p className="text-teal-400 font-semibold mt-0.5">
                      {formatLargeNumber(((preview as bigint) * 3n) / 4n)} FOR
                    </p>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mt-2 text-center">
                  Remaining 75% vested in 3 equal monthly tranches
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Approval Status Indicator */}
          {currency !== 'ETH' && amount && parseFloat(amount) > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  needsApproval() ? 'bg-yellow-500' : 'bg-emerald-500'
                }`}
              />
              <span className={needsApproval() ? 'text-yellow-400' : 'text-emerald-400'}>
                {needsApproval()
                  ? `Approval required before purchase`
                  : `${currency} approved for purchase`}
              </span>
            </div>
          )}
        </motion.div>

        {/* ── User Info (if connected) ── */}
        {isConnected && purchaseInfo && (
          <motion.div
            className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }}
          >
            <p className="text-sm text-zinc-400 mb-3">Your Purchase Info</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <p className="text-zinc-500">Total Purchased</p>
                <p className="text-white font-semibold mt-1">
                  {formatLargeNumber((purchaseInfo as [bigint, bigint, bigint, bigint])[0])} FOR
                </p>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <p className="text-zinc-500">Remaining Cap</p>
                <p className="text-white font-semibold mt-1">
                  {formatLargeNumber((purchaseInfo as [bigint, bigint, bigint, bigint])[1])} FOR
                </p>
              </div>
            </div>
            {cooldownLeft > 0 && (
              <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-2.5">
                <span>⏱</span>
                <span>Cooldown: {formatCountdown(cooldownLeft)} remaining</span>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Step Indicator (for 2-step ERC20 flow) ── */}
        {currency !== 'ETH' && amount && parseFloat(amount) > 0 && (
          <motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {/* Step 1 */}
            <div className={`flex-1 flex items-center gap-2 p-2.5 rounded-lg text-xs border ${
              !needsApproval()
                ? 'bg-emerald-900/20 border-emerald-700/40 text-emerald-400'
                : step === 'approving' || step === 'waitingApprove'
                ? 'bg-yellow-900/20 border-yellow-700/40 text-yellow-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                !needsApproval() ? 'bg-emerald-500 text-black' : 'bg-zinc-600 text-white'
              }`}>
                {!needsApproval() ? '✓' : '1'}
              </span>
              <span>Approve {currency}</span>
            </div>
            <div className="text-zinc-600">→</div>
            {/* Step 2 */}
            <div className={`flex-1 flex items-center gap-2 p-2.5 rounded-lg text-xs border ${
              step === 'buying' || step === 'waitingBuy'
                ? 'bg-teal-900/20 border-teal-700/40 text-teal-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                step === 'buying' || step === 'waitingBuy' ? 'bg-teal-500 text-black' : 'bg-zinc-600 text-white'
              }`}>
                2
              </span>
              <span>Buy FOR</span>
            </div>
          </motion.div>
        )}

        {/* ── Main Action Button ── */}
        <button
          onClick={handleBuy}
          disabled={isButtonDisabled}
          className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
            isButtonDisabled
              ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              : !isConnected
              ? 'bg-zinc-700 hover:bg-zinc-600 text-white active:scale-95'
              : needsApproval()
              ? 'bg-yellow-600 hover:bg-yellow-500 text-white active:scale-95'
              : 'bg-teal-500 hover:bg-teal-400 text-black active:scale-95'
          }`}
        >
          {isLoading && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {getButtonText()}
        </button>

        {/* ── Error Message ── */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="p-4 bg-red-900/40 border border-red-700/60 rounded-xl text-red-300 text-sm text-center"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Success Message ── */}
        <AnimatePresence>
          {successMsg && (
            <motion.div
              className="p-4 bg-emerald-900/40 border border-emerald-700/60 rounded-xl text-emerald-300 text-sm"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <p className="font-semibold mb-1">{successMsg}</p>
              {buyTxHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${buyTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline hover:text-emerald-200 break-all block mt-1"
                >
                  View on Etherscan ↗
                </a>
              )}
              {approveTxHash && !buyTxHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${approveTxHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline hover:text-emerald-200 break-all block mt-1"
                >
                  View approval on Etherscan ↗
                </a>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Pending TX Notification ── */}
        <AnimatePresence>
          {(step === 'waitingApprove' || step === 'waitingBuy') && (
            <motion.div
              className="p-3 bg-blue-900/30 border border-blue-700/40 rounded-xl text-blue-300 text-xs text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              Transaction submitted. Waiting for blockchain confirmation...
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Info Note ── */}
        <motion.div
          className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl text-zinc-500 text-xs space-y-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.3 } }}
        >
          <p>• Purchased tokens follow a <span className="text-zinc-300">4-tranche vesting schedule</span>: 25% released immediately after cliff, then 25% each month for 3 months.</p>
          <p>• A short <span className="text-zinc-300">cooldown period</span> applies between purchases.</p>
          <p>• All payments are sent directly to the project treasury.</p>
        </motion.div>

      </div>
    </div>
  );
}
