/**
 * Runs against a local solana-test-validator (SOLANA_TEST_RPC, default
 * http://127.0.0.1:8899): a 6-decimal mint stands in for USDC, the payer signs
 * the exact transaction the transaction-request endpoint builds, and the
 * verifier reads the result back from the chain.
 */
import { createMint, createTransferCheckedInstruction, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createOrder } from "@/lib/order";
import { buildTransfer, preflightSolana, verifySolana, type SolanaTarget } from "@/lib/solana";

const RPC = process.env.SOLANA_TEST_RPC ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC, "confirmed");
const payer = Keypair.generate();
const merchant = Keypair.generate();
let target: SolanaTarget;
let mint: PublicKey;

async function airdrop(to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function pay(tx: Transaction) {
  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
}

beforeAll(async () => {
  await airdrop(payer.publicKey, 2);
  mint = await createMint(connection, payer, payer.publicKey, null, 6);
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  await mintTo(connection, payer, mint, ata.address, payer, 1_000_000_000n);
  target = { recipient: merchant.publicKey.toBase58(), mint: mint.toBase58() };
});

describe("preflightSolana", () => {
  const opts = { testnet: true, cluster: "devnet" };

  it("passes a funded payer", async () => {
    expect(await preflightSolana(connection, createOrder("Field Kit", "4.00"), payer.publicKey, target, opts)).toBeNull();
  });

  it("explains a wallet with SOL but no USDC, with the faucet", async () => {
    const empty = Keypair.generate();
    await airdrop(empty.publicKey, 1);
    expect(await preflightSolana(connection, createOrder("Field Kit", "4.00"), empty.publicKey, target, opts)).toMatch(/holds 0 USDC on devnet and the order is 4\.00\. Test USDC is free at faucet\.circle\.com/);
  });

  it("explains a wallet with no SOL for fees", async () => {
    expect(await preflightSolana(connection, createOrder("Field Kit", "4.00"), Keypair.generate().publicKey, target, opts)).toMatch(/no SOL on devnet/);
  });

  it("refuses the merchant paying itself", async () => {
    expect(await preflightSolana(connection, createOrder("Field Kit", "4.00"), merchant.publicKey, target, opts)).toMatch(/merchant's own wallet/);
  });

  it("explains a wallet holding less than the order", async () => {
    expect(await preflightSolana(connection, createOrder("Field Kit", "100000.00"), payer.publicKey, target, opts)).toMatch(/holds 1000 USDC on devnet and the order is 100000\.00/);
  });
});

describe("verifySolana against a local validator", () => {
  it("is pending until something references the order", async () => {
    const order = createOrder("Field Kit", "4.00");
    expect((await verifySolana(connection, order, target)).status).toBe("pending");
  });

  it("accepts the endpoint's transaction, creating the merchant's token account on the way", async () => {
    const order = createOrder("Field Kit", "4.00");
    expect(await connection.getAccountInfo(getAssociatedTokenAddressSync(mint, merchant.publicKey))).toBeNull();
    await pay(await buildTransfer(connection, order, payer.publicKey, target));
    expect(await verifySolana(connection, order, target)).toMatchObject({ status: "paid" });
  });

  it("still works when the merchant's account already exists (idempotent create)", async () => {
    const order = createOrder("Field Kit", "40.00");
    await pay(await buildTransfer(connection, order, payer.publicKey, target));
    expect(await verifySolana(connection, order, target)).toMatchObject({ status: "paid" });
  });

  it("doesn't let one order's payment count for another", async () => {
    const paid = createOrder("Field Kit", "4.00");
    await pay(await buildTransfer(connection, paid, payer.publicKey, target));
    const other = createOrder("Field Kit", "4.00");
    expect((await verifySolana(connection, other, target)).status).toBe("pending");
  });

  it("names an underpayment that carries the right reference", async () => {
    const order = createOrder("Field Kit", "4.00");
    const from = getAssociatedTokenAddressSync(mint, payer.publicKey);
    const to = getAssociatedTokenAddressSync(mint, merchant.publicKey);
    const ix = createTransferCheckedInstruction(from, mint, to, payer.publicKey, 3_990_000n, 6);
    ix.keys.push({ pubkey: new PublicKey(order.solanaRef), isSigner: false, isWritable: false });
    await pay(new Transaction().add(ix));
    expect(await verifySolana(connection, order, target)).toMatchObject({ status: "rejected", detail: "merchant received 3990000 base units, order is 4000000" });
  });

  it("names a transfer that references the order but pays someone else", async () => {
    const order = createOrder("Field Kit", "4.00");
    const elsewhere = { ...target, recipient: Keypair.generate().publicKey.toBase58() };
    await pay(await buildTransfer(connection, order, payer.publicKey, elsewhere));
    expect(await verifySolana(connection, order, target)).toMatchObject({ status: "rejected", detail: expect.stringMatching(/moved no USDC to the merchant/) });
  });
});
