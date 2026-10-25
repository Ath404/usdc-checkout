import { catalog } from "@/lib/catalog";
import { Checkout } from "./checkout";

export default function Page() {
  const items = Object.entries(catalog).map(([id, v]) => ({ id, name: v.name, amount: v.amount }));
  return (
    <main className="wrap">
      <header>
        <div className="topbar">
          <p className="kicker mono">Demo · test networks only</p>
          <a className="hire" href="https://atharvc.tech/hire">
            Hire me
          </a>
        </div>
        <h1>USDC checkout for a Next.js site</h1>
        <p className="lede">
          Customers pay in USDC on Solana or on an EVM chain. The server confirms the money actually arrived before the order counts. Orders are signed tokens, so there is no database to run.
        </p>
      </header>

      <Checkout items={items} />

      <section className="cta">
        <h2>Want USDC payments on your site?</h2>
        <p>
          I add this to existing sites and apps: Solana, EVM, or both, wired into your orders and fulfilment, with tests against the real USDC contracts. Fixed scope and price before I start.
        </p>
        <a className="hire big" href="https://atharvc.tech/hire">
          Hire me
        </a>
      </section>

      <section className="notes">
        <h2>How a payment is confirmed</h2>
        <ol>
          <li>
            The server prices the order and signs it. The browser never sends a price, so it can't send a cheaper one.
          </li>
          <li>
            Every order gets a one-off reference. On Solana it is attached to the transfer the way Solana Pay specifies. On EVM it is appended to the transfer data. Either way it is inside the transaction the customer signs.
          </li>
          <li>
            To confirm, the server looks the payment up by that reference and checks what reached the merchant: on Solana from the chain's token balance records, on EVM from the contract's Transfer event plus confirmations. It does not trust what the wallet or the browser claims.
          </li>
          <li>A payment for one order can never count for another, and a late payment is reported as late instead of being silently accepted or lost.</li>
        </ol>
        <p className="small">
          Runs on Solana devnet and Base Sepolia with Circle's test USDC. Source: <a href="https://github.com/Ath404/usdc-checkout">github.com/Ath404/usdc-checkout</a>. Built by <a href="https://atharvc.tech">Atharv Chauhan</a>.
        </p>
      </section>
    </main>
  );
}
