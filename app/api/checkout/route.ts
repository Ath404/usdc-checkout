import { NextResponse } from "next/server";
import { catalog, isItem } from "@/lib/catalog";
import { config } from "@/lib/config";
import { transferData } from "@/lib/evm";
import { createOrder, signOrder } from "@/lib/order";
import { transactionRequestUrl } from "@/lib/solana";

export async function POST(req: Request) {
  const { item } = (await req.json().catch(() => ({}))) as { item?: unknown };
  if (!isItem(item)) return NextResponse.json({ error: "unknown item" }, { status: 400 });

  const cfg = config();
  const order = createOrder(catalog[item].name, catalog[item].amount);
  const token = signOrder(order, cfg.secret);
  const origin = new URL(req.url).origin;

  return NextResponse.json({
    token,
    order: { id: order.id, item: order.item, amount: order.amount, expiresAt: order.expiresAt },
    solana: {
      url: transactionRequestUrl(`${origin}/api/checkout/solana?token=${token}`),
      cluster: cfg.solana.cluster,
    },
    evm: {
      chainId: cfg.evm.chainId,
      chainName: cfg.evm.chainName,
      rpc: cfg.evm.rpc,
      explorer: cfg.evm.explorer,
      to: cfg.evm.usdc,
      data: transferData(order, cfg.evm.recipient),
    },
  });
}
