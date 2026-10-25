import { decodeFunctionData, size, sliceHex } from "viem";
import { describe, expect, it } from "vitest";
import { erc20, transferData } from "@/lib/evm";
import { fromBaseUnits, toBaseUnits } from "@/lib/money";
import { createOrder, readOrder, signOrder } from "@/lib/order";
import { transactionRequestUrl } from "@/lib/solana";

const SECRET = "x".repeat(32);
const MERCHANT = "0x00000000000000000000000000000000000000aa" as const;

describe("money", () => {
  it.each([
    ["4", 4_000_000n],
    ["4.00", 4_000_000n],
    ["0.000001", 1n],
    ["40.5", 40_500_000n],
  ])("%s USDC -> %d base units", (a, u) => expect(toBaseUnits(a)).toBe(u));
  it("refuses a seventh decimal instead of rounding it away", () => expect(() => toBaseUnits("1.0000001")).toThrow());
  it("refuses zero and junk", () => {
    expect(() => toBaseUnits("0")).toThrow();
    expect(() => toBaseUnits("-1")).toThrow();
    expect(() => toBaseUnits("1e3")).toThrow();
  });
  it("round-trips", () => expect(fromBaseUnits(toBaseUnits("40.5"))).toBe("40.5"));
});

describe("order token", () => {
  const order = createOrder("Field Kit", "4.00");

  it("reads back exactly what was signed", () => expect(readOrder(signOrder(order, SECRET), SECRET)).toEqual(order));

  it("rejects a token whose amount was edited", () => {
    const [, sig] = signOrder(order, SECRET).split(".");
    const cheaper = Buffer.from(JSON.stringify({ ...order, amount: "0.01" })).toString("base64url");
    expect(() => readOrder(`${cheaper}.${sig}`, SECRET)).toThrow(/signature/);
  });

  it("rejects a token signed with another secret", () => expect(() => readOrder(signOrder(order, "y".repeat(32)), SECRET)).toThrow(/signature/));

  it("gives every order its own references", () => {
    const other = createOrder("Field Kit", "4.00");
    expect(other.solanaRef).not.toBe(order.solanaRef);
    expect(other.evmRef).not.toBe(order.evmRef);
  });
});

describe("EVM calldata", () => {
  const order = createOrder("Field Kit", "4.00");
  const data = transferData(order, MERCHANT);

  it("is a plain ERC-20 transfer followed by the 32-byte order reference", () => {
    expect(size(data)).toBe(4 + 64 + 32);
    expect(sliceHex(data, 4 + 64)).toBe(order.evmRef);
    const call = decodeFunctionData({ abi: erc20, data: sliceHex(data, 0, 4 + 64) });
    expect(call.functionName).toBe("transfer");
    const [to, amount] = call.args as [string, bigint];
    expect(to.toLowerCase()).toBe(MERCHANT);
    expect(amount).toBe(4_000_000n);
  });
});

describe("Solana Pay", () => {
  it("wraps the transaction-request endpoint in a solana: URL with the query string encoded", () => {
    expect(transactionRequestUrl("https://shop.example/api/checkout/solana?token=a.b")).toBe("solana:https%3A%2F%2Fshop.example%2Fapi%2Fcheckout%2Fsolana%3Ftoken%3Da.b");
  });
});
