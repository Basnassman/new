import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { formatUnits, type Hash, zeroHash } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { AIRDROP_ABI } from '@/config/abis';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EligibilityData {
  eligible: boolean;
  amount: string;
  proof: `0x${string}`[];
  alreadyClaimed: boolean;
  message?: string;
}

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
  if (d > 0) return `${d}d ${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function parseContractError(err: unknown): string {
  const msg = (
    (err as { shortMessage?: string })?.shortMessage ||
    (err as { message?: string })?.message ||
    ''
  ).toLowerCase();
  if (msg.includes('user rejected') || msg.includes('denied')) return 'Transaction rejected by user.';
  if (msg.includes('alreadyclaimed')) return 'You have already claimed your airdrop.';
  if (msg.includes('invalidproof')) return 'Invalid Merkle proof. Please contact support.';
  if (msg.includes('deadlinepassed')) return 'The claim window has ended.';
  if (msg.includes('notactive')) return 'The claim window has not started yet.';
  if (msg.includes('rootnotset')) return 'Merkle root not set yet. Please wait for announcement.';
  if (msg.includes('enforcedpause')) return 'Airdrop is currently paused.';
  if (msg.includes('finalized')) return 'Airdrop has been finalized.';
  if (msg.includes('insufficientvestingbalance')) return 'Insufficient vesting balance available.';
  if (msg.includes('exceedscap')) return 'Airdrop cap has been reached.';
  return 'Transaction failed. Please try again.';
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AirdropPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  const [eligibility, setEligibility] = useState<EligibilityData | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [claimTxHash, setClaimTxHash] = useState<Hash | null>(null);
  const [claimStep, setClaimStep] = useState<'idle' | 'claiming' | 'waiting'>('idle');
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // ── Read Constants from Contract ───────────────────────────────────────────
  const { data: govLockConstant } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'GOVERNANCE_LOCK',
  });

  const { data: maxWindowExtConstant } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'MAX_WINDOW_EXTENSION',
  });

  // ── Contract Reads ──────────────────────────────────────────────────────────
  const { data: merkleRoot } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'merkleRoot',
  });

  const { data: claimStart } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'claimStart',
  });

  const { data: claimEnd } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'claimEnd',
  });

  const { data: totalAllocated } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'totalAllocated',
  });

  const { data: maxAllocation } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'maxAllocation',
  });

  const { data: claimed, refetch: refetchClaimed } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'claimed',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { data: finalized } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'finalized',
  });

  const { data: isPaused } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'paused',
  });

  const { data: airdropStartTime } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'startTime',
  });

  const { data: vestingAddress } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'vesting',
  });

  const { data: tokenAddress } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'token',
  });

  const { data: treasuryAddress } = useReadContract({
    address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
    abi: AIRDROP_ABI,
    functionName: 'treasury',
  });

  // ── Write Contract ──────────────────────────────────────────────────────────
  const { writeContractAsync: claimAirdrop } = useWriteContract();

  const { isSuccess: claimConfirmed } = useWaitForTransactionReceipt({
    hash: claimTxHash ?? undefined,
    query: { enabled: !!claimTxHash },
  });

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Countdown timer (claimEnd)
  useEffect(() => {
    if (!claimEnd) return;
    const end = Number(claimEnd as bigint);
    const update = () => setCountdown(Math.max(0, end - Math.floor(Date.now() / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [claimEnd]);

  // On claim confirmed
  useEffect(() => {
    if (claimConfirmed && claimStep === 'waiting') {
      setClaimStep('idle');
      setClaimSuccess(true);
      refetchClaimed();
    }
  }, [claimConfirmed, claimStep, refetchClaimed]);

  // Auto-check eligibility when wallet connects
  useEffect(() => {
    if (address && isConnected) {
      checkEligibility(address);
    } else {
      setEligibility(null);
      setCheckError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const checkEligibility = async (addr: string) => {
    setCheckLoading(true);
    setCheckError(null);
    setEligibility(null);
    try {
      const res = await fetch(`/api/airdrop/eligibility?address=${addr}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to check eligibility');
      }
      const data: EligibilityData = await res.json();
      setEligibility(data);
    } catch (err) {
      setCheckError((err as Error).message || 'Failed to check eligibility. Please try again.');
    } finally {
      setCheckLoading(false);
    }
  };

  const handleClaim = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }
    if (!eligibility?.eligible || !eligibility.proof || !eligibility.amount) return;

    setClaimError(null);
    try {
      setClaimStep('claiming');
      const hash = await claimAirdrop({
        address: CURRENT_CONTRACTS.AIRDROP as `0x${string}`,
        abi: AIRDROP_ABI,
        functionName: 'claim',
        args: [BigInt(eligibility.amount), eligibility.proof],
      });
      setClaimTxHash(hash);
      setClaimStep('waiting');
    } catch (err) {
      setClaimError(parseContractError(err));
      setClaimStep('idle');
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const now = Date.now() / 1000;
  const start = claimStart ? Number(claimStart as bigint) : 0;
  const end = claimEnd ? Number(claimEnd as bigint) : 0;
  const rootSet = merkleRoot ? (merkleRoot as `0x${string}`) !== zeroHash : false;
  const isFinalized = finalized === true;
  const isActive = rootSet && !isFinalized && !isPaused && now >= start && now <= end;
  const claimWindowOpen = rootSet && !isFinalized && !isPaused && now >= start && now <= end;
  const claimWindowNotStarted = rootSet && !isFinalized && !isPaused && now < start;
  const claimWindowEnded = rootSet && (isFinalized || now > end);

  const allocationProgress =
    totalAllocated && maxAllocation && (maxAllocation as bigint) > 0n
      ? Math.min(
          100,
          (Number(formatUnits(totalAllocated as bigint, 18)) /
            Number(formatUnits(maxAllocation as bigint, 18))) *
            100
        )
      : 0;

  const alreadyClaimed = (claimed as boolean) || eligibility?.alreadyClaimed || claimSuccess;
  const isClaimLoading = claimStep !== 'idle';

  // ── Status Label ────────────────────────────────────────────────────────────
  function getStatusLabel() {
    if (!rootSet) return { label: 'Uninitialized', color: 'text-zinc-400', bg: 'bg-zinc-800' };
    if (isFinalized) return { label: 'Finalized', color: 'text-blue-400', bg: 'bg-blue-900/20' };
    if (isPaused) return { label: 'Paused', color: 'text-red-400', bg: 'bg-red-900/20' };
    if (now < start) return { label: 'Upcoming', color: 'text-yellow-400', bg: 'bg-yellow-900/20' };
    if (now > end) return { label: 'Ended', color: 'text-zinc-400', bg: 'bg-zinc-800' };
    return { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-900/20' };
  }

  const stateInfo = getStatusLabel();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="py-12 px-4 min-h-screen bg-black">
      <motion.div
        className="max-w-2xl mx-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {/* ── Title ── */}
        <motion.h1
          className="text-4xl md:text-5xl font-bold text-teal-400 text-center mb-2"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          FOR Token Airdrop
        </motion.h1>
        <motion.p
          className="text-zinc-400 text-center mb-8 text-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.1 } }}
        >
          Check your eligibility and claim your allocated tokens
        </motion.p>

        <div className="space-y-4">
          {/* ── Airdrop Stats ── */}
          <motion.div
            className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.05 } }}
          >
            <div className="grid grid-cols-3 gap-4 mb-4">
              {/* Status */}
              <div className="text-center">
                <p className="text-xs text-zinc-500 mb-1">Status</p>
                <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${stateInfo.bg} ${stateInfo.color}`}>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  {stateInfo.label}
                </div>
              </div>
              {/* Root Set */}
              <div className="text-center">
                <p className="text-xs text-zinc-500 mb-1">Merkle Root</p>
                <p className={`text-sm font-semibold ${rootSet ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {rootSet ? 'Set' : 'Not Set'}
                </p>
              </div>
              {/* Deadline */}
              <div className="text-center">
                <p className="text-xs text-zinc-500 mb-1">Claim Ends</p>
                <p className="text-sm font-semibold text-teal-300 font-mono">
                  {claimEnd ? formatCountdown(countdown) : '—'}
                </p>
              </div>
            </div>

            {/* Allocation Progress */}
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                <span>
                  Allocated:{' '}
                  <span className="text-zinc-300">
                    {totalAllocated ? formatLargeNumber(totalAllocated as bigint) : '0'} FOR
                  </span>
                </span>
                <span>
                  Max Cap:{' '}
                  <span className="text-zinc-300">
                    {maxAllocation ? formatLargeNumber(maxAllocation as bigint) : '—'} FOR
                  </span>
                </span>
              </div>
              <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-purple-600 to-teal-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${allocationProgress}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>
              <p className="text-right text-xs text-zinc-500 mt-1">{allocationProgress.toFixed(1)}% allocated</p>
            </div>

            {/* Contract Details */}
            <div className="mt-4 pt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
              <div className="bg-zinc-800/40 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500">Token</p>
                <p className="text-xs text-zinc-300 font-mono truncate">{tokenAddress ? (tokenAddress as string).slice(0, 8) + '...' : '—'}</p>
              </div>
              <div className="bg-zinc-800/40 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500">Vesting</p>
                <p className="text-xs text-zinc-300 font-mono truncate">{vestingAddress ? (vestingAddress as string).slice(0, 8) + '...' : '—'}</p>
              </div>
              <div className="bg-zinc-800/40 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500">Treasury</p>
                <p className="text-xs text-zinc-300 font-mono truncate">{treasuryAddress ? (treasuryAddress as string).slice(0, 8) + '...' : '—'}</p>
              </div>
              <div className="bg-zinc-800/40 rounded-lg p-2">
                <p className="text-[10px] text-zinc-500">Gov Lock</p>
                <p className="text-xs text-zinc-300">{govLockConstant ? `${Number(govLockConstant as bigint) / 86400} days` : '—'}</p>
              </div>
            </div>
          </motion.div>

          {/* ── Eligibility Check Card ── */}
          <motion.div
            className="bg-zinc-900 rounded-xl border border-zinc-800 p-5"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.1 } }}
          >
            <p className="text-sm text-zinc-400 mb-4">Eligibility Check</p>

            {!isConnected ? (
              <div className="text-center py-6">
                <p className="text-zinc-500 text-sm mb-4">Connect your wallet to check eligibility</p>
                <button
                  onClick={() => openConnectModal?.()}
                  className="px-6 py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-semibold rounded-lg transition-all active:scale-95"
                >
                  Connect Wallet
                </button>
              </div>
            ) : checkLoading ? (
              <div className="text-center py-8">
                <div className="inline-flex items-center gap-2 text-zinc-400 text-sm">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Checking eligibility...
                </div>
              </div>
            ) : checkError ? (
              <div className="text-center py-4">
                <p className="text-red-400 text-sm mb-3">{checkError}</p>
                <button
                  onClick={() => address && checkEligibility(address)}
                  className="text-xs text-teal-400 hover:text-teal-300 underline"
                >
                  Try again
                </button>
              </div>
            ) : eligibility ? (
              <AnimatePresence mode="wait">
                {eligibility.eligible ? (
                  <motion.div
                    key="eligible"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-4"
                  >
                    {/* Eligible Banner */}
                    <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-4 text-center">
                      <div className="text-3xl mb-2">🎉</div>
                      <p className="text-emerald-400 font-semibold">You are eligible!</p>
                      <p className="text-2xl font-bold text-white mt-2">
                        {formatLargeNumber(BigInt(eligibility.amount))} FOR
                      </p>
                      <p className="text-xs text-zinc-400 mt-1">
                        Tokens will be allocated to your vesting schedule
                      </p>
                    </div>

                    {/* Already Claimed */}
                    {alreadyClaimed && (
                      <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 text-center">
                        <p className="text-blue-400 text-sm font-medium">Already Claimed</p>
                        <p className="text-zinc-400 text-xs mt-1">
                          Your tokens are in your vesting schedule. Visit the Vesting page to track them.
                        </p>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="not-eligible"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-center py-6"
                  >
                    <div className="text-4xl mb-3">😔</div>
                    <p className="text-zinc-300 font-medium">Not Eligible</p>
                    <p className="text-zinc-500 text-sm mt-2">
                      {eligibility.message || 'This address is not included in the airdrop list.'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : null}
          </motion.div>

          {/* ── Claim Button ── */}
          {isConnected && eligibility?.eligible && !alreadyClaimed && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }}
            >
              {/* Claim Window Status */}
              {!claimWindowOpen && rootSet && (
                <div className="mb-3 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg text-yellow-400 text-xs text-center">
                  {claimWindowNotStarted
                    ? `Claim starts ${formatCountdown(start - now)}`
                    : claimWindowEnded
                    ? 'Claim window has ended.'
                    : isPaused
                    ? 'Airdrop is currently paused.'
                    : 'Airdrop is not active.'}
                </div>
              )}

              {!rootSet && (
                <div className="mb-3 p-3 bg-zinc-800/60 border border-zinc-700/40 rounded-lg text-zinc-400 text-xs text-center">
                  Merkle root not set yet. Please wait for announcement.
                </div>
              )}

              <button
                onClick={handleClaim}
                disabled={isClaimLoading || !claimWindowOpen}
                className={`w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
                  isClaimLoading || !claimWindowOpen
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-600 to-teal-500 hover:from-purple-500 hover:to-teal-400 text-white active:scale-95'
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
                  : !rootSet
                  ? 'Not Ready'
                  : claimWindowNotStarted
                  ? 'Not Started'
                  : claimWindowEnded
                  ? 'Ended'
                  : isPaused
                  ? 'Paused'
                  : 'Claim Airdrop'}
              </button>
            </motion.div>
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
                <p className="font-semibold mb-1">Airdrop Claimed Successfully!</p>
                <p className="text-xs text-emerald-400/80 mb-2">
                  Your tokens have been allocated to your vesting schedule.
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
            animate={{ opacity: 1, transition: { delay: 0.3 } }}
          >
            <p>• Airdrop uses a <span className="text-zinc-300">Merkle proof</span> system for gas-efficient eligibility verification.</p>
            <p>• Claimed tokens are allocated to your <span className="text-zinc-300">vesting schedule</span> — not sent directly to your wallet.</p>
            <p>• Each address can only claim <span className="text-zinc-300">once</span>.</p>
            <p>• Claims are <span className="text-zinc-300">blocked when paused or finalized</span>.</p>
            <p>• Max window extension: <span className="text-zinc-300">{maxWindowExtConstant ? `${Number(maxWindowExtConstant as bigint) / 86400} days` : '...'}</span>.</p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}