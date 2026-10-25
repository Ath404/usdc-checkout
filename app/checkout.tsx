"use client";

import { Transaction } from "@solana/web3.js";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Verdict } from "@/lib/verdict";

type Item = { id: string; name: string; amount: string };
type Created = {
  token: string;
  order: { id: string; item: string; amount: string; expiresAt: number };
  solana: { url: string; cluster: string };
  evm: { chainId: number; chainName: string; rpc: string; explorer: string; to: `0x${string}`; data: `0x${string}` };
};

type SolanaProvider = {
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
};
type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    ethereum?: Eip1193;
  }
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function Checkout({ items }: { items: Item[] }) {
  const [item, setItem] = useState(items[0]!.id);
  const [chain, setChain] = useState<"solana" | "evm">("solana");
  const [created, setCreated] = useState<Created | null>(null);
  const [qr, setQr] = useState("");
  const [evmTx, setEvmTx] = useState<string>("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const polling = useRef<number | null>(null);

  const start = async () => {
    setError("");
    setVerdict(null);
    setEvmTx("");
    setBusy(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "could not create order");
      setCreated(data);
      setQr(await QRCode.toDataURL(data.solana.url, { margin: 1, width: 232, color: { dark: "#15171B", light: "#EEF0EA" } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = useCallback(async () => {
    if (!created) return;
    if (chain === "evm" && !evmTx) return;
    const q = new URLSearchParams({ token: created.token, chain });
    if (chain === "evm") q.set("tx", evmTx);
    const res = await fetch(`/api/checkout/verify?${q}`);
    const v = (await res.json()) as Verdict;
    setVerdict(v);
    if (v.status !== "pending" && polling.current) {
      clearInterval(polling.current);
      polling.current = null;
    }
  }, [created, chain, evmTx]);

  // Poll while an order is open. For Solana a QR payment can arrive at any moment; for EVM only after a hash exists.
  useEffect(() => {
    if (!created || verdict?.status === "paid") return;
    if (chain === "evm" && !evmTx) return;
    polling.current = window.setInterval(check, 3000);
    return () => {
      if (polling.current) clearInterval(polling.current);
      polling.current = null;
    };
  }, [created, chain, evmTx, check, verdict?.status]);

  const paySolana = async () => {
    if (!created) return;
    setError("");
    const wallet = window.phantom?.solana ?? window.solflare;
    if (!wallet) return setError("No Solana browser wallet found. Scan the QR code with a mobile wallet instead.");
    try {
      const { publicKey } = await wallet.connect();
      const res = await fetch(`/api/checkout/solana?token=${encodeURIComponent(created.token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: publicKey.toString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "could not build transaction");
      await wallet.signAndSendTransaction(Transaction.from(b64ToBytes(data.transaction)));
      setVerdict({ status: "pending", detail: "sent, waiting for confirmation" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const payEvm = async () => {
    if (!created) return;
    setError("");
    const eth = window.ethereum;
    if (!eth) return setError("No EVM browser wallet found.");
    try {
      const [from] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const chainHex = `0x${created.evm.chainId.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: chainHex, chainName: created.evm.chainName, rpcUrls: [created.evm.rpc], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: [created.evm.explorer] }],
        });
      }
      const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: created.evm.to, data: created.evm.data }] })) as string;
      setEvmTx(hash);
      setVerdict({ status: "pending", detail: "sent, waiting for confirmations" });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const selected = items.find((i) => i.id === item)!;

  return (
    <section className="checkout" aria-label="Checkout">
      <fieldset className="items" disabled={!!created}>
        <legend>Plan</legend>
        {items.map((i) => (
          <label key={i.id} className={i.id === item ? "on" : ""}>
            <input type="radio" name="item" value={i.id} checked={i.id === item} onChange={() => setItem(i.id)} />
            <span>{i.name}</span>
            <span className="mono">{i.amount} USDC</span>
          </label>
        ))}
      </fieldset>

      {!created ? (
        <button className="primary" onClick={start} disabled={busy}>
          {busy ? "Creating order…" : `Pay ${selected.amount} USDC`}
        </button>
      ) : (
        <div className="pay">
          <div className="meta mono">
            order {created.order.id} · {created.order.amount} USDC · expires {new Date(created.order.expiresAt * 1000).toLocaleTimeString()}
          </div>

          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={chain === "solana"} onClick={() => setChain("solana")}>
              Solana ({created.solana.cluster})
            </button>
            <button role="tab" aria-selected={chain === "evm"} onClick={() => setChain("evm")}>
              {created.evm.chainName}
            </button>
          </div>

          {chain === "solana" ? (
            <div className="panel">
              {qr && <img src={qr} width={232} height={232} alt="Solana Pay QR code for this order" />}
              <p>Scan with a Solana mobile wallet, or pay from a browser wallet.</p>
              <button className="primary" onClick={paySolana}>
                Pay with browser wallet
              </button>
            </div>
          ) : (
            <div className="panel">
              <p>
                One USDC transfer on {created.evm.chainName}. The order reference rides along in the transaction data, so the payment can only ever count for this order.
              </p>
              <button className="primary" onClick={payEvm} disabled={!!evmTx}>
                {evmTx ? "Sent" : "Pay with browser wallet"}
              </button>
              {evmTx && (
                <a className="mono small" href={`${created.evm.explorer}/tx/${evmTx}`} target="_blank" rel="noreferrer">
                  {evmTx.slice(0, 10)}…{evmTx.slice(-8)}
                </a>
              )}
            </div>
          )}

          {verdict && (
            <p className={`status ${verdict.status}`} role="status">
              <span className="mono">{verdict.status}</span> {verdict.detail}
            </p>
          )}
          <button className="link" onClick={() => setCreated(null)}>
            Start over
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
