/**
 * Runs the verifier against Circle's real USDC contract on a local fork of
 * Base Sepolia (anvil). This is the check that matters: that the deployed
 * FiatToken proxy accepts a transfer with the order reference appended, and
 * that the verifier accepts the right payment and names every wrong one.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, concatHex, http, keccak256, parseAbi, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { erc20, transferData, verifyEvm, type EvmTarget } from "@/lib/evm";
import { createOrder } from "@/lib/order";

const FORK = process.env.EVM_FORK_URL ?? "https://sepolia.base.org";
const PORT = 8546;
const RPC = `http://127.0.0.1:${PORT}`;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const MERCHANT = "0x000000000000000000000000000000000000bEEF" as const;
// A throwaway key generated per run; it only ever holds forked test balances.
const payer = privateKeyToAccount(generatePrivateKey());

let anvil: ChildProcess;
let client: PublicClient;
const target: EvmTarget = { chainId: 84532, usdc: USDC, recipient: MERCHANT, confirmations: 2 };
const usdc = parseAbi(["function balanceOf(address) view returns (uint256)"]);

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/** Find the slot of FiatToken's balances mapping by writing a balance and reading it back. */
async function fund(addr: Hex, amount: bigint) {
  for (let slot = 0n; slot < 20n; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [addr, slot]));
    const before = await rpc("eth_getStorageAt", [USDC, key, "latest"]);
    await rpc("anvil_setStorageAt", [USDC, key, `0x${amount.toString(16).padStart(64, "0")}`]);
    const bal = await client.readContract({ address: USDC, abi: usdc, functionName: "balanceOf", args: [addr] });
    if (bal === amount) return;
    await rpc("anvil_setStorageAt", [USDC, key, before]);
  }
  throw new Error("could not locate the USDC balances slot");
}

const wallet = () => createWalletClient({ account: payer, transport: http(RPC) });
async function send(data: Hex, to: Hex = USDC) {
  const hash = await wallet().sendTransaction({ to, data, chain: null });
  await client.waitForTransactionReceipt({ hash });
  return hash;
}
const mine = (n: number) => rpc("anvil_mine", [`0x${n.toString(16)}`]);

beforeAll(async () => {
  anvil = spawn("anvil", ["--fork-url", FORK, "--port", String(PORT), "--silent"], { stdio: "ignore" });
  client = createPublicClient({ transport: http(RPC) }) as PublicClient;
  for (let i = 0; i < 120; i++) {
    try {
      await client.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await rpc("anvil_setBalance", [payer.address, "0xDE0B6B3A7640000"]); // 1 ETH for gas
  await fund(payer.address, 1_000_000_000n);
});

afterAll(() => {
  anvil?.kill();
});

describe("verifyEvm against real USDC on a Base Sepolia fork", () => {
  it("accepts the right payment once it has enough confirmations", async () => {
    const order = createOrder("Field Kit", "4.00");
    const hash = await send(transferData(order, MERCHANT));

    expect((await verifyEvm(client, order, hash, target)).status).toBe("pending"); // 1 of 2
    await mine(1);
    const v = await verifyEvm(client, order, hash, target);
    expect(v, v.detail).toMatchObject({ status: "paid" });
    expect(await client.readContract({ address: USDC, abi: usdc, functionName: "balanceOf", args: [MERCHANT] })).toBeGreaterThanOrEqual(4_000_000n);
  });

  it("refuses to count one order's payment for another order", async () => {
    const paid = createOrder("Field Kit", "4.00");
    const hash = await send(transferData(paid, MERCHANT));
    await mine(2);
    const other = createOrder("Field Kit", "4.00");
    expect(await verifyEvm(client, other, hash, target)).toMatchObject({ status: "rejected", detail: expect.stringMatching(/different order reference/) });
  });

  it("names an underpayment", async () => {
    const order = createOrder("Field Kit", "4.00");
    const short = concatHex([encodeFunctionData({ abi: erc20, functionName: "transfer", args: [MERCHANT, 3_990_000n] }), order.evmRef]);
    const hash = await send(short);
    await mine(2);
    expect(await verifyEvm(client, order, hash, target)).toMatchObject({ status: "rejected", detail: expect.stringMatching(/3990000 base units, order is 4000000/) });
  });

  it("names a payment to someone else", async () => {
    const order = createOrder("Field Kit", "4.00");
    const hash = await send(transferData(order, "0x000000000000000000000000000000000000dEaD"));
    await mine(2);
    expect(await verifyEvm(client, order, hash, target)).toMatchObject({ status: "rejected", detail: expect.stringMatching(/not the merchant/) });
  });

  it("names a reverted transfer (payer without enough USDC)", async () => {
    const order = createOrder("Field Kit", "4.00");
    await fund(payer.address, 1n);
    const hash = await wallet().sendTransaction({ to: USDC, data: transferData(order, MERCHANT), chain: null, gas: 120_000n });
    await client.waitForTransactionReceipt({ hash });
    await mine(2);
    expect(await verifyEvm(client, order, hash, target)).toMatchObject({ status: "rejected", detail: "transaction reverted" });
    await fund(payer.address, 1_000_000_000n);
  });
});
