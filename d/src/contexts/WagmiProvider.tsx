'use client';

import { FC, ReactNode, useEffect, useState } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig, darkTheme } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';

/**
 * FIXED: To solve "Requested chains are not supported" on WalletConnect/TrustWallet:
 * 1. We include both mainnet and sepolia in the chains array.
 * 2. We use a single config instance.
 * 3. We ensure the projectId is correctly passed.
 */

const ACTIVE_CHAIN = process.env.NEXT_PUBLIC_NETWORK === 'mainnet' ? mainnet : sepolia;

// We include mainnet even if we are on Sepolia because some wallets 
// require a reference to a standard chain to initialize WalletConnect properly.
const chains = [ACTIVE_CHAIN, mainnet] as const;

const config = getDefaultConfig({
  appName: 'FOR Token Sale',
  projectId: 'c594cdcefb23dea78b9f2d92433cc330', // Your WalletConnect Project ID
  chains: chains,
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL_SEPOLIA || 'https://rpc.sepolia.org'),
    [mainnet.id]: http(process.env.NEXT_PUBLIC_RPC_URL_MAINNET || 'https://eth.llamarpc.com'),
  },
  ssr: true, // Set to true for Next.js
});

const queryClient = new QueryClient();

export const WagmiContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [mounted, setMounted] = useState(false);

  // Prevent Hydration Mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider 
          theme={darkTheme({
            accentColor: '#2dd4bf', // Teal 400
            accentColorForeground: 'black',
            borderRadius: 'large',
          })}
          initialChain={ACTIVE_CHAIN}
        >
          {mounted ? children : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
