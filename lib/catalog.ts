/** Prices live on the server. The client only ever sends an item id. */
export const catalog = {
  "field-kit": { name: "Field Kit, one month", amount: "4.00" },
  "field-kit-annual": { name: "Field Kit, twelve months", amount: "40.00" },
} as const;

export type ItemId = keyof typeof catalog;

export function isItem(id: unknown): id is ItemId {
  return typeof id === "string" && Object.hasOwn(catalog, id);
}
