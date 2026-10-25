/**
 * Everything chain-specific comes from env. Defaults point at test networks
 * (Solana devnet, Base Sepolia) and Circle's test USDC on each, so the demo
 * never touches real money.
 */
export interface Config {
  secret: string;
  solana: { rpc: string; recipient: string; mint: string; cluster: string };
  evm: { rpc: string; chainId: number; chainName: string; recipient: `0x${string}`; usdc: `0x${string}`; confirmations: number; explorer: string };
}

export function config(env: Record<string, string | undefined> = process.env): Config {
  const secret = env.CHECKOUT_SECRET;
  if (!secret || secret.length < 32) throw new Error("CHECKOUT_SECRET must be set to at least 32 characters");
  return {
    secret,
    solana: {
      rpc: env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      recipient: required(env, "SOLANA_RECIPIENT"),
      // Circle's devnet USDC.
      mint: env.SOLANA_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      cluster: env.SOLANA_CLUSTER ?? "devnet",
    },
    evm: {
      rpc: env.EVM_RPC ?? "https://sepolia.base.org",
      chainId: Number(env.EVM_CHAIN_ID ?? 84532),
      chainName: env.EVM_CHAIN_NAME ?? "Base Sepolia",
      recipient: required(env, "EVM_RECIPIENT") as `0x${string}`,
      // Circle's Base Sepolia USDC.
      usdc: (env.EVM_USDC ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
      confirmations: Number(env.EVM_CONFIRMATIONS ?? 2),
      explorer: env.EVM_EXPLORER ?? "https://sepolia.basescan.org",
    },
  };
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} must be set`);
  return v;
}
