'use client';

import { useState, useEffect, useMemo, FC } from 'react';
import { useReadContract, useAccount } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { CURRENT_CONTRACTS } from '@/config/contracts';
import { SALE_ABI, PRICE_ORACLE_ABI, TOKEN_ABI } from '@/config/abis';

export type Currency = string; // عنوان العملة (address)

interface CalculatorProps {
  connected: boolean;
  onBuy: (data: {
    currency: Currency;
    tokenAmount: bigint;
    currencyAmount: bigint;
    decimals: number; // مهم جدًا لإرسال المنازل العشرية الصحيحة
  }) => void;
  loading: boolean;
  userBalance?: bigint;
  userPurchased?: bigint;
  walletCap?: bigint;
}

interface CurrencyInfo {
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}

// ─── قائمة تفاصيل العملات المعروفة (للتجميل فقط) ─────────────────
const KNOWN_CURRENCIES: Record<string, Omit<CurrencyInfo, 'address'>> = {
  // العنوان الصفري هو ETH
  '0x0000000000000000000000000000000000000000': {
    symbol: 'ETH',
    decimals: 18,
    isNative: true,
  },
  // أضف عناوين Sepolia الحقيقية لـ USDT, USDC, DAI إن وُجدت
  [CURRENT_CONTRACTS.USDT?.toLowerCase() ?? '']: {
    symbol: 'USDT',
    decimals: 6,
    isNative: false,
  },
  [CURRENT_CONTRACTS.USDC?.toLowerCase() ?? '']: {
    symbol: 'USDC',
    decimals: 6,
    isNative: false,
  },
  [CURRENT_CONTRACTS.DAI?.toLowerCase() ?? '']: {
    symbol: 'DAI',
    decimals: 18,
    isNative: false,
  },
};

const Calculator: FC<CalculatorProps> = ({
  connected,
  onBuy,
  loading,
  userBalance,
  userPurchased,
  walletCap,
}) => {
  const { address } = useAccount();
  const [selectedCurrencyAddress, setSelectedCurrencyAddress] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // ── جلب العملات النشطة من العقد ──
  const { data: supportedCurrencies } = useReadContract({
    address: CURRENT_CONTRACTS.PRICE_ORACLE as `0x${string}`,
    abi: PRICE_ORACLE_ABI,
    functionName: 'getCurrencies',
    query: { refetchInterval: 30000 },
  });

  // بناء قائمة العملات الديناميكية
  const currencies = useMemo<CurrencyInfo[]>(() => {
    if (!supportedCurrencies || !Array.isArray(supportedCurrencies)) return [];
    return (supportedCurrencies as string[]).map((addr: string) => {
      const lower = addr.toLowerCase();
      const known = KNOWN_CURRENCIES[lower];
      if (known) {
        return {
          address: addr,
          symbol: known.symbol,
          decimals: known.decimals,
          isNative: known.isNative,
        };
      }
      // عملة غير معروفة: نعرض أول 6 حروف من العنوان
      return {
        address: addr,
        symbol: addr.slice(0, 6) + '...',
        decimals: 18,
        isNative: false,
      };
    });
  }, [supportedCurrencies]);

  // اختيار افتراضي عند تحميل القائمة
  useEffect(() => {
    if (!selectedCurrencyAddress && currencies.length > 0) {
      // نفضل ETH إذا كانت موجودة
      const eth = currencies.find(c => c.isNative);
      setSelectedCurrencyAddress(eth ? eth.address : currencies[0].address);
    }
  }, [currencies, selectedCurrencyAddress]);

  const selectedCurrencyInfo = useMemo(
    () => currencies.find(c => c.address.toLowerCase() === selectedCurrencyAddress.toLowerCase()),
    [currencies, selectedCurrencyAddress]
  );

  // ── قراءة إعدادات البيع من العقد ──
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

  const { data: boughtAmount } = useReadContract({
    address: CURRENT_CONTRACTS.SALE as `0x${string}`,
    abi: SALE_ABI,
    functionName: 'bought',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15000 },
  });

  // ── السعر: استخدام quote للعملة المختارة ──
  const { data: quoteResult, isLoading: quoteLoading } = useReadContract({
    address: CURRENT_CONTRACTS.PRICE_ORACLE as `0x${string}`,
    abi: PRICE_ORACLE_ABI,
    functionName: 'quote',
    args:
      selectedCurrencyAddress && amount && parseFloat(amount) > 0 && selectedCurrencyInfo
        ? [selectedCurrencyAddress as `0x${string}`, parseUnits(amount, selectedCurrencyInfo.decimals)]
        : undefined,
    query: {
      enabled: !!selectedCurrencyAddress && !!amount && parseFloat(amount) > 0 && !!selectedCurrencyInfo,
      refetchInterval: 10000,
    },
  });

  // ── القيم المشتقة ──
  const currencyDecimals = selectedCurrencyInfo?.decimals ?? 18;

  const remainingSaleCap = useMemo(() => {
    if (!saleCap || !totalSold) return undefined;
    return (saleCap as bigint) - (totalSold as bigint);
  }, [saleCap, totalSold]);

  const tokenAmount = (quoteResult as bigint) ?? BigInt(0);

  const currencyAmount = useMemo(() => {
    try {
      return parseUnits(amount || '0', currencyDecimals);
    } catch {
      return BigInt(0);
    }
  }, [amount, currencyDecimals]);

  // ── التحقق من الأخطاء ──
  useEffect(() => {
    setError(null);
    setIsCalculating(quoteLoading && !!amount && parseFloat(amount) > 0);

    const now = Math.floor(Date.now() / 1000);
    if (paused) { setError('Sale is currently paused.'); return; }
    if (finalized) { setError('Sale has been finalized.'); return; }
    if (saleStart && now < Number(saleStart as bigint)) { setError('Sale has not started yet.'); return; }
    if (saleEnd && now > Number(saleEnd as bigint)) { setError('Sale has ended.'); return; }

    if (!amount || parseFloat(amount) === 0) return;

    if (minPurchase && currencyAmount < (minPurchase as bigint)) {
      setError(`Minimum purchase is ${formatUnits(minPurchase as bigint, currencyDecimals)} ${selectedCurrencyInfo?.symbol}`);
      return;
    }

    if (userBalance && currencyAmount > userBalance) {
      setError(`Insufficient balance. You have ${formatUnits(userBalance, currencyDecimals)} ${selectedCurrencyInfo?.symbol}`);
      return;
    }

    const totalBought = (boughtAmount as bigint) ?? BigInt(0);
    const cap = walletCap ?? BigInt(0);
    if (cap > BigInt(0) && totalBought + tokenAmount > cap) {
      const remaining = cap > totalBought ? cap - totalBought : BigInt(0);
      setError(`Exceeds wallet cap. You can buy ${formatUnits(remaining, 18)} more FOR`);
      return;
    }

    if (remainingSaleCap && tokenAmount > remainingSaleCap) {
      setError(`Exceeds remaining sale cap. Only ${formatUnits(remainingSaleCap, 18)} FOR left`);
      return;
    }
  }, [
    amount, userBalance, walletCap, remainingSaleCap, tokenAmount,
    currencyAmount, currencyDecimals, selectedCurrencyInfo, quoteLoading,
    paused, finalized, saleStart, saleEnd, minPurchase, boughtAmount,
  ]);

  // ── الإجراءات ──
  const handleBuy = () => {
    if (!selectedCurrencyAddress || !amount || error) return;
    onBuy({
      currency: selectedCurrencyAddress,
      tokenAmount,
      currencyAmount,
      decimals: currencyDecimals,
    });
  };

  const handleMax = () => {
    if (!userBalance) return;
    setAmount(formatUnits(userBalance, currencyDecimals));
  };

  // ── العرض ──
  const displayTokenAmount = tokenAmount > BigInt(0) ? formatUnits(tokenAmount, 18) : '0';

  return (
    <motion.div
      className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 max-w-md mx-auto"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="text-2xl font-bold text-teal-400 mb-1 text-center">Buy FOR Tokens</h2>
      <p className="text-xs text-zinc-500 text-center mb-4">100% locked · Vesting starts May 20</p>

      {/* رصيد المستخدم */}
      {connected && userBalance !== undefined && selectedCurrencyInfo && (
        <motion.div
          className="text-sm text-zinc-400 text-center mb-4 p-2 bg-zinc-800/50 rounded-lg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Balance:{' '}
          <span className="text-teal-300 font-semibold">
            {formatUnits(userBalance, currencyDecimals)} {selectedCurrencyInfo.symbol}
          </span>
        </motion.div>
      )}

      {/* اختيار العملة - ديناميكي */}
      <div className="mb-4">
        <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">
          Payment Method
        </label>
        <div className="grid grid-cols-4 gap-2">
          {currencies.map((c) => (
            <motion.button
              key={c.address}
              onClick={() => { setSelectedCurrencyAddress(c.address); setAmount(''); }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`p-2 rounded-lg text-xs font-medium transition-all ${
                selectedCurrencyAddress === c.address
                  ? 'bg-teal-500 text-black shadow-lg shadow-teal-500/50'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {c.symbol}
            </motion.button>
          ))}
        </div>
      </div>

      {/* إدخال المبلغ */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <label className="block text-xs text-zinc-500 uppercase tracking-wider">
            Amount ({selectedCurrencyInfo?.symbol})
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

      {/* مؤشر التحميل */}
      {isCalculating && (
        <motion.div
          className="mb-3 text-xs text-zinc-400 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          Fetching prices...
        </motion.div>
      )}

      {/* معاينة التوكنات */}
      <AnimatePresence>
        {amount && !error && !isCalculating && (
          <motion.div
            className="mb-4 p-3 bg-zinc-800/50 rounded-lg"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="flex justify-between text-sm">
              <span className="text-zinc-400">You will receive:</span>
              <span className="text-teal-300 font-semibold">{displayTokenAmount} FOR</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* رسالة خطأ */}
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

      {/* زر الشراء */}
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
        {loading ? 'Processing...' : connected ? '🚀 Buy FOR' : '🔌 Connect Wallet'}
      </motion.button>

      <p className="text-xs text-zinc-500 text-center mt-4">
        {selectedCurrencyInfo?.isNative
          ? 'ETH sent directly with transaction (no approval needed).'
          : 'Requires approval before purchase.'}
      </p>
    </motion.div>
  );
};

export default Calculator;