# usdc-checkout

USDC checkout for a Next.js site. Customers pay on Solana (Solana Pay, by QR or browser wallet) or on an EVM chain (one ERC-20 transfer from a browser wallet). The server confirms what actually reached the merchant before an order counts. There is no database: an order is a signed token.

Live demo: https://usdc-checkout-gamma.vercel.app (Solana devnet and Base Sepolia, Circle's test USDC).

## How a payment is confirmed

1. **The server sets the price.** `POST /api/checkout` takes an item id and returns an HMAC-signed order token. The browser never sends a price, and a token with an edited amount fails its signature.
2. **Each order gets a one-off reference inside the transaction.**
   - Solana: a random public key added as a read-only account on the transfer instruction, which is the Solana Pay convention.
   - EVM: 32 bytes appended to the `transfer(to, amount)` calldata. The token's ABI decoder ignores trailing bytes, so the transfer runs normally. The test suite checks this against Circle's deployed USDC on a Base Sepolia fork, not a mock.
3. **Verification reads the chain, not the client.**
   - Solana: find transactions that mention the reference, then compute what the merchant received from the transaction's own pre/post token balances.
   - EVM: check the calldata (token, recipient, amount, reference), the receipt status, the USDC `Transfer` event, and the confirmation count.
4. **Every failure is named.** "merchant received 3990000 base units, order is 4000000", "transaction carries a different order reference", "transaction reverted". A payment for one order can't count for another, and a payment after expiry is reported as late, not silently accepted.

## API

| Route | |
|---|---|
| `POST /api/checkout` `{ item }` | Creates an order: token, Solana Pay URL, EVM `{ to, data, chainId }` |
| `GET/POST /api/checkout/solana?token=` | Solana Pay transaction request. POST `{ account }` returns the transaction to sign. It creates the merchant's USDC account idempotently, so a fresh merchant wallet works. |
| `GET /api/checkout/verify?token=&chain=solana` | `pending`, `paid`, `rejected` or `expired`, with a reason |
| `GET /api/checkout/verify?token=&chain=evm&tx=0x…` | Same, for an EVM transaction hash |

## Run it

```
cp .env.example .env.local   # set CHECKOUT_SECRET and the two recipient addresses
npm install
npm run dev
```

## Tests

```
npm test             # unit: amounts, order tokens, tamper checks, calldata layout
npm run test:evm     # needs anvil (Foundry); forks Base Sepolia and pays Circle's real USDC contract
npm run test:solana  # needs solana-test-validator running on :8899
```

The EVM suite covers: paid only after the configured confirmations, a payment replayed against a second order, an underpayment, a payment to another address, and a reverted transfer. The Solana suite covers: pending before payment, paid via the endpoint's own transaction (creating the merchant's token account), the idempotent account-create path, cross-order replay, an underpayment carrying the right reference, and a referenced transfer that pays someone else.

## Limits

- One fixed USDC amount per order. No partial payments or refunds.
- The order token is the order. To keep fulfilment records, persist the verify result on your side when it says `paid`.
- The verify endpoint is not rate-limited. Put it behind your platform's limits in production.

MIT
