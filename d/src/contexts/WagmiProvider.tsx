'use client';

import { FC, ReactNode, useEffect, useState } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';

// اختر الشبكة من متغير البيئة
const ACTIVE_CHAIN = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? mainnet : sepolia;

const config = getDefaultConfig({
  appName: 'FOR Token Sale',
  projectId: 'c594cdcefb23dea78b9f2d92433cc330',
  chains: [ACTIVE_CHAIN],
  transports: {
    [ACTIVE_CHAIN.id]: http(
      process.env.NEXT_PUBLIC_RPC_URL || 
      (ACTIVE_CHAIN === mainnet 
        ? 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY'
        : 'https://rpc.sepolia.org'
      )
    ),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export const WagmiContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {mounted ? children : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
