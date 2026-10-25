import { concatHex, createPublicClient, decodeEventLog, decodeFunctionData, encodeFunctionData, http, isAddressEqual, parseAbi, size, sliceHex, type Hash, type Hex, type PublicClient } from "viem";
import { toBaseUnits } from "./money";
import type { Order } from "./order";
import type { Verdict } from "./verdict";

export const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);

export interface EvmTarget {
  chainId: number;
  usdc: `0x${string}`;
  recipient: `0x${string}`;
  confirmations: number;
}

/**
 * ERC-20 transfer calldata with the order reference appended. The token's ABI
 * decoder ignores trailing bytes, so the transfer behaves normally, but the
 * reference is now part of the signed transaction and can be checked later.
 */
export function transferData(order: Order, recipient: `0x${string}`): Hex {
  const call = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [recipient, toBaseUnits(order.amount)] });
  return concatHex([call, order.evmRef]);
}

export function evmClient(rpc: string): PublicClient {
  return createPublicClient({ transport: http(rpc) }) as PublicClient;
}

/** Check one transaction hash against one order. Every rule that fails is named in the verdict. */
export async function verifyEvm(client: PublicClient, order: Order, hash: Hash, t: EvmTarget): Promise<Verdict> {
  const tx = await client.getTransaction({ hash }).catch(() => null);
  if (!tx) return { status: "pending", detail: "transaction not found yet" };
  if (tx.chainId !== undefined && tx.chainId !== t.chainId) return { status: "rejected", detail: `sent on chain ${tx.chainId}, expected ${t.chainId}` };
  if (!tx.to || !isAddressEqual(tx.to, t.usdc)) return { status: "rejected", detail: `sent to ${tx.to}, not the USDC contract` };

  const expected = toBaseUnits(order.amount);
  if (size(tx.input) !== 4 + 64 + 32) return { status: "rejected", detail: "calldata is not a transfer carrying this order's reference" };
  const ref = sliceHex(tx.input, 4 + 64);
  if (ref.toLowerCase() !== order.evmRef.toLowerCase()) return { status: "rejected", detail: "transaction carries a different order reference" };
  const call = decodeFunctionData({ abi: erc20, data: sliceHex(tx.input, 0, 4 + 64) });
  const [to, amount] = call.args as [`0x${string}`, bigint];
  if (!isAddressEqual(to, t.recipient)) return { status: "rejected", detail: `transfer goes to ${to}, not the merchant` };
  if (amount !== expected) return { status: "rejected", detail: `transfer is ${amount} base units, order is ${expected}` };

  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return { status: "pending", detail: "waiting to be mined" };
  if (receipt.status !== "success") return { status: "rejected", detail: "transaction reverted" };

  // The calldata says what was asked for; the Transfer log says what happened.
  const moved = receipt.logs.some((log) => {
    if (!isAddressEqual(log.address, t.usdc)) return false;
    try {
      const ev = decodeEventLog({ abi: erc20, data: log.data, topics: log.topics });
      return ev.eventName === "Transfer" && isAddressEqual(ev.args.to, t.recipient) && ev.args.value === expected;
    } catch {
      return false;
    }
  });
  if (!moved) return { status: "rejected", detail: "no matching USDC Transfer event in the receipt" };

  const head = await client.getBlockNumber({ cacheTime: 0 });
  const confirmations = Number(head - receipt.blockNumber) + 1;
  if (confirmations < t.confirmations) return { status: "pending", detail: `${confirmations}/${t.confirmations} confirmations` };

  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  const late = Number(block.timestamp) > order.expiresAt;
  return { status: "paid", detail: `${confirmations} confirmations${late ? ", paid after the order expired" : ""}`, late, signature: hash };
}
