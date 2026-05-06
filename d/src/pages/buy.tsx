'use client';

import { useState } from 'react';
import { useAccount, useSendTransaction, useWriteContract, useBalance } from 'wagmi';
import { parseEther, parseUnits, formatEther } from 'viem';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { somniaTestnet, CONTRACTS, ERC20_ABI } from '@/config/somnia';
import Calculator, { Currency } from '@/components/Calculator';

const MERCHANT = CONTRACTS.MERCHANT as `0x${string}`;

const TOKEN_CONTRACTS: Record<Exclude<Currency, 'STT'>, `0x${string}`> = {
  USDT: CONTRACTS.USDT as `0x${string}`,
  USDC: CONTRACTS.USDC as `0x${string}`,
  ETH: CONTRACTS.WETH as `0x${string}`,
  BSC: CONTRACTS.WBSC as `0x${string}`,
};

const DECIMALS: Record<Currency, number> = {
  STT: 18,
  USDT: 6,
  USDC: 6,
  ETH: 18,
  BSC: 18,
};

export default function BuyPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  
  const { data: sttBalance } = useBalance({
    address,
    chainId: somniaTestnet.id,
  });

  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const onBuy = async ({
    currency,
    currencyAmount,
  }: {
    currency: Currency;
    tokenAmount: number;
    currencyAmount: number;
  }) => {
    try {
      setLoading(true);

      if (!isConnected) {
        openConnectModal?.();
        return;
      }

      if (!address) {
        alert('Wallet not connected');
        return;
      }

      let hash: `0x${string}`;

      if (currency === 'STT') {
        const value = parseEther(currencyAmount.toString());
        hash = await sendTransactionAsync({
          to: MERCHANT,
          value,
          chainId: somniaTestnet.id,
        });
      } else {
        const contractAddress = TOKEN_CONTRACTS[currency];
        const decimals = DECIMALS[currency];
        const amount = parseUnits(currencyAmount.toString(), decimals);

        hash = await writeContractAsync({
          address: contractAddress,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [MERCHANT, amount],
          chainId: somniaTestnet.id,
        });
      }

      setTxHash(hash);
    } catch (err: any) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('rejected') || msg.includes('denied')) {
        alert('Transaction rejected by user.');
      } else if (msg.includes('insufficient') || msg.includes('balance')) {
        alert('Insufficient balance.');
      } else {
        alert('Transaction failed. Try again.');
      }
      console.error('Transaction error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <Calculator 
        connected={isConnected} 
        onBuy={onBuy} 
        loading={loading} 
        balance={sttBalance ? formatEther(sttBalance.value) : undefined}
      />

      {txHash && (
        <p className="text-center mt-6 text-emerald-400">
          ✅ Success:{' '}
          <a
            href={`https://shannon-explorer.somnia.network/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-emerald-300"
          >
            {txHash}
          </a>
        </p>
      )}
    </div>
  );
}
