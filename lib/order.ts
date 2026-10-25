import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { toBaseUnits } from "./money";

/**
 * An order is a signed token, not a database row. It carries everything the
 * verifier needs: the amount, and one reference per chain that the payer's
 * transaction must contain. Because the reference is unique per order and is
 * inside the transaction, a payment can't be replayed against another order,
 * and nothing has to be stored to know that.
 */
export interface Order {
  v: 1;
  id: string;
  item: string;
  /** Decimal USDC, e.g. "12.00". */
  amount: string;
  /** Solana Pay reference: a random public key added to the transfer instruction. */
  solanaRef: string;
  /** 32 random bytes appended to the ERC-20 transfer calldata. */
  evmRef: `0x${string}`;
  /** Unix seconds. */
  createdAt: number;
  expiresAt: number;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function createOrder(item: string, amount: string, ttlSeconds = 30 * 60, now = Math.floor(Date.now() / 1000)): Order {
  toBaseUnits(amount);
  return {
    v: 1,
    id: randomBytes(6).toString("hex"),
    item,
    amount,
    solanaRef: Keypair.generate().publicKey.toBase58(),
    evmRef: `0x${randomBytes(32).toString("hex")}`,
    createdAt: now,
    expiresAt: now + ttlSeconds,
  };
}

export function signOrder(order: Order, secret: string): string {
  const body = b64u(JSON.stringify(order));
  return `${body}.${b64u(mac(secret, body))}`;
}

/** Returns the order if the signature is valid. Expiry is the caller's decision: a late payment is still a payment. */
export function readOrder(token: string, secret: string): Order {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Malformed order token");
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("Order token signature does not match");
  const order = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Order;
  if (order.v !== 1) throw new Error("Unknown order version");
  return order;
}
