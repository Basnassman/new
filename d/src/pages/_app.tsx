import type { AppProps } from 'next/app';
import { WagmiContextProvider } from '@/contexts/WagmiProvider';
import ClientLayout from '@/components/ClientLayout';
import '@rainbow-me/rainbowkit/styles.css';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiContextProvider>
      <ClientLayout>
        <Component {...pageProps} />
      </ClientLayout>
    </WagmiContextProvider>
  );
}
