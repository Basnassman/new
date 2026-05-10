'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, type Hash } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import Calculator, { type Currency } from '@/components/Calculator';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, TOKEN_ABI } from '@/config/abis';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatLargeNumber(value: bigint, decimals = 18): string {
  const num = parseFloat(formatUnits(value, decimals));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Ended';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h.toString().padStart(2, '0')}h`;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseContractError(err: unknown): string {
  const errorObj = err as Record<string, any>;
  const msg = (errorObj?.shortMessage || errorObj?.message || '').toLowerCase();

  console.error('Transaction Error Details:', {
    shortMessage: errorObj?.shortMessage,
    message: errorObj?.message,
    cause: errorObj?.cause,
  });

  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction rejected by user.';
  if (msg.includes('insufficient balance')) return 'Insufficient balance for this transaction.';
  if (msg.includes('exceeds wallet cap')) return 'Purchase exceeds your wallet cap.';
  if (msg.includes('exceeds sale cap')) return 'Purchase exceeds remaining sale cap.';
  if (msg.includes('sale not active')) return 'Sale is not currently active.';
  if (msg.includes('cooldown')) return 'You must wait before making another purchase.';
  if (msg.includes('minimum purchase')) return 'Amount is below minimum purchase.';
  if (msg.includes('insufficient allowance')) return 'Please approve the token first.';
  if (msg.includes('execution reverted')) return 'Transaction failed. Check your balance and try again.';

  return 'Transaction failed. Please check your inputs and try again.';
}

// ─── Sale States ──────────────────────────────────────────────────────────
const SALE_STATES: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'Inactive', color: 'text-zinc-400', bg: 'bg-zinc-800' },
  1: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-900/20' },
  2: { label: 'Ended', color: 'text-red-400', bg: 'bg-red-900/20' },
};

type TransactionStep = 'idle' | 'approving' | 'approved' | 'purchasing' | 'waiting';

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BuyPage() {
  const { address, isConnected } = useAccount();

  const [txHash, setTxHash] = useState<Hash | null>(null);
  const [step, setStep] = useState<TransactionStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('ETH');

  // ── Contract Reads ────────────────────────────────────────────────────────────
  const { data: saleState } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'getSaleState',
    query: { refetchInterval: 30000 },
  });

  const { data: totalSold } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'totalSold',
    query: { refetchInterval: 30000 },
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
    query: { refetchInterval: 60000 },
  });

  const { data: remainingSaleCap } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'remainingSaleCap',
    query: { refetchInterval: 30000 },
  });

  // ── User Info ─────────────────────────────────────────────────────────────────
  const { data: purchaseInfo, refetch: refetchPurchaseInfo } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'getPurchaseInfo',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30000 },
  });

  // Get user's token balance (for ERC20 purchases)
  const { data: userTokenBalance, refetch: refetchTokenBalance } = useReadContract({
    address: selectedCurrency !== 'ETH'
      ? ({
          ETH: undefined,
          USDT: CURRENT_CONTRACTS.USDT,
          USDC: CURRENT_CONTRACTS.USDC,
          DAI: CURRENT_CONTRACTS.DAI,
        }[selectedCurrency] as `0x${string}` | undefined)
      : undefined,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && selectedCurrency !== 'ETH', refetchInterval: 15000 },
  });

  // Get allowance for ERC20 tokens
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: selectedCurrency !== 'ETH'
      ? ({
          ETH: undefined,
          USDT: CURRENT_CONTRACTS.USDT,
          USDC: CURRENT_CONTRACTS.USDC,
          DAI: CURRENT_CONTRACTS.DAI,
        }[selectedCurrency] as `0x${string}` | undefined)
      : undefined,
    abi: TOKEN_ABI,
    functionName: 'allowance',
    args: address ? [address, CURRENT_CONTRACTS.SALE as `0x${string}`] : undefined,
    query: { enabled: !!address && selectedCurrency !== 'ETH', refetchInterval: 15000 },
  });

  // ── Write Contracts ───────────────────────────────────────────────────────────
  const { writeContractAsync: approve } = useWriteContract();
  const { writeContractAsync: purchaseWithEth } = useWriteContract();
  const { writeContractAsync: purchaseWithErc20 } = useWriteContract();

  const { isSuccess: txConfirmed, isLoading: txIsWaiting } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: { enabled: !!txHash },
  });

  // ── Effects ───────────────────────────────────────────────────────────────────

  // Countdown timer
  useEffect(() => {
    if (!saleEnd) return;
    const end = Number(saleEnd as bigint);
    const update = () => setCountdown(Math.max(0, end - Math.floor(Date.now() / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [saleEnd]);

  // On transaction confirmed
  useEffect(() => {
    if (txConfirmed && step === 'waiting') {
      setStep('idle');
      setSuccess(true);
      setTimeout(() => {
        refetchPurchaseInfo();
        refetchTokenBalance();
        refetchAllowance();
      }, 1000);
    }
  }, [txConfirmed, step, refetchPurchaseInfo, refetchTokenBalance, refetchAllowance]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleBuy = useCallback(
    async (data: {
      currency: Currency;
      tokenAmount: bigint;
      currencyAmount: bigint;
    }) => {
      setError(null);
      setSuccess(false);
      setSelectedCurrency(data.currency);

      try {
        if (data.currency === 'ETH') {
          console.log('Starting ETH purchase:', {
            amount: formatUnits(data.currencyAmount, 18),
            tokenAmount: formatUnits(data.tokenAmount, 18),
          });

          setStep('purchasing');
          const purchaseTx = await purchaseWithEth({
            address: CURRENT_CONTRACTS.SALE as `0x${string}`,
            abi: SALE_ABI,
            functionName: 'purchaseWithEth',
            value: data.currencyAmount,
             gas: 500000n,
          });
          console.log('ETH purchase tx:', purchaseTx);
          setTxHash(purchaseTx);
          setStep('waiting');
        } else {
          const currencyAddress = {
            ETH: undefined,
            USDT: CURRENT_CONTRACTS.USDT,
            USDC: CURRENT_CONTRACTS.USDC,
            DAI: CURRENT_CONTRACTS.DAI,
          }[data.currency] as `0x${string}`;

          console.log('Starting ERC20 purchase:', {
            currency: data.currency,
            address: currencyAddress,
            amount: formatUnits(data.currencyAmount, 6),
            tokenAmount: formatUnits(data.tokenAmount, 18),
          });

          if (!allowance || allowance < data.currencyAmount) {
            console.log('Approval needed. Current allowance:', allowance ? formatUnits(allowance, 6) : '0');
            setStep('approving');
            const approveTx = await approve({
              address: currencyAddress,
              abi: TOKEN_ABI,
              functionName: 'approve',
              args: [CURRENT_CONTRACTS.SALE as `0x${string}`, data.currencyAmount],
            });
            console.log('Approval tx:', approveTx);
            setTxHash(approveTx);
            setStep('approved');
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await refetchAllowance();
          } else {
            console.log('Approval not needed. Current allowance:', formatUnits(allowance, 6));
            setStep('approved');
          }

          setStep('purchasing');
          const purchaseTx = await purchaseWithErc20({
            address: CURRENT_CONTRACTS.SALE as `0x${string}`,
            abi: SALE_ABI,
            functionName: 'purchaseWithERC20',
            args: [currencyAddress, data.currencyAmount],
          });
          console.log('ERC20 purchase tx:', purchaseTx);
          setTxHash(purchaseTx);
          setStep('waiting');
        }
      } catch (err) {
        const errorMsg = parseContractError(err);
        console.error('Purchase error:', err);
        setError(errorMsg);
        setStep('idle');
      }
    },
    [approve, purchaseWithEth, purchaseWithErc20, allowance, refetchAllowance]
  );

  // ── Derived Values ────────────────────────────────────────────────────────────
  const stateInfo = SALE_STATES[Number(saleState ?? 0)] ?? SALE_STATES[0];
  const isActive = Number(saleState) === 1;
  const salesProgress =
    totalSold && saleCap && (saleCap as bigint) > BigInt(0)
      ? Math.min(100, (Number(formatUnits(totalSold as bigint, 18)) / Number(formatUnits(saleCap as bigint, 18))) * 100)
      : 0;

  const userPurchased = purchaseInfo?.[0] ?? BigInt(0);
  const userRemainingCap = purchaseInfo?.[1] ?? BigInt(0);
  const cooldownRemaining = purchaseInfo?.[3] ?? BigInt(0);

  const userBalance = selectedCurrency === 'ETH' ? undefined : userTokenBalance;
  const isLoading = step !== 'idle' || txIsWaiting;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="py-12 px-4 min-h-screen bg-black">
      <motion.div
        className="max-w-6xl mx-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* ── Title ── */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-4xl md:text-5xl font-bold text-teal-400 mb-2">FOR Token Sale</h1>
          <p className="text-zinc-400">Secure your allocation in the FOR ecosystem</p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── Left: Sale Stats ── */}
          <motion.div
            className="lg:col-span-2 space-y-4"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0, transition: { delay: 0.1 } }}
          >
            {/* Status Card */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">Sale Status</h2>
                <div
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${stateInfo.bg} ${stateInfo.color}`}
                >
                  {isActive && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
                  {stateInfo.label}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="text-center">
                  <p className="text-xs text-zinc-500 mb-1">Total Sold</p>
                  <p className="text-lg font-bold text-teal-300">
                    {totalSold ? formatLargeNumber(totalSold as bigint) : '—'} FOR
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-zinc-500 mb-1">Cap</p>
                  <p className="text-lg font-bold text-white">
                    {saleCap ? formatLargeNumber(saleCap as bigint) : '—'} FOR
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-zinc-500 mb-1">Buyers</p>
                  <p className="text-lg font-bold text-emerald-400">
                    {totalBuyers ? Number(totalBuyers as bigint).toLocaleString() : '—'}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-2">
                  <span>Progress</span>
                  <span>{salesProgress.toFixed(1)}%</span>
                </div>
                <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-teal-600 to-teal-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${salesProgress}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                  />
                </div>
              </div>

              {/* Countdown */}
              {isActive && (
                <div className="mt-4 p-3 bg-teal-900/20 border border-teal-700/40 rounded-lg text-center">
                  <p className="text-xs text-zinc-500 mb-1">Sale Ends In</p>
                  <p className="text-xl font-mono font-bold text-teal-300">{formatCountdown(countdown)}</p>
                </div>
              )}
            </div>

            {/* User Info Card */}
            {isConnected && (
              <motion.div
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.2 } }}
              >
                <h3 className="text-lg font-bold text-white mb-4">Your Purchases</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-xs text-zinc-500 mb-1">Purchased</p>
                    <p className="text-lg font-bold text-emerald-400">
                      {formatLargeNumber(userPurchased)} FOR
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-zinc-500 mb-1">Remaining Cap</p>
                    <p className="text-lg font-bold text-teal-300">
                      {formatLargeNumber(userRemainingCap)} FOR
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-zinc-500 mb-1">Cooldown</p>
                    <p className="text-lg font-bold text-yellow-400">
                      {cooldownRemaining > 0n ? `${Number(cooldownRemaining)}s` : '—'}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Info Box */}
            <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4 text-xs text-zinc-500 space-y-2">
              <p>
                • <span className="text-zinc-300">25% of tokens</span> are released immediately upon purchase.
              </p>
              <p>
                • <span className="text-zinc-300">75% of tokens</span> are allocated to your vesting schedule (180-day
                cliff + 4 tranches).
              </p>
              <p>
                • Purchases are subject to <span className="text-zinc-300">wallet caps and cooldown periods</span>.
              </p>
              <p>
                • Pay with <span className="text-zinc-300">ETH, USDT, USDC, or DAI</span> on Sepolia testnet.
              </p>
            </div>
          </motion.div>

          {/* ── Right: Calculator ── */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0, transition: { delay: 0.1 } }}
          >
            <Calculator
              connected={isConnected}
              onBuy={handleBuy}
              loading={isLoading}
              userBalance={userBalance}
              userPurchased={userPurchased}
              walletCap={userRemainingCap}
            />

            {/* Step Indicator */}
            {isLoading && (
              <motion.div
                className="mt-4 p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <svg className="animate-spin h-4 w-4 text-teal-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span className="text-sm font-medium text-teal-400">
                    {step === 'approving' && 'Approving...'}
                    {step === 'approved' && 'Approved ✓'}
                    {step === 'purchasing' && 'Purchasing...'}
                    {step === 'waiting' && 'Confirming...'}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  {step === 'approving' && 'Waiting for approval confirmation...'}
                  {step === 'approved' && 'Proceeding to purchase...'}
                  {step === 'purchasing' && 'Sending purchase transaction...'}
                  {step === 'waiting' && 'Waiting for blockchain confirmation...'}
                </p>
              </motion.div>
            )}

            {/* Error Message */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className="mt-4 p-4 bg-red-900/40 border border-red-700/60 rounded-xl text-red-300 text-sm text-center"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success Message */}
            <AnimatePresence>
              {success && (
                <motion.div
                  className="mt-4 p-4 bg-emerald-900/40 border border-emerald-700/60 rounded-xl text-emerald-300 text-sm"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <p className="font-semibold mb-1">Purchase Successful! 🎉</p>
                  <p className="text-xs text-emerald-400/80 mb-2">
                    Your tokens have been allocated to your vesting schedule.
                  </p>
                  {txHash && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline hover:text-emerald-200 break-all block"
                    >
                      View on Etherscan ↗
                    </a>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
