'use client';

import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';

// ─── Configuration ─────────────────────────────────────────────────────────
const ACTIVE_CHAIN = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? mainnet : sepolia;
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'c594cdcefb23dea78b9f2d92433cc330';

// ─── Wagmi Config with getDefaultConfig (Recommended for React 19) ──────────
const config = getDefaultConfig({
  appName: 'FOR Token Sale',
  projectId: PROJECT_ID,
  chains: [sepolia, mainnet],
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL_SEPOLIA || 'https://rpc.sepolia.org'),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_RPC_URL_MAINNET || 'https://eth.llamarpc.com'),
  },
  ssr: true,
});

// ─── Query Client ─────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ─── Provider Component ────────────────────────────────────────────────────
interface WagmiContextProviderProps {
  children: ReactNode;
}

export function WagmiContextProvider({ children }: WagmiContextProviderProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
