import { useState, useEffect, useMemo, FC } from 'react';
import { useReadContract, useAccount } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, PRICE_ORACLE_ABI, TOKEN_ABI } from '@/config/abis';

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
  const { address } = useAccount();
  const [currency, setCurrency] = useState<Currency>('ETH');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // ── Get currency info ──
  const selectedCurrencyInfo = useMemo(
    () => CURRENCIES.find((c) => c.value === currency),
    [currency]
  );

  // ── Read Sale config ──
  const { data: saleCap } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'saleCap',
    query: { refetchInterval: 30000 },
  });

  const { data: totalSold } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'totalSold',
    query: { refetchInterval: 30000 },
  });

  const { data: minPurchase } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'minPurchase',
    query: { refetchInterval: 30000 },
  });

  const { data: saleStart } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'saleStart',
    query: { refetchInterval: 30000 },
  });

  const { data: saleEnd } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'saleEnd',
    query: { refetchInterval: 30000 },
  });

  const { data: paused } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'paused',
    query: { refetchInterval: 30000 },
  });

  const { data: finalized } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'finalized',
    query: { refetchInterval: 30000 },
  });

  // ── Read user's bought amount from Sale ──
  const { data: boughtAmount } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'bought',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15000 },
  });

  // ── Read Price Oracle for currency info ──
  const { data: currencyOracleInfo, isLoading: oracleLoading } = useReadContract({
    address: CURRENT_CONTRACTS.PRICE_ORACLE as `0x${string}`,
    abi: PRICE_ORACLE_ABI,
    functionName: 'getCurrency',
    args: selectedCurrencyInfo?.address ? [selectedCurrencyInfo.address] : undefined,
    query: {
      enabled: !!selectedCurrencyInfo?.address && !selectedCurrencyInfo?.isNative,
      refetchInterval: 10000,
    },
  });

  // ── Read Price Oracle quote ──
  const { data: quoteResult, isLoading: quoteLoading } = useReadContract({
    address: CURRENT_CONTRACTS.PRICE_ORACLE as `0x${string}`,
    abi: PRICE_ORACLE_ABI,
    functionName: 'quote',
    args: selectedCurrencyInfo?.address && amount && parseFloat(amount) > 0
      ? [selectedCurrencyInfo.address, parseUnits(amount, selectedCurrencyInfo.decimals)]
      : undefined,
    query: {
      enabled: !!selectedCurrencyInfo?.address && !selectedCurrencyInfo?.isNative && !!amount && parseFloat(amount) > 0,
      refetchInterval: 10000,
    },
  });

  // ── Read ETH price from oracle (for ETH purchases) ──
  const { data: ethOracleInfo } = useReadContract({
    address: CURRENT_CONTRACTS.PRICE_ORACLE as `0x${string}`,
    abi: PRICE_ORACLE_ABI,
    functionName: 'getCurrency',
    args: [CURRENT_CONTRACTS.WETH as `0x${string}`],
    query: { refetchInterval: 10000 },
  });

  // ── Derived values ──
  const currencyDecimals = selectedCurrencyInfo?.decimals ?? 18;

  const remainingSaleCap = useMemo(() => {
    if (!saleCap || !totalSold) return undefined;
    return (saleCap as bigint) - (totalSold as bigint);
  }, [saleCap, totalSold]);

  const tokenAmount = useMemo(() => {
    if (!amount || parseFloat(amount) === 0) return BigInt(0);
    
    if (selectedCurrencyInfo?.isNative) {
      // For ETH: use quote from oracle with WETH address
      if (!ethOracleInfo) return BigInt(0);
      try {
        const ethAmountWei = parseUnits(amount, 18);
        // quote from oracle: quote(WETH, ethAmount) -> tokenAmount
        // But we don't have quote for ETH in the new ABI... 
        // Fallback: calculate based on price ratio
        const ethPrice = (ethOracleInfo as any)?.[2] ?? BigInt(0);
        if (ethPrice === BigInt(0)) return BigInt(0);
        // Approximate: tokenAmount = ethAmount * ethPrice / 1e18 (simplified)
        return (ethAmountWei * ethPrice) / parseUnits('1', 18);
      } catch {
        return BigInt(0);
      }
    } else {
      // For ERC20: use quote result directly
      return (quoteResult as bigint) ?? BigInt(0);
    }
  }, [amount, selectedCurrencyInfo, quoteResult, ethOracleInfo]);

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
    setIsCalculating(oracleLoading || quoteLoading);

    const now = Math.floor(Date.now() / 1000);

    // Check sale active
    if (paused) {
      setError('Sale is currently paused.');
      return;
    }
    if (finalized) {
      setError('Sale has been finalized.');
      return;
    }
    if (saleStart && now < Number(saleStart as bigint)) {
      setError('Sale has not started yet.');
      return;
    }
    if (saleEnd && now > Number(saleEnd as bigint)) {
      setError('Sale has ended.');
      return;
    }

    if (!amount || parseFloat(amount) === 0) {
      return;
    }

    const numAmount = parseFloat(amount);

    // Check minimum purchase
    if (minPurchase && currencyAmount < (minPurchase as bigint)) {
      setError(`Minimum purchase is ${formatUnits(minPurchase as bigint, currencyDecimals)} ${currency}`);
      return;
    }

    // Check user balance
    if (userBalance && currencyAmount > userBalance) {
      setError(
        `Insufficient balance. You have ${formatUnits(userBalance, currencyDecimals)} ${currency}`
      );
      return;
    }

    // Check wallet cap
    const totalBought = (boughtAmount as bigint) ?? BigInt(0);
    const cap = walletCap ?? BigInt(0);
    if (cap > BigInt(0) && totalBought + tokenAmount > cap) {
      const remaining = cap > totalBought ? cap - totalBought : BigInt(0);
      setError(
        `Exceeds wallet cap. You can buy ${formatUnits(remaining, 18)} more FOR`
      );
      return;
    }

    // Check sale cap
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
    oracleLoading,
    quoteLoading,
    paused,
    finalized,
    saleStart,
    saleEnd,
    minPurchase,
    boughtAmount,
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