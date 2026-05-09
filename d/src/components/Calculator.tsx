'use client';

import { useState, useEffect, useMemo, FC } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, TOKEN_ABI } from '@/config/abis';

export type Currency = 'ETH' | 'USDT' | 'USDC' | 'DAI';

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
  address?: `0x${string}`;
  enabled: boolean;
  decimals: number;
  isNative: boolean;
}

const CURRENCIES: CurrencyInfo[] = [
  {
    value: 'ETH',
    label: 'ETH',
    address: undefined,
    enabled: true,
    decimals: 18,
    isNative: true,
  },
  {
    value: 'USDT',
    label: 'USDT',
    address: CURRENT_CONTRACTS.USDT as `0x${string}`,
    enabled: true,
    decimals: 6,
    isNative: false,
  },
  {
    value: 'USDC',
    label: 'USDC',
    address: CURRENT_CONTRACTS.USDC as `0x${string}`,
    enabled: true,
    decimals: 6,
    isNative: false,
  },
  {
    value: 'DAI',
    label: 'DAI',
    address: CURRENT_CONTRACTS.DAI as `0x${string}`,
    enabled: true,
    decimals: 18,
    isNative: false,
  },
];

const Calculator: FC<CalculatorProps> = ({
  connected,
  onBuy,
  loading,
  userBalance,
  userPurchased,
  walletCap,
}) => {
  const [currency, setCurrency] = useState<Currency>('ETH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // ── Get currency info ──
  const selectedCurrencyInfo = useMemo(
    () => CURRENCIES.find((c) => c.value === currency),
    [currency]
  );

  // ── Read token price from Sale contract ──
  const { data: tokenPrice, isLoading: tokenPriceLoading } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'tokenPrice',
    query: {
      refetchInterval: 10000,
    },
  });

  // ── Read currency price from Sale contract (for ERC20 tokens only) ──
  const { data: currencyInfo, isLoading: currencyInfoLoading } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'getCurrencyInfo',
    args: selectedCurrencyInfo?.address ? [selectedCurrencyInfo.address] : undefined,
    query: {
      enabled: !!selectedCurrencyInfo?.address && !selectedCurrencyInfo?.isNative,
      refetchInterval: 10000,
    },
  });

  // ── Read remaining sale cap ──
  const { data: remainingSaleCap } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'remainingSaleCap',
    query: {
      refetchInterval: 30000,
    },
  });

  // ── Derived values with proper defaults ──
  const currencyDecimals = selectedCurrencyInfo?.decimals ?? 18;

  const currencyPrice = useMemo(() => {
    if (selectedCurrencyInfo?.isNative) {
      return tokenPrice ?? BigInt(1);
    } else {
      const info = currencyInfo as any;
      return info?.[2] ?? BigInt(1);
    }
  }, [selectedCurrencyInfo?.isNative, tokenPrice, currencyInfo]);

  const tokenPriceValue = useMemo(() => tokenPrice ?? BigInt(1), [tokenPrice]);

  // ── Calculate token amount from currency amount ──
  const calculateTokenAmount = (currencyAmount: string): bigint => {
    if (!currencyAmount || currencyAmount === '0' || isNaN(parseFloat(currencyAmount))) {
      return BigInt(0);
    }

    try {
      if (tokenPriceValue === BigInt(0) || currencyPrice === BigInt(0)) {
        return BigInt(0);
      }

      const currencyAmountWei = parseUnits(currencyAmount, currencyDecimals);
      const tokenAmount = (currencyAmountWei * tokenPriceValue) / currencyPrice;
      return tokenAmount;
    } catch (err) {
      console.error('Calculation error:', err);
      return BigInt(0);
    }
  };

  // ── Compute amounts ──
  const tokenAmount = useMemo(() => calculateTokenAmount(amount), [amount, tokenPriceValue, currencyPrice, currencyDecimals]);
  const currencyAmount = useMemo(() => {
    try {
      return parseUnits(amount || '0', currencyDecimals);
    } catch {
      return BigInt(0);
    }
  }, [amount, currencyDecimals]);

  // ── Validation ──
  useEffect(() => {
    setError(null);
    setIsCalculating(tokenPriceLoading || currencyInfoLoading);

    if (!amount || parseFloat(amount) === 0) {
      return;
    }

    const numAmount = parseFloat(amount);

    if (numAmount < 0.01) {
      setError('Minimum purchase is 0.01');
      return;
    }

    if (userBalance && currencyAmount > userBalance) {
      setError(
        `Insufficient balance. You have ${formatUnits(userBalance, currencyDecimals)} ${currency}`
      );
      return;
    }

    if (walletCap && tokenAmount > walletCap) {
      setError(
        `Exceeds wallet cap. You can buy ${formatUnits(walletCap, 18)} more FOR`
      );
      return;
    }

    if (remainingSaleCap && tokenAmount > remainingSaleCap) {
      setError(
        `Exceeds remaining sale cap. Only ${formatUnits(remainingSaleCap, 18)} FOR left`
      );
      return;
    }
  }, [
    amount,
    userBalance,
    walletCap,
    remainingSaleCap,
    tokenAmount,
    currencyAmount,
    currencyDecimals,
    currency,
    tokenPriceLoading,
    currencyInfoLoading,
  ]);

  // ── Handlers ──
  const handleBuy = () => {
    if (!selectedCurrencyInfo || !amount || error) return;

    onBuy({
      currency,
      tokenAmount,
      currencyAmount,
    });
  };

  const handleMax = () => {
    if (!userBalance) return;
    try {
      const maxCurrency = formatUnits(userBalance, currencyDecimals);
      setAmount(maxCurrency);
    } catch {
      setAmount('0');
    }
  };

  // ── Format display values ──
  const displayTokenAmount = useMemo(() => {
    try {
      return tokenAmount > BigInt(0) ? formatUnits(tokenAmount, 18) : '0';
    } catch {
      return '0';
    }
  }, [tokenAmount]);

  const displayCurrencyAmount = useMemo(() => {
    try {
      return currencyAmount > BigInt(0) ? formatUnits(currencyAmount, currencyDecimals) : '0';
    } catch {
      return '0';
    }
  }, [currencyAmount, currencyDecimals]);

  // ── Vesting breakdown (25% immediate + 75% vested) ──
  const immediateTokens = useMemo(() => {
    return tokenAmount > BigInt(0) ? tokenAmount / BigInt(4) : BigInt(0);
  }, [tokenAmount]);

  const vestedTokens = useMemo(() => {
    return tokenAmount > BigInt(0) ? (tokenAmount * BigInt(3)) / BigInt(4) : BigInt(0);
  }, [tokenAmount]);

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
          Balance:{' '}
          <span className="text-teal-300 font-semibold">
            {formatUnits(userBalance, currencyDecimals)} {currency}
          </span>
        </motion.div>
      )}

      {/* Currency Selection */}
      <div className="mb-4">
        <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">
          Payment Method
        </label>
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

      {/* Loading Indicator */}
      {isCalculating && amount && (
        <motion.div
          className="mb-3 text-xs text-zinc-400 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Fetching prices...
        </motion.div>
      )}

      {/* Preview & Breakdown */}
      <AnimatePresence>
        {amount && !error && !isCalculating && (
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
        disabled={loading || !connected || !amount || !!error || isCalculating}
        whileHover={!loading && connected && amount && !error && !isCalculating ? { scale: 1.02 } : {}}
        whileTap={!loading && connected && amount && !error && !isCalculating ? { scale: 0.98 } : {}}
        className={`w-full py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
          loading || !connected || !amount || error || isCalculating
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
        {selectedCurrencyInfo?.isNative
          ? 'ETH sent directly with transaction (no approval needed).'
          : 'Requires approval before purchase.'}
      </p>
    </motion.div>
  );
};

export default Calculator;
