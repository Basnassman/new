'use client';

import { useState, useEffect } from 'react';
import { useAccount, useBalance, useWriteContract, useReadContract } from 'wagmi';
import { parseEther, parseUnits, formatEther, formatUnits } from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, TOKEN_ABI } from '@/config/abis';
import { motion } from 'framer-motion';

type Currency = 'ETH' | 'USDC' | 'USDT' | 'DAI';

const CURRENCIES = [
  { value: 'ETH' as Currency, label: 'ETH', icon: '🔷', address: null, decimals: 18 },
  { value: 'USDC' as Currency, label: 'USDC', icon: '💲', address: CURRENT_CONTRACTS.USDC as `0x${string}`, decimals: 6 },
  { value: 'USDT' as Currency, label: 'USDT', icon: '💵', address: CURRENT_CONTRACTS.USDT as `0x${string}`, decimals: 6 },
  { value: 'DAI' as Currency, label: 'DAI', icon: '🟣', address: CURRENT_CONTRACTS.DAI as `0x${string}`, decimals: 18 },
] as const;

export default function BuyPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  
  const [currency, setCurrency] = useState<Currency>('ETH');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'approving' | 'buying'>('idle');

  const selected = CURRENCIES.find(c => c.value === currency)!;

  // Balances
  const { data: ethBalance } = useBalance({ address });
  const { data: tokenBalance } = useReadContract({
    address: selected.address || undefined,
    abi: TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!selected.address && !!address },
  });

  // Sale info
  const { data: preview } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'previewTokenAmount',
    args: (amount && parseFloat(amount) > 0) 
      ? [selected.address || '0x0000000000000000000000000000000000000000', 
         currency === 'ETH' ? parseEther(amount) : parseUnits(amount, selected.decimals)]
      : undefined,
    query: { enabled: !!amount && parseFloat(amount) > 0 },
  });

  const { data: allowance } = useReadContract({
    address: selected.address || undefined,
    abi: TOKEN_ABI,
    functionName: 'allowance',
    args: address && selected.address ? [address, CURRENT_CONTRACTS.SALE] : undefined,
    query: { enabled: !!selected.address && !!address },
  });

  // Write functions
  const { writeContractAsync: approveToken } = useWriteContract();
  const { writeContractAsync: buyWithERC20 } = useWriteContract();
  const { writeContractAsync: buyWithEth } = useWriteContract();

  const needsApproval = () => {
    if (currency === 'ETH') return false;
    if (!allowance || !amount) return true;
    const needed = parseUnits(amount, selected.decimals);
    return (allowance as bigint) < needed;
  };

  const handleApprove = async () => {
    if (!isConnected || !selected.address) return;
    
    try {
      setStep('approving');
      setLoading(true);
      setError(null);

      const tokenAmount = parseUnits(amount, selected.decimals);
      
      const hash = await approveToken({
        address: selected.address,
        abi: TOKEN_ABI,
        functionName: 'approve',
        args: [CURRENT_CONTRACTS.SALE, tokenAmount],
      });

      // Wait for confirmation (optional - can use waitForTransactionReceipt)
      setTxHash(hash);
    } catch (err: any) {
      setError('Approval failed: ' + (err?.shortMessage || err?.message));
    } finally {
      setLoading(false);
      setStep('idle');
    }
  };

  const handleBuy = async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Enter valid amount');
      return;
    }

    // Check if needs approval first
    if (needsApproval()) {
      await handleApprove();
      return;
    }

    try {
      setStep('buying');
      setLoading(true);
      setError(null);
      setTxHash(null);

      if (currency === 'ETH') {
        const hash = await buyWithEth({
          address: CURRENT_CONTRACTS.SALE as `0x${string}`,
          abi: SALE_ABI,
          functionName: 'purchaseWithEth',
          value: parseEther(amount),
        });
        setTxHash(hash);
      } else {
        const tokenAmount = parseUnits(amount, selected.decimals);
        
        const hash = await buyWithERC20({
          address: CURRENT_CONTRACTS.SALE as `0x${string}`,
          abi: SALE_ABI,
          functionName: 'purchaseWithERC20',
          args: [selected.address, tokenAmount],
        });
        setTxHash(hash);
      }
    } catch (err: any) {
      const msg = (err?.shortMessage || err?.message || '').toLowerCase();
      if (msg.includes('rejected') || msg.includes('denied')) {
        setError('Transaction rejected by user');
      } else if (msg.includes('insufficient')) {
        setError('Insufficient balance');
      } else if (msg.includes('cooldown')) {
        setError('Please wait for cooldown');
      } else if (msg.includes('cap')) {
        setError('Purchase cap exceeded');
      } else {
        setError('Transaction failed: ' + (err?.shortMessage || err?.message));
      }
    } finally {
      setLoading(false);
      setStep('idle');
    }
  };

  const formatBalance = () => {
    if (currency === 'ETH') {
      return ethBalance ? parseFloat(formatEther(ethBalance.value)).toFixed(4) : '0';
    }
    return tokenBalance ? parseFloat(formatUnits(tokenBalance as bigint, selected.decimals)).toFixed(4) : '0';
  };

  const formatNumber = (value: bigint | undefined, decimals: number = 18) => {
    if (!value) return '0';
    return parseFloat(formatUnits(value, decimals)).toLocaleString();
  };

  const getButtonText = () => {
    if (!isConnected) return '🔌 Connect Wallet';
    if (loading && step === 'approving') return '⏳ Approving...';
    if (loading && step === 'buying') return '⏳ Buying...';
    if (needsApproval()) return '✅ Approve ' + currency;
    return '🚀 Buy FOR';
  };

  return (
    <div className="py-8">
      <motion.h1 
        className="text-3xl md:text-4xl font-bold text-teal-400 text-center mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        🚀 Buy FOR Token
      </motion.h1>

      <div className="max-w-lg mx-auto">
        {/* Currency Selection */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 mb-6">
          <label className="block text-sm text-zinc-400 mb-3">Select Currency</label>
          <div className="grid grid-cols-4 gap-2">
            {CURRENCIES.map((c) => (
              <button
                key={c.value}
                onClick={() => { setCurrency(c.value); setAmount(''); setError(null); setTxHash(null); }}
                className={`p-3 rounded-lg text-sm font-medium transition-all ${
                  currency === c.value
                    ? 'bg-teal-500 text-black'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                <span className="block text-lg mb-1">{c.icon}</span>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amount Input */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 mb-6">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm text-zinc-400">Amount ({currency})</label>
            <span className="text-xs text-zinc-500">Balance: {formatBalance()} {currency}</span>
          </div>
          
          <input
            type="number"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
            placeholder="0.00"
            className="w-full p-4 rounded-lg bg-zinc-950 text-white text-xl border border-zinc-700 focus:border-teal-500 focus:outline-none"
            min="0"
            step="0.001"
          />
          
          {/* Preview */}
          {preview && parseFloat(amount) > 0 && (
            <motion.div 
              className="mt-4 p-4 bg-teal-900/30 border border-teal-700/50 rounded-lg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-sm text-teal-400">You will receive:</p>
              <p className="text-2xl font-bold text-teal-300">
                {formatNumber(preview)} FOR
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                25% immediately + 75% vested over 3 months
              </p>
            </motion.div>
          )}

          {/* Approval Status */}
          {currency !== 'ETH' && amount && parseFloat(amount) > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${needsApproval() ? 'bg-yellow-500' : 'bg-emerald-500'}`} />
              <span className={needsApproval() ? 'text-yellow-400' : 'text-emerald-400'}>
                {needsApproval() ? 'Approval needed before purchase' : 'Approved for purchase'}
              </span>
            </div>
          )}
        </div>

        {/* Buy Button */}
        <button
          onClick={handleBuy}
          disabled={loading || !isConnected || !amount}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            loading || !isConnected || !amount
              ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              : needsApproval()
              ? 'bg-yellow-600 hover:bg-yellow-500 text-white active:scale-95'
              : 'bg-teal-500 hover:bg-teal-400 text-black active:scale-95'
          }`}
        >
          {getButtonText()}
        </button>

        {/* Messages */}
        {error && (
          <motion.div 
            className="mt-4 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            ❌ {error}
          </motion.div>
        )}

        {txHash && !loading && (
          <motion.div 
            className="mt-4 p-4 bg-emerald-900/50 border border-emerald-700 rounded-lg text-emerald-200 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <p>✅ {step === 'approving' ? 'Approved!' : 'Purchase Successful!'}</p>
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-emerald-300 break-all text-sm"
            >
              {txHash}
            </a>
          </motion.div>
        )}
      </div>
    </div>
  );
}
