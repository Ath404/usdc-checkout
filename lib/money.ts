/** USDC has 6 decimals on Solana and on every EVM chain Circle issues it on. */
export const USDC_DECIMALS = 6;

/** "12", "12.5", "12.000001" -> base units as bigint. Throws on more than 6 decimals instead of rounding. */
export function toBaseUnits(amount: string): bigint {
  const m = amount.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) throw new Error(`Invalid USDC amount: ${JSON.stringify(amount)}`);
  const units = BigInt(m[1]!) * 10n ** BigInt(USDC_DECIMALS) + BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
  if (units <= 0n) throw new Error("Amount must be positive");
  return units;
}

export function fromBaseUnits(units: bigint): string {
  const whole = units / 10n ** BigInt(USDC_DECIMALS);
  const frac = (units % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
