import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { toBaseUnits, USDC_DECIMALS } from "./money";
import type { Order } from "./order";
import type { Verdict } from "./verdict";

export interface SolanaTarget {
  recipient: string;
  mint: string;
}

/**
 * The transaction a Solana Pay transaction request returns: create the
 * merchant's USDC account if it doesn't exist yet (idempotent, so it's a no-op
 * normally), then a checked transfer with the order reference attached as a
 * read-only key, which is how the payment is found again later.
 */
export async function buildTransfer(connection: Connection, order: Order, payer: PublicKey, t: SolanaTarget): Promise<Transaction> {
  const mint = new PublicKey(t.mint);
  const recipient = new PublicKey(t.recipient);
  const from = getAssociatedTokenAddressSync(mint, payer);
  const to = getAssociatedTokenAddressSync(mint, recipient, true);

  const transfer = createTransferCheckedInstruction(from, mint, to, payer, toBaseUnits(order.amount), USDC_DECIMALS);
  transfer.keys.push({ pubkey: new PublicKey(order.solanaRef), isSigner: false, isWritable: false });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(createAssociatedTokenAccountIdempotentInstruction(payer, to, recipient, mint), transfer);
  return tx;
}

/** Net change in the recipient's balance of `mint` across a transaction, in base units. */
export function receivedBy(tx: ParsedTransactionWithMeta, recipient: string, mint: string): bigint {
  const pre = new Map<number, bigint>();
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.owner === recipient && b.mint === mint) pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
  let delta = 0n;
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.owner !== recipient || b.mint !== mint) continue;
    delta += BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
  }
  return delta;
}

/**
 * Find transactions that mention the order reference and check what actually
 * landed in the merchant's account, from the chain's own balance records
 * rather than from what the instruction claimed.
 */
export async function verifySolana(connection: Connection, order: Order, t: SolanaTarget): Promise<Verdict> {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(order.solanaRef), { limit: 20 }, "confirmed");
  if (sigs.length === 0) return { status: "pending", detail: "no transaction references this order yet" };

  const expected = toBaseUnits(order.amount);
  let lastProblem = "";
  for (const s of [...sigs].reverse()) {
    if (s.err) {
      lastProblem = `transaction ${s.signature.slice(0, 8)}… failed on-chain`;
      continue;
    }
    const tx = await connection.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    const got = receivedBy(tx, t.recipient, t.mint);
    if (got === expected) {
      const late = (tx.blockTime ?? 0) > order.expiresAt;
      return { status: "paid", detail: `confirmed in slot ${tx.slot}${late ? ", paid after the order expired" : ""}`, late, signature: s.signature };
    }
    lastProblem = got === 0n ? "transaction references this order but moved no USDC to the merchant" : `merchant received ${got} base units, order is ${expected}`;
  }
  return { status: "rejected", detail: lastProblem };
}

/** solana:<url> for a Solana Pay transaction request, as wallets expect it in a QR code. */
export function transactionRequestUrl(endpoint: string): string {
  return `solana:${encodeURIComponent(endpoint)}`;
}
