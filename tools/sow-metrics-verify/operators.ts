/**
 * OV-04: is each claimed outside operator really outside the team?
 *
 * The backend calls an owner external when it is missing from the team's own
 * register. That is a list the team writes, so it cannot prove anything about
 * a wallet left off it. This trace asks the chain instead: who created the
 * account, which accounts it has ever transacted with, who can sign for it,
 * and whether any of those counterparties transacted with a team wallet.
 */

export interface Link {
  /** The team wallet reached. */
  team: string;
  /** The intermediate account for a one-hop link; null for a direct one. */
  via: string | null;
  txHash: string;
  createdAt: string;
  type: string;
}

export type Verdict = "team wallet" | "team-linked (direct)" | "team-linked (one hop)" | "no on-chain team link";

export interface OperatorTrace {
  address: string;
  agents: string[];
  firstRegisteredAt: number;
  createdAt: string | null;
  funder: string | null;
  /** Signers other than the account's own key. */
  extraSigners: string[];
  counterparties: string[];
  /** Other claimed outside wallets this one transacted with or shares a signer with. */
  peers: string[];
  links: Link[];
  verdict: Verdict;
}
