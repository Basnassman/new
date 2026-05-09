import { useState } from 'react';

export type Currency = 'STT' | 'USDT' | 'USDC' | 'ETH' | 'BSC';

interface CalculatorProps {
  connected: boolean;
  onBuy: (data: { currency: Currency; tokenAmount: number; currencyAmount: number }) => void;
  loading: boolean;
  balance?: string;
}

const CURRENCIES: { value: Currency; label: string; enabled: boolean }[] = [
  { value: 'STT', label: 'STT', enabled: true },
  { value: 'USDT', label: 'USDT', enabled: true },
  { value: 'USDC', label: 'USDC', enabled: true },
  { value: 'ETH', label: 'ETH', enabled: false }, // يحتاج Bridge
  { value: 'BSC', label: 'BSC', enabled: false }, // يحتاج Bridge
];

export default function Calculator({ connected, onBuy, loading, balance }: CalculatorProps) {
  const [currency, setCurrency] = useState<Currency>('STT');
  const [amount, setAmount] = useState('');

  const selectedCurrency = CURRENCIES.find(c => c.value === currency);

  const handleBuy = () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    
    if (!selectedCurrency?.enabled) {
      alert(`${currency} is coming soon via Bridge`);
      return;
    }
    
    onBuy({
      currency,
      tokenAmount: numAmount,
      currencyAmount: numAmount,
    });
  };

  return (
    <div className="bg-zinc-900 p-6 rounded-2xl border border-zinc-800 max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-teal-400 mb-4 text-center">Buy FGS1</h2>
      
      {balance && (
        <p className="text-sm text-zinc-400 text-center mb-4">
          Balance: {parseFloat(balance).toFixed(4)} STT
        </p>
      )}

      {/* اختيار العملة */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {CURRENCIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCurrency(c.value)}
            disabled={!c.enabled}
            className={`p-2 rounded-lg text-sm font-medium transition-all ${
              currency === c.value
                ? 'bg-teal-500 text-black'
                : c.enabled
                ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                : 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
            }`}
          >
            {c.label}
            {!c.enabled && <span className="block text-[8px]">Soon</span>}
          </button>
        ))}
      </div>

      {/* إدخال المبلغ */}
      <div className="mb-4">
        <label className="block text-sm text-zinc-400 mb-2">
          Amount ({currency})
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full p-3 rounded-lg bg-zinc-950 text-white border border-zinc-700 focus:border-teal-500 focus:outline-none transition-colors"
          min="0"
          step="0.001"
        />
      </div>

      {/* زر الشراء */}
      <button
        onClick={handleBuy}
        disabled={loading || !connected}
        className={`w-full py-3 rounded-lg font-semibold transition-all ${
          loading || !connected
            ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            : 'bg-teal-500 hover:bg-teal-400 text-black active:scale-95'
        }`}
      >
        {loading ? '⏳ Processing...' : connected ? '🚀 Buy FGS1' : '🔌 Connect Wallet'}
      </button>
    </div>
  );
}
