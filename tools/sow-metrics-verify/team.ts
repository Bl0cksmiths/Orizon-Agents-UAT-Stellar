import { getJson } from "./http.ts";
import { instanceStorage, simulate } from "./rpc.ts";
import { isAccountId } from "./strkey.ts";

/**
 * Who counts as the team. Two sources, both read live:
 *
 *  - the team's own register, `app/data/team_wallets.json` on the backend's
 *    main branch. It is self-written: a wallet the team left out of it would
 *    count as an outside operator, which is why OV-04 traces every claimed
 *    outside wallet on-chain as well (operators.ts);
 *  - the keys the platform demonstrably runs, each read from where it is
 *    configured: the API's network document, the backend's readiness report,
 *    and the admin, settler, scorer and sealer each contract holds.
 */
export const TEAM_REGISTER_URL =
  "https://raw.githubusercontent.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/main/app/data/team_wallets.json";
export const API = "https://orizons.xyz/api";
export const BACKEND = "https://orizon-agents-be-stellar.onrender.com";

export const CONTRACTS = {
  registry: "CAPHXWU53UZUZJGV7IAE57NNMH3YYB5MTWO6YA53KKMXSFVLOITBJ3GQ",
  ledger: "CDCSOBEVZUPQZV5GV4D6KYHZCLNGW2KXY74RUHSZ3EZUXF34DPW422ZT",
  escrowV2: "CCNO5TENCK3EK532I3OZLZ63323FEEULPAKJ74CUP3JZK3XQINRQ5VC4",
  escrowV1: "CBJPTMAPMGODGZCZ2IMEQSRUX3WGUXNMKDTNN2KMJ3NFGYZ5OJ5525PI",
  nativeSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
} as const;

export interface NetworkDoc {
  network: string;
  network_passphrase: string;
  admin: string;
  dispatch_signer: string;
  asset: string;
  asset_sac: string;
  contracts: { agent_registry: string; reputation_ledger: string; payment_escrow: string; attestation_registry: string };
}

export interface Team {
  /** address -> role, from the committed register. */
  register: Map<string, string>;
  /** address -> role, keys the platform runs, read live. */
  platform: Map<string, string>;
  network: NetworkDoc;
}

export async function readRegister(): Promise<Map<string, string>> {
  const body = (await getJson(TEAM_REGISTER_URL)) as { wallets?: { address: string; role: string }[] };
  const out = new Map<string, string>();
  for (const wallet of body.wallets ?? []) {
    if (!isAccountId(wallet.address)) throw new Error(`team register holds a malformed address: ${wallet.address}`);
    out.set(wallet.address, wallet.role);
  }
  if (out.size === 0) throw new Error("team register is empty");
  return out;
}

/** The AgentRegistry's admin, from its own `admin()` view. */
export async function registryAdmin(registry: string = CONTRACTS.registry): Promise<string> {
  const admin = await simulate(registry, "admin");
  if (!isAccountId(admin)) throw new Error(`registry admin() is not an account: ${String(admin)}`);
  return admin;
}

export async function readTeam(): Promise<Team> {
  const network = (await getJson(`${API}/stellar/network`)) as NetworkDoc;
  const readiness = (await getJson(`${BACKEND}/readiness`)) as { ratings?: { signer?: string; scorer?: string } };
  const platform = new Map<string, string>();
  const add = (address: unknown, role: string): void => {
    if (isAccountId(address) && !platform.has(address)) platform.set(address, role);
  };
  add(network.admin, "network admin");
  add(network.dispatch_signer, "dispatch signer");
  add(readiness.ratings?.signer, "ratings signer");
  add(readiness.ratings?.scorer, "ratings scorer");
  add(await registryAdmin(network.contracts.agent_registry), "registry admin");
  const roles: [string, string, string][] = [
    [CONTRACTS.escrowV2, "Admin", "escrow v2 admin"],
    [CONTRACTS.escrowV2, "Settler", "escrow v2 settler"],
    [CONTRACTS.escrowV1, "Admin", "escrow v1 admin"],
    [CONTRACTS.escrowV1, "Settler", "escrow v1 settler"],
    [network.contracts.reputation_ledger, "Admin", "ledger admin"],
    [network.contracts.reputation_ledger, "Scorer", "ledger scorer"],
    [network.contracts.attestation_registry, "Admin", "attestation admin"],
    [network.contracts.attestation_registry, "Sealer", "attestation sealer"],
  ];
  const storage = new Map<string, Awaited<ReturnType<typeof instanceStorage>>>();
  for (const [contract, key, role] of roles) {
    if (!storage.has(contract)) storage.set(contract, await instanceStorage(contract));
    add(storage.get(contract)![key], role);
  }
  return { register: await readRegister(), platform, network };
}

/** True when the address is in the register or is a platform key. */
export function isTeam(team: Team, address: string): boolean {
  return team.register.has(address) || team.platform.has(address);
}
