import { Connection, PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { readOrder } from "@/lib/order";
import { buildTransfer, preflightSolana } from "@/lib/solana";

/**
 * Solana Pay transaction request endpoint. A wallet that scans the QR code
 * calls GET for the label, then POSTs the payer's account and gets back the
 * transaction to sign. The browser-wallet button uses the same POST.
 */
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function OPTIONS() {
  return new NextResponse(null, { headers: cors });
}

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return NextResponse.json({ label: "USDC Checkout demo", icon: `${origin}/icon.svg` }, { headers: cors });
}

export async function POST(req: Request) {
  const cfg = config();
  const token = new URL(req.url).searchParams.get("token") ?? "";
  let order;
  try {
    order = readOrder(token, cfg.secret);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: cors });
  }
  if (Date.now() / 1000 > order.expiresAt) return NextResponse.json({ error: "order expired" }, { status: 410, headers: cors });

  const { account } = (await req.json().catch(() => ({}))) as { account?: string };
  let payer: PublicKey;
  try {
    payer = new PublicKey(account ?? "");
  } catch {
    return NextResponse.json({ error: "account must be a public key" }, { status: 400, headers: cors });
  }

  const connection = new Connection(cfg.solana.rpc, "confirmed");
  const problem = await preflightSolana(connection, order, payer, cfg.solana, { testnet: cfg.solana.cluster !== "mainnet-beta", cluster: cfg.solana.cluster });
  // `message` is what Solana Pay wallets display; `error` is what our own page reads.
  if (problem) return NextResponse.json({ error: problem, message: problem }, { status: 400, headers: cors });

  const tx = await buildTransfer(connection, order, payer, cfg.solana);
  const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  return NextResponse.json({ transaction, message: `${order.item}, ${order.amount} USDC` }, { headers: cors });
}
