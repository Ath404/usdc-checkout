export interface Verdict {
  /** pending: keep polling. paid: deliver. rejected: a transaction was found but it doesn't pay this order. */
  status: "pending" | "paid" | "rejected" | "expired";
  detail: string;
  /** Paid, but after the order's expiry. The merchant decides whether to honour it. */
  late?: boolean;
  /** Transaction signature or hash that paid the order. */
  signature?: string;
}
