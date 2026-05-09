'use client';

import { useState, useEffect } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, TOKEN_ABI } from '@/config/abis';

export type Currency = 'FOR' | 'USDT' | 'USDC' | 'DAI';

interface CalculatorProps {
  connected: boolean;
  onBuy: (data: {
    currency: Currency;
    tokenAmount: bigint;
    currencyAmount: bigint;
  }) => void;
  loading: boolean;
  userBalance?: bigint;
  userPurchased?: bigint;
  walletCap?: bigint;
}

interface CurrencyInfo {
  value: Currency;
  label: string;
  address: `0x${string}`;
  enabled: boolean;
  decimals?: number;
  price?: bigint; // Price in wei
}

const CURRENCIES: CurrencyInfo[] = [
  {
    value: 'FOR',
    label: 'FOR (Direct)',
    address: CURRENT_CONTRACTS.TOKEN as `0x${string}`,
    enabled: true,
  },
  {
    value: 'USDT',
    label: 'USDT',
    address: CURRENT_CONTRACTS.USDT as `0x${string}`,
    enabled: true,
  },
  {
    value: 'USDC',
    label: 'USDC',
    address: CURRENT_CONTRACTS.USDC as `0x${string}`,
    enabled: true,
  },
  {
    value: 'DAI',
    label: 'DAI',
    address: CURRENT_CONTRACTS.DAI as `0x${string}`,
    enabled: true,
  },
];

export default function Calculator({
  connected,
  onBuy,
  loading,
  userBalance,
  userPurchased,
  walletCap,
}: CalculatorProps) {
  const [currency, setCurrency] = useState<Currency>('FOR');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  // ── Get currency info ──
  const selectedCurrencyInfo = CURRENCIES.find((c) => c.value === currency);

  // ── Read token price from Sale contract ──
  const { data: tokenPrice } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'tokenPrice',
  });

  // ── Read currency decimals & price from Sale contract ──
  const { data: currencyInfo } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'getCurrencyInfo',
    args: selectedCurrencyInfo ? [selectedCurrencyInfo.address] : undefined,
    query: { enabled: !!selectedCurrencyInfo },
  });

  // ── Read remaining sale cap ──
  const { data: remainingSaleCap } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'remainingSaleCap',
  });

  // ── Read remaining wallet cap ──
  const { data: remainingWalletCap } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'remainingWalletCap',
    args: ['0x0000000000000000000000000000000000000000'], // Will be replaced in buy.tsx
    query: { enabled: false }, // Disabled here, will be called from parent
  });

  // ── Derived values ──
  const currencyDecimals = currencyInfo?.[1] ?? 18;
  const currencyPrice = currencyInfo?.[2] ?? 0n;
  const tokenPriceValue = tokenPrice ?? 0n;

  // ── Calculate token amount from currency amount ──
  const calculateTokenAmount = (currencyAmount: string): bigint => {
    if (!currencyAmount || isNaN(parseFloat(currencyAmount))) return 0n;
    if (tokenPriceValue === 0n || currencyPrice === 0n) return 0n;

    try {
      const currencyAmountWei = parseUnits(currencyAmount, currencyDecimals);
      // tokenAmount = (currencyAmount * tokenPrice) / currencyPrice
      const tokenAmount = (currencyAmountWei * tokenPriceValue) / currencyPrice;
      return tokenAmount;
    } catch {
      return 0n;
    }
  };

  // ── Calculate currency amount from token amount ──
  const calculateCurrencyAmount = (tokenAmount: string): bigint => {
    if (!tokenAmount || isNaN(parseFloat(tokenAmount))) return 0n;
    if (tokenPriceValue === 0n || currencyPrice === 0n) return 0n;

    try {
      const tokenAmountWei = parseUnits(tokenAmount, 18);
      // currencyAmount = (tokenAmount * currencyPrice) / tokenPrice
      const currencyAmount = (tokenAmountWei * currencyPrice) / tokenPriceValue;
      return currencyAmount;
    } catch {
      return 0n;
    }
  };

  const tokenAmount = calculateTokenAmount(amount);
  const currencyAmount = parseUnits(amount || '0', currencyDecimals);

  // ── Validation ──
  useEffect(() => {
    setError(null);

    if (!amount || parseFloat(amount) === 0) return;

    const numAmount = parseFloat(amount);

    // Check minimum purchase
    if (numAmount < 0.01) {
      setError('Minimum purchase is 0.01');
      return;
    }

    // Check user balance
    if (userBalance && currencyAmount > userBalance) {
      setError(`Insufficient balance. You have ${formatUnits(userBalance, currencyDecimals)} ${currency}`);
      return;
    }

    // Check wallet cap
    if (walletCap && tokenAmount > walletCap) {
      setError(`Exceeds wallet cap. You can buy ${formatUnits(walletCap, 18)} more FOR`);
      return;
    }

    // Check sale cap
    if (remainingSaleCap && tokenAmount > remainingSaleCap) {
      setError(`Exceeds remaining sale cap. Only ${formatUnits(remainingSaleCap, 18)} FOR left`);
      return;
    }
  }, [amount, userBalance, walletCap, remainingSaleCap, tokenAmount, currencyAmount, currencyDecimals, currency]);

  // ── Handlers ──
  const handleBuy = () => {
    if (!selectedCurrencyInfo || !amount) return;

    onBuy({
      currency,
      tokenAmount,
      currencyAmount,
    });
  };

  const handleMax = () => {
    if (!userBalance) return;
    const maxCurrency = formatUnits(userBalance, currencyDecimals);
    setAmount(maxCurrency);
  };

  // ── Format display values ──
  const displayTokenAmount = tokenAmount > 0n ? formatUnits(tokenAmount, 18) : '0';
  const displayCurrencyAmount = currencyAmount > 0n ? formatUnits(currencyAmount, currencyDecimals) : '0';

  // ── Vesting breakdown (25% immediate + 75% vested) ──
  const immediateTokens = tokenAmount > 0n ? tokenAmount / 4n : 0n;
  const vestedTokens = tokenAmount > 0n ? (tokenAmount * 3n) / 4n : 0n;

  return (
    <motion.div
      className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 max-w-md mx-auto"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="text-2xl font-bold text-teal-400 mb-1 text-center">Buy FOR Tokens</h2>
      <p className="text-xs text-zinc-500 text-center mb-4">25% immediate + 75% vested</p>

      {/* User Balance */}
      {connected && userBalance !== undefined && (
        <motion.div
          className="text-sm text-zinc-400 text-center mb-4 p-2 bg-zinc-800/50 rounded-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Balance: <span className="text-teal-300 font-semibold">{formatUnits(userBalance, currencyDecimals)} {currency}</span>
        </motion.div>
      )}

      {/* Currency Selection */}
      <div className="mb-4">
        <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">Payment Currency</label>
        <div className="grid grid-cols-4 gap-2">
          {CURRENCIES.map((c) => (
            <motion.button
              key={c.value}
              onClick={() => {
                setCurrency(c.value);
                setAmount('');
              }}
              disabled={!c.enabled}
              whileHover={c.enabled ? { scale: 1.05 } : {}}
              whileTap={c.enabled ? { scale: 0.95 } : {}}
              className={`p-2 rounded-lg text-xs font-medium transition-all ${
                currency === c.value
                  ? 'bg-teal-500 text-black shadow-lg shadow-teal-500/50'
                  : c.enabled
                  ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  : 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
              }`}
            >
              {c.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <label className="block text-xs text-zinc-500 uppercase tracking-wider">
            Amount ({currency})
          </label>
          {userBalance && (
            <button
              onClick={handleMax}
              className="text-xs text-teal-400 hover:text-teal-300 font-medium"
            >
              MAX
            </button>
          )}
        </div>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full p-3 rounded-lg bg-zinc-950 text-white border border-zinc-700 focus:border-teal-500 focus:outline-none transition-colors"
          min="0"
          step="0.001"
          disabled={!connected}
        />
      </div>

      {/* Preview & Breakdown */}
      <AnimatePresence>
        {amount && !error && (
          <motion.div
            className="mb-4 p-3 bg-zinc-800/50 rounded-lg space-y-2"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">You will receive:</span>
              <span className="text-teal-300 font-semibold">{displayTokenAmount} FOR</span>
            </div>
            <div className="border-t border-zinc-700 pt-2 space-y-1 text-xs">
              <div className="flex justify-between text-zinc-500">
                <span>• Immediate (25%):</span>
                <span className="text-emerald-400">{formatUnits(immediateTokens, 18)} FOR</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>• Vested (75%):</span>
                <span className="text-blue-400">{formatUnits(vestedTokens, 18)} FOR</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Message */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-xs text-center"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buy Button */}
      <motion.button
        onClick={handleBuy}
        disabled={loading || !connected || !amount || !!error}
        whileHover={!loading && connected && amount && !error ? { scale: 1.02 } : {}}
        whileTap={!loading && connected && amount && !error ? { scale: 0.98 } : {}}
        className={`w-full py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
          loading || !connected || !amount || error
            ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-teal-500 to-teal-400 hover:from-teal-400 hover:to-teal-300 text-black active:scale-95'
        }`}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {loading ? 'Processing...' : connected ? '🚀 Buy FOR' : '🔌 Connect Wallet'}
      </motion.button>

      {/* Info Note */}
      <p className="text-xs text-zinc-500 text-center mt-4">
        Tokens are allocated to your vesting schedule. Visit the Vesting page to track them.
      </p>
    </motion.div>
  );
}
