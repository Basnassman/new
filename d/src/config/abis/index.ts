import TokenJson from './Token.json';
import SaleJson from './Sale.json';
import VestingJson from './Vesting.json';
import IPriceOracleJson from './IPriceOracle.json';

// ─── Token ABI ───────────────────────────────────────────────────────────────
export const TOKEN_ABI = TokenJson.abi as const;

// ─── Sale ABI ─────────────────────────────────────────────────────────────────
export const SALE_ABI = SaleJson.abi as const;

// ─── Vesting ABI ──────────────────────────────────────────────────────────────
export const VESTING_ABI = VestingJson.abi as const;

// ─── Price Oracle ABI ─────────────────────────────────────────────────────────
export const PRICE_ORACLE_ABI = IPriceOracleJson.abi as const;