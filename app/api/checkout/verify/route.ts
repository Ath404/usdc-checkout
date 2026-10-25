import { Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { evmClient, verifyEvm } from "@/lib/evm";
import { readOrder } from "@/lib/order";
import { verifySolana } from "@/lib/solana";
import type { Verdict } from "@/lib/verdict";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = config();
  const q = new URL(req.url).searchParams;
  let order;
  try {
    order = readOrder(q.get("token") ?? "", cfg.secret);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  let verdict: Verdict;
  if (q.get("chain") === "evm") {
    const tx = q.get("tx") ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return NextResponse.json({ error: "tx must be a transaction hash" }, { status: 400 });
    verdict = await verifyEvm(evmClient(cfg.evm.rpc), order, tx as `0x${string}`, cfg.evm);
  } else {
    verdict = await verifySolana(new Connection(cfg.solana.rpc, "confirmed"), order, cfg.solana);
  }

  // Expire only when nothing was ever sent. A transaction submitted in time but still confirming stays pending.
  const nothingSent = verdict.status === "pending" && /not found|no transaction/.test(verdict.detail);
  if (nothingSent && Date.now() / 1000 > order.expiresAt) verdict = { status: "expired", detail: "no payment before the order expired" };
  return NextResponse.json(verdict);
}
