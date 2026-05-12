import { sepolia, mainnet } from 'wagmi/chains';

export type NetworkType = 'sepolia' | 'mainnet';

// ─── RPC من .env ─────────────────────────────────────────────────────────
const SEPOLIA_RPC = process.env.NEXT_PUBLIC_SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const MAINNET_RPC = process.env.NEXT_PUBLIC_MAINNET_RPC || 'https://eth.llamarpc.com';

export const NETWORKS = {
  sepolia: {
    chain: sepolia,
    name: 'Sepolia Testnet',
    rpc: SEPOLIA_RPC,
    explorer: 'https://sepolia.etherscan.io',
  },
  mainnet: {
    chain: mainnet,
    name: 'Ethereum Mainnet',
    rpc: MAINNET_RPC,
    explorer: 'https://etherscan.io',
  },
} as const;

export const ACTIVE_NETWORK: NetworkType = 
  (process.env.NEXT_PUBLIC_NETWORK as NetworkType) || 'sepolia';

export const CURRENT_CONTRACTS = {
  sepolia: {
    TOKEN: '0x6D08b0185d99cfdDD82D04BFca02D56b5C473A47',
    SALE: '0x90F77C253ac66Be9B5Bc3f243754182b19bD4AE6',
    AIRDROP: '0xCF9dC339E847602566fEd61E55A89A6aE909454a',
    VESTING: '0x59Df6f1f73b37571edeebF132D0aDB2765508E0c',
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    USDT: '0xAA0E2d147E6A4fEbcEbCedE87a5D3A6e6f3D6f3C',
    DAI: '0x3e622317f8C93f7328350cF0B8d9C6e5E1E6B5B5',
    WETH: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
  },
  mainnet: {
    TOKEN: '0x62Aa8E8b8E8b060a5C0279a70E3534e2Bc19aF10',
    SALE: '0xYOUR_MAINNET_SALE',
    AIRDROP: '0x3F79C228ff97B0491D9d8cbdA071df4a80338430',
    VESTING: '0x01260f7537E7E66cC33567C837F33e5D1DC7beb1',
    USDC: '0xA0b86a33E6441e0A421e56E4773C3C4b0Db7E5f0',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
}[ACTIVE_NETWORK];
