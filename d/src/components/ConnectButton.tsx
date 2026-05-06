'use client';

import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';

export default function ConnectButton() {
  const { disconnect } = useDisconnect();
  const { isConnected } = useAccount();

  const onReset = async () => {
    try {
      await disconnect();
    } catch (e) {
      console.warn(e);
    }
    window.location.reload();
  };

  return (
    <div className="flex gap-2 items-center">
      <RainbowConnectButton />
      {isConnected && (
        <button
          onClick={onReset}
          className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-500 text-sm"
        >
          Reset
        </button>
      )}
    </div>
  );
}
