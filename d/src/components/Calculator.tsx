import { useState } from 'react';

export type Currency = 'STT' | 'USDT' | 'USDC' | 'ETH' | 'BSC';

interface CalculatorProps {
  connected: boolean;
  onBuy: (data: { currency: Currency; tokenAmount: number; currencyAmount: number }) => void;
  loading: boolean;
  balance?: string;
}

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'STT', label: 'STT' },
  { value: 'USDT', label: 'USDT' },
  { value: 'USDC', label: 'USDC' },
  { value: 'ETH', label: 'ETH' },
  { value: 'BSC', label: 'BSC' },
];

export default function Calculator({ connected, onBuy, loading, balance }: CalculatorProps) {
  const [currency, setCurrency] = useState<Currency>('STT');
  const [amount, setAmount] = useState('');

  const handleBuy = () => {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert('Enter valid amount');
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

      <div className="grid grid-cols-5 gap-2 mb-4">
        {CURRENCIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setCurrency(c.value)}
            className={`p-2 rounded-lg text-sm font-medium transition ${
              currency === c.value
                ? 'bg-teal-500 text-black'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <label className="block text-sm text-zinc-400 mb-2">Amount ({currency})</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full p-3 rounded-lg bg-zinc-950 text-white border border-zinc-700 focus:border-teal-500 focus:outline-none"
          min="0"
          step="0.001"
        />
      </div>

      <button
        onClick={handleBuy}
        disabled={loading || !connected}
        className={`w-full py-3 rounded-lg font-semibold transition ${
          loading || !connected
            ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
            : 'bg-teal-500 hover:bg-teal-400 text-black'
        }`}
      >
        {loading ? 'Processing...' : connected ? 'Buy' : 'Connect Wallet'}
      </button>
    </div>
  );
}
