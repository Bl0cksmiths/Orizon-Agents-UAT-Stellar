import type { Agent } from "./chain.ts";
import { accountSigners, FRIENDBOT, operations, type Operation } from "./horizon.ts";
import { baseAccount, isAccountId, isMuxedId } from "./strkey.ts";
import { isTeam, type Team } from "./team.ts";

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

/** Every account an operation touches, as base G… accounts. */
function participants(op: Operation): Set<string> {
  const out = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") return;
    if (isMuxedId(value)) out.add(baseAccount(value));
    else if (isAccountId(value)) out.add(value);
  };
  [op.source, op.funder, op.account, op.from, op.to, ...op.args].forEach(add);
  for (const change of op.balanceChanges) {
    add(change.from);
    add(change.to);
  }
  return out;
}

function linksIn(ops: Operation[], self: string, team: Team, via: string | null): Link[] {
  const out: Link[] = [];
  for (const op of ops) {
    for (const account of participants(op)) {
      if (account !== self && isTeam(team, account)) {
        out.push({ team: account, via, txHash: op.txHash, createdAt: op.createdAt, type: op.type });
      }
    }
  }
  return out;
}

/** Traces one owner's on-chain history against the team's wallets. */
export async function traceOperator(owner: string, agents: Agent[], team: Team, claimed: Set<string>): Promise<OperatorTrace> {
  const ops = await operations(owner);
  const created = ops.find((op) => op.type === "create_account" && op.account === owner) ?? null;
  const signers = await accountSigners(owner);
  const extraSigners = (signers?.signers ?? []).map((s) => s.key).filter((key) => key !== owner && isAccountId(key));
  const counterparties = new Set<string>();
  for (const op of ops) {
    for (const account of participants(op)) {
      if (account !== owner && account !== FRIENDBOT && !isTeam(team, account)) counterparties.add(account);
    }
  }
  const links = linksIn(ops, owner, team, null);
  for (const signer of extraSigners) {
    if (isTeam(team, signer)) links.push({ team: signer, via: null, txHash: "", createdAt: "", type: "signer" });
  }
  for (const counterparty of counterparties) {
    if (claimed.has(counterparty)) continue;
    links.push(...linksIn(await operations(counterparty), counterparty, team, counterparty));
  }
  const peers = [...counterparties, ...extraSigners].filter((a) => claimed.has(a) && a !== owner);
  const owned = agents.filter((a) => a.owner === owner);
  let verdict: Verdict = "no on-chain team link";
  if (isTeam(team, owner)) verdict = "team wallet";
  else if (links.some((l) => l.via === null)) verdict = "team-linked (direct)";
  else if (links.length > 0) verdict = "team-linked (one hop)";
  return {
    address: owner,
    agents: owned.map((a) => a.id),
    firstRegisteredAt: Math.min(...owned.map((a) => a.registeredAt)),
    createdAt: created?.createdAt ?? null,
    funder: created?.funder ?? null,
    extraSigners,
    counterparties: [...counterparties],
    peers: [...new Set(peers)],
    links,
    verdict,
  };
}
