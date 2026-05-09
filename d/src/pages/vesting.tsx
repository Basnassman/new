'use client';

import { useState, useEffect } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { formatUnits, type Hash } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { VESTING_ABI } from '@/config/abis';

// ─── Constants (mirrors Vesting.sol) ─────────────────────────────────────────
const CLIFF_PERIOD_DAYS = 180;
const MONTHLY_INTERVAL_DAYS = 30;
const TOTAL_TRANCHES = 4;
const TRANCHE_PERCENTAGE = 25; // 25% each

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatLargeNumber(value: bigint, decimals = 18, fractionDigits = 2): string {
  const num = parseFloat(formatUnits(value, decimals));
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(fractionDigits) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(fractionDigits) + 'K';
  return num.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Available now';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function parseContractError(err: unknown): string {
  const msg = (
    (err as { shortMessage?: string })?.shortMessage ||
    (err as { message?: string })?.message ||
    ''
  ).toLowerCase();
  if (msg.includes('user rejected') || msg.includes('denied')) return 'Transaction rejected by user.';
  if (msg.includes('noallocation')) return 'No vesting allocation found for this address.';
  if (msg.includes('nothingtoclaim')) return 'Nothing to claim at this time.';
  if (msg.includes('cliffnotreached')) return 'Cliff period has not been reached yet.';
  if (msg.includes('claimexpired')) return 'Claim period has expired.';
  return 'Transaction failed. Please try again.';
}

// ─── Tranche Info ─────────────────────────────────────────────────────────────
interface TrancheInfo {
  index: number;
  label: string;
  percentage: number;
  unlockDate: Date;
  amount: bigint;
  status: 'locked' | 'available' | 'claimed';
}

function computeTranches(
  totalAllocation: bigint,
  claimedAmount: bigint,
  projectLaunchTime: number
): TrancheInfo[] {
  const cliffEnd = projectLaunchTime + CLIFF_PERIOD_DAYS * 86400;
  const now = Math.floor(Date.now() / 1000);
  const trancheAmount = totalAllocation / BigInt(TOTAL_TRANCHES);

  return Array.from({ length: TOTAL_TRANCHES }, (_, i) => {
    const unlockTimestamp = cliffEnd + i * MONTHLY_INTERVAL_DAYS * 86400;
    const unlockDate = new Date(unlockTimestamp * 1000);
    const cumulativeVested = trancheAmount * BigInt(i + 1);
    const isUnlocked = now >= unlockTimestamp;

    let status: TrancheInfo['status'];
    if (claimedAmount >= cumulativeVested) {
      status = 'claimed';
    } else if (isUnlocked) {
      status = 'available';
    } else {
      status = 'locked';
    }

    return {
      index: i,
      label: i === 0 ? 'Tranche 1 (At Cliff)' : `Tranche ${i + 1} (+${i * MONTHLY_INTERVAL_DAYS}d)`,
      percentage: TRANCHE_PERCENTAGE,
      unlockDate,
      amount: trancheAmount,
      status,
    };
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function VestingPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [claimTxHash, setClaimTxHash] = useState<Hash | null>(null);
  const [claimStep, setClaimStep] = useState<'idle' | 'claiming' | 'waiting'>('idle');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [cliffCountdown, setCliffCountdown] = useState(0);

  // ── Contract Reads ──────────────────────────────────────────────────────────
  const { data: vestingSchedule, refetch: refetchSchedule } = useReadContract({
    address: CURRENT_CONTRACTS.VESTING as `0x${string}`,
    abi: VESTING_ABI,
    functionName: 'vestingSchedules',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: releasable, refetch: refetchReleasable } = useReadContract({
    address: CURRENT_CONTRACTS.VESTING as `0x${string}`,
    abi: VESTING_ABI,
    functionName: 'calculateReleasable',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: projectLaunchTime } = useReadContract({
    address: CURRENT_CONTRACTS.VESTING as `0x${string}`,
    abi: VESTING_ABI,
    functionName: 'projectLaunchTime',
  });

  const { data: totalAllocatedGlobal } = useReadContract({
    address: CURRENT_CONTRACTS.VESTING as `0x${string}`,
    abi: VESTING_ABI,
    functionName: 'totalAllocated',
  });

  const { data: totalClaimedGlobal } = useReadContract({
    address: CURRENT_CONTRACTS.VESTING as `0x${string}`,
    abi: VESTING_ABI,
    functionName: 'totalClaimedAmount',
  });

  // ── Write Contract ──────────────────────────────────────────────────────────
  const { writeContractAsync: claimTokens } = useWriteContract();

  const { isSuccess: claimConfirmed } = useWaitForTransactionReceipt({
    hash: claimTxHash ?? undefined,
    query: { enabled: !!claimTxHash },
  });

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (claimConfirmed && claimStep === 'waiting') {
      setClaimStep('idle');
      setClaimSuccess(true);
      refetchSchedule();
      refetchReleasable();
    }
  }, [claimConfirmed, claimStep, refetchSchedule, refetchReleasable]);

  // Cliff countdown
  useEffect(() => {
    if (!projectLaunchTime) return;
    const cliffEnd = Number(projectLaunchTime as bigint) + CLIFF_PERIOD_DAYS * 86400;
    const update = () => setCliffCountdown(Math.max(0, cliffEnd - Math.floor(Date.now() / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [projectLaunchTime]);

  // ── Derived Values ──────────────────────────────────────────────────────────
  const schedule = vestingSchedule as
    | [bigint, bigint, bigint, boolean]   // [totalAllocation, claimedAmount, startTime, exists]
    | undefined;

  const hasAllocation = schedule?.[3] === true;
  const totalAllocation = schedule?.[0] ?? 0n;
  const claimedAmount = schedule?.[1] ?? 0n;
  const startTime = schedule?.[2] ? Number(schedule[2]) : 0;
  const releasableAmount = (releasable as bigint | undefined) ?? 0n;
  const launchTime = projectLaunchTime ? Number(projectLaunchTime as bigint) : 0;
  const cliffEnd = launchTime + CLIFF_PERIOD_DAYS * 86400;
  const cliffReached = Date.now() / 1000 >= cliffEnd;

  const claimedPercent =
    totalAllocation > 0n
      ? Math.min(100, (Number(formatUnits(claimedAmount, 18)) / Number(formatUnits(totalAllocation, 18))) * 100)
      : 0;

  const tranches = hasAllocation && launchTime > 0
    ? computeTranches(totalAllocation, claimedAmount, launchTime)
    : [];

  const isClaimLoading = claimStep !== 'idle';
  const canClaim = hasAllocation && cliffReached && releasableAmount > 0n;

  const globalClaimedPercent =
    totalAllocatedGlobal && (totalAllocatedGlobal as bigint) > 0n && totalClaimedGlobal
      ? Math.min(
          100,
          (Number(formatUnits(totalClaimedGlobal as bigint, 18)) /
            Number(formatUnits(totalAllocatedGlobal as bigint, 18))) *
            100
        )
      : 0;

  // ── Handler ─────────────────────────────────────────────────────────────────
  const handleClaim = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    setClaimError(null);
    setClaimSuccess(false);
    try {
      setClaimStep('claiming');
      const hash = await claimTokens({
        address: CURRENT_CONTRACTS.VESTING as `0x${string}`,
        abi: VESTING_ABI,
        functionName: 'claim',
      });
      setClaimTxHash(hash);
      setClaimStep('waiting');
    } catch (err) {
      setClaimError(parseContractError(err));
      setClaimStep('idle');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="py-8 px-4">
      {/* ── Title ── */}
      <motion.h1
        className="text-3xl md:text-4xl font-bold text-teal-400 text-center mb-2"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Vesting Dashboard
      </motion.h1>
      <motion.p
        className="text-zinc-400 text-center mb-8 text-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { delay: 0.1 } }}
      >
        Track and claim your vested FOR tokens
      </motion.p>

      <div className="max-w-lg mx-auto space-y-4">

        {/* ── Global Stats ── */}
        <motion.div
          className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.05 } }}
        >
          <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Protocol Overview</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Total Allocated</p>
              <p className="text-white font-semibold mt-1 text-sm">
                {totalAllocatedGlobal ? formatLargeNumber(totalAllocatedGlobal as bigint) : '—'} FOR
              </p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3">
              <p className="text-xs text-zinc-500">Total Claimed</p>
              <p className="text-white font-semibold mt-1 text-sm">
                {totalClaimedGlobal ? formatLargeNumber(totalClaimedGlobal as bigint) : '—'} FOR
              </p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
              <span>Global Claim Progress</span>
              <span>{globalClaimedPercent.toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-600 to-teal-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${globalClaimedPercent}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
          </div>
        </motion.div>

        {/* ── Connect Prompt ── */}
        {!isConnected && (
          <motion.div
            className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
          >
            <div className="text-4xl mb-3">🔐</div>
            <p className="text-zinc-300 font-medium mb-2">Connect Your Wallet</p>
            <p className="text-zinc-500 text-sm mb-5">Connect to view your vesting schedule and claim tokens.</p>
            <button
              onClick={() => openConnectModal?.()}
              className="px-6 py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-lg transition-all active:scale-95"
            >
              Connect Wallet
            </button>
          </motion.div>
        )}

        {/* ── No Allocation ── */}
        {isConnected && !hasAllocation && (
          <motion.div
            className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
          >
            <div className="text-4xl mb-3">📭</div>
            <p className="text-zinc-300 font-medium mb-2">No Vesting Allocation</p>
            <p className="text-zinc-500 text-sm">
              This address has no vesting schedule. Purchase tokens or claim the airdrop to get started.
            </p>
          </motion.div>
        )}

        {/* ── Vesting Schedule ── */}
        {isConnected && hasAllocation && (
          <>
            {/* Summary Card */}
            <motion.div
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
            >
              <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Your Allocation</p>

              {/* Main Numbers */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center">
                  <p className="text-xs text-zinc-500 mb-1">Total</p>
                  <p className="text-white font-bold text-sm">
                    {formatLargeNumber(totalAllocation)} FOR
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-zinc-500 mb-1">Claimed</p>
                  <p className="text-emerald-400 font-bold text-sm">
                    {formatLargeNumber(claimedAmount)} FOR
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-zinc-500 mb-1">Remaining</p>
                  <p className="text-teal-300 font-bold text-sm">
                    {formatLargeNumber(totalAllocation - claimedAmount)} FOR
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                  <span>Claimed</span>
                  <span>{claimedPercent.toFixed(1)}%</span>
                </div>
                <div className="w-full h-3 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-emerald-600 to-teal-400 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${claimedPercent}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                  />
                </div>
              </div>

              {/* Start Date */}
              {startTime > 0 && (
                <p className="text-xs text-zinc-500 mt-3">
                  Vesting started: <span className="text-zinc-300">{formatDate(startTime)}</span>
                </p>
              )}
            </motion.div>

            {/* Cliff Status */}
            <motion.div
              className={`rounded-xl border p-4 ${
                cliffReached
                  ? 'bg-emerald-900/20 border-emerald-700/40'
                  : 'bg-zinc-900 border-zinc-800'
              }`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{cliffReached ? '🔓' : '🔒'}</span>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {cliffReached ? 'Cliff Reached' : 'Cliff Period'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {cliffReached
                        ? `Ended on ${formatDate(cliffEnd)}`
                        : `Ends on ${formatDate(cliffEnd)}`}
                    </p>
                  </div>
                </div>
                {!cliffReached && (
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">Remaining</p>
                    <p className="text-sm font-mono font-semibold text-yellow-400">
                      {formatCountdown(cliffCountdown)}
                    </p>
                  </div>
                )}
                {cliffReached && (
                  <span className="text-xs text-emerald-400 font-medium">Unlocked</span>
                )}
              </div>
            </motion.div>

            {/* Tranches Timeline */}
            <motion.div
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }}
            >
              <p className="text-xs text-zinc-500 mb-4 uppercase tracking-wider">Vesting Schedule</p>
              <div className="space-y-3">
                {tranches.map((tranche, idx) => (
                  <div
                    key={tranche.index}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                      tranche.status === 'claimed'
                        ? 'bg-emerald-900/10 border-emerald-800/40'
                        : tranche.status === 'available'
                        ? 'bg-teal-900/20 border-teal-700/40'
                        : 'bg-zinc-800/40 border-zinc-700/40'
                    }`}
                  >
                    {/* Status Icon */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                        tranche.status === 'claimed'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : tranche.status === 'available'
                          ? 'bg-teal-500/20 text-teal-400'
                          : 'bg-zinc-700 text-zinc-500'
                      }`}
                    >
                      {tranche.status === 'claimed' ? '✓' : tranche.status === 'available' ? '!' : String(idx + 1)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${
                        tranche.status === 'claimed' ? 'text-emerald-400' :
                        tranche.status === 'available' ? 'text-teal-300' : 'text-zinc-400'
                      }`}>
                        {tranche.label}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {tranche.unlockDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>

                    {/* Amount */}
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-white">
                        {formatLargeNumber(tranche.amount)} FOR
                      </p>
                      <p className={`text-xs ${
                        tranche.status === 'claimed' ? 'text-emerald-500' :
                        tranche.status === 'available' ? 'text-teal-500' : 'text-zinc-600'
                      }`}>
                        {tranche.status === 'claimed' ? 'Claimed' :
                         tranche.status === 'available' ? 'Available' : 'Locked'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Claimable Amount */}
            {releasableAmount > 0n && (
              <motion.div
                className="bg-teal-900/20 border border-teal-700/40 rounded-xl p-4 text-center"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: 0.25 } }}
              >
                <p className="text-xs text-zinc-400 mb-1">Available to Claim Now</p>
                <p className="text-3xl font-bold text-teal-300">
                  {formatLargeNumber(releasableAmount)} FOR
                </p>
              </motion.div>
            )}

            {/* Claim Button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.3 } }}
            >
              <button
                onClick={handleClaim}
                disabled={isClaimLoading || !canClaim}
                className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
                  isClaimLoading || !canClaim
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-teal-500 hover:bg-teal-400 text-black active:scale-95'
                }`}
              >
                {isClaimLoading && (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {claimStep === 'claiming'
                  ? 'Sending Claim...'
                  : claimStep === 'waiting'
                  ? 'Waiting for Confirmation...'
                  : !cliffReached
                  ? `Cliff in ${formatCountdown(cliffCountdown)}`
                  : releasableAmount === 0n
                  ? 'Nothing to Claim'
                  : 'Claim Tokens'}
              </button>
            </motion.div>
          </>
        )}

        {/* ── Claim Error ── */}
        <AnimatePresence>
          {claimError && (
            <motion.div
              className="p-4 bg-red-900/40 border border-red-700/60 rounded-xl text-red-300 text-sm text-center"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {claimError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Claim Success ── */}
        <AnimatePresence>
          {claimSuccess && (
            <motion.div
              className="p-4 bg-emerald-900/40 border border-emerald-700/60 rounded-xl text-emerald-300 text-sm"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <p className="font-semibold mb-1">Tokens Claimed Successfully!</p>
              <p className="text-xs text-emerald-400/80 mb-2">
                Tokens have been transferred to your wallet.
              </p>
              {claimTxHash && (
                <a
                  href={`https://sepolia.etherscan.io/tx/${claimTxHash}`}
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

        {/* ── Pending TX ── */}
        <AnimatePresence>
          {claimStep === 'waiting' && (
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
          animate={{ opacity: 1, transition: { delay: 0.4 } }}
        >
          <p>• Vesting follows a <span className="text-zinc-300">180-day cliff</span> from project launch, then 4 tranches of 25% each.</p>
          <p>• Tranche 1 is available <span className="text-zinc-300">immediately after the cliff</span>. Tranches 2–4 unlock monthly.</p>
          <p>• Claims are always open — <span className="text-zinc-300">not blocked by governance pause</span>.</p>
          <p>• Unclaimed tokens expire after <span className="text-zinc-300">3 years</span> and return to treasury.</p>
        </motion.div>

      </div>
    </div>
  );
}
