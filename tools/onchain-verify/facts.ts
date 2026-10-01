/**
 * What each explorer link in the evidence index must show on testnet, written
 * from the index's own words and pinned to exact values. A transaction is
 * immutable, so its expected source, contract, function, arguments and
 * balance changes are exact; contract and account facts are the roles and
 * ownership the index attributes to them.
 */

import type { ScValue } from "./scval.ts";

/** Team and platform keys, as the index names them. */
export const ADMIN = "GA7AI5TAJEZA27I666DSJC4MUJYBEWUYNNZWPU7R2ONA7IZQVO6R5OQV";
export const PLATFORM = "GDB4N25UYM3YNTTAWX7LSGI2P7OR62QZQXRNQWAGF5TFVENDKCTTCDHP";
export const BUYER_GB4K6 = "GB4K6YRHDHB2HHNM3E7UUZJU5JP3MSQE3GXKMEA5IT4AM45D23YKAYKK";
export const BUYER_GCNQA = "GCNQAJE6K7LORS7CQTI7RVJTB2TZG5QADTNFDKS5H7QQKRFTRFNLA2GP";
export const QA_BUYER = "GDJHP2I6NRCWYZTB3ZOXRE74V4M4EGXRYORGNPTGQ6BVNJNSSJO4PKXJ";
export const QA_OPERATOR = "GBWMD26IB6CMG3JO3HU7SD7ZJSTF4BIJ5JS77ANMLJ52M6FV6K3J7BQJ";
export const PROBE = "GBI2I3WLMP2Q6L26G7CBKRPP5WJ6G3GGYJHWALOJ7D6EBRGL5OZAADBH";
export const SPIKE_GA5LE = "GA5LEGIRHKZGDKGQ4XHBEMU2Z7BGDX7AE2XUWDXB3V6TCOVTD2LZMQ2M";

/** The contracts the index links, and the native XLM asset contract. */
export const REGISTRY = "CAPHXWU53UZUZJGV7IAE57NNMH3YYB5MTWO6YA53KKMXSFVLOITBJ3GQ";
export const LEDGER = "CDCSOBEVZUPQZV5GV4D6KYHZCLNGW2KXY74RUHSZ3EZUXF34DPW422ZT";
export const ATTESTATION = "CBYUZKOET43UXTBXZUJIBBJW5ODGD2J2AZVVXCR3QONGOCAHOXQQHEGK";
export const ESCROW_V1 = "CBJPTMAPMGODGZCZ2IMEQSRUX3WGUXNMKDTNN2KMJ3NFGYZ5OJ5525PI";
export const ESCROW_V2 = "CCNO5TENCK3EK532I3OZLZ63323FEEULPAKJ74CUP3JZK3XQINRQ5VC4";
export const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

/** A native XLM balance change: from, to, Horizon's seven-place amount. */
export type Transfer = [from: string, to: string, amount: string];

export type TxFacts = {
  hash: string;
  /** UTC day of the ledger close. */
  date: string;
  source: string;
  contract: string;
  fn: string;
  args: ScValue[];
  transfers: Transfer[];
};

function tx(
  hash: string,
  date: string,
  source: string,
  contract: string,
  fn: string,
  args: ScValue[],
  transfers: Transfer[] = [],
): TxFacts {
  return { hash, date, source, contract, fn, args, transfers };
}

/** Ratings and role hand-overs on the ReputationLedger and AttestationRegistry. */
const RATINGS: TxFacts[] = [
  tx("3aafc504ff0b3943ffa1c92ded576991dcfac888df59ab6164027d7ff43501f9", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "calculatorai", "83ca44226d0c2ad807e2f76c065d7b7b", 95, 100000n, BUYER_GB4K6, "auto"]),
  tx("adb7592eed1f403b39765da94ab9eff204b0fea33d7da52e5fe6a33c9750d40e", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "calculatorai", "dd9089ab7791c4293baf87745d1ea0b6", 95, 100000n, BUYER_GCNQA, "auto"]),
  tx("7ab2dd12333c6d6819aa0045e240e6bf30deceb5fcb10645b5ba5df2e7aee52c", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "keyboardai", "6dc04f8d08caf312dc1a422378468889", 95, 2000000n, BUYER_GCNQA, "auto"]),
  tx("cfc0b964906c3695f94cd2d3a1d4e8a8511fe5784a2c5d8b6c26e794a32fb201", "2026-09-19", PLATFORM, LEDGER, "submit", [PLATFORM, "agt_09l5", "a285accc66e5faf465843f62712a1acf", 70, 240000n, ADMIN, "auto"]),
  tx("149805cfd72bef2dcbbdd30f6a3014a2af3d2839fcce61774bf0e95772a51ed8", "2026-09-24", PLATFORM, LEDGER, "submit", [PLATFORM, "uat624_ext_op", "1dc9c6770e8837c79f20bfa66ab23dc8", 20, 100000n, QA_BUYER, "auto"]),
  tx("e7885bf192688ed4b65006abe82b5b5f58737b15fd06bfaa9c54de13fa0b9663", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "faulty_test_v2", "e00805088cd409d68020813705d4c51b", 20, 2000000n, ADMIN, "auto"]),
  tx("2980361e248b6a1284e17a2a7ec38d354991afc25f6f982270eb0710fa1aa388", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "faulty_test_v2", "5916f85a4c412a35bf6eb766ccd47317", 20, 2000000n, ADMIN, "auto"]),
  tx("cc83982bd11e39fe61f3446df7f9cfa4a30a741d77ab717abf204894bbf4e30f", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "faulty_test_v2", "ce5cb526555f60230ea052c313918a26", 20, 2000000n, ADMIN, "auto"]),
  tx("b512135ffade2d6518fd8cf1628f20787846ed0e311750043b87723dee453a49", "2026-09-30", PLATFORM, LEDGER, "submit", [PLATFORM, "calculatorai", "dd9089ab7791c4295d6c24fcc5fed7ad", 10, 100000n, BUYER_GCNQA, "dispute"]),
  tx("216e1b5f6ade4d75ec671bcda27b462bfd373d041b1ba2150d76002ee8d201f8", "2026-09-19", ADMIN, LEDGER, "set_scorer", [PLATFORM]),
  tx("c965980fd06d5917bfa46fdefc72898422a3f50136e0ac4f487e4ed0f7a19a3c", "2026-09-19", ADMIN, ATTESTATION, "set_sealer", [PLATFORM]),
];

/** AgentRegistry registrations, each signed by the owner it names. */
const REGISTRATIONS: TxFacts[] = [
  tx("2f01f2c88205a26263ee4b17e5331ba48ecfccb44b9e9cd690202cd036a81191", "2026-09-30", BUYER_GB4K6, REGISTRY, "register", [BUYER_GB4K6, "faulty_test_v2", "Faulty test agent (deliberate, team-run)", ["palindrome", "anagram"], 2000000n]),
  tx("db278c17683d6f522fd96499cf9b85fcb58861134b73220ccf42fa948e6dcd31", "2026-04-20", ADMIN, REGISTRY, "register", [ADMIN, "orizon_batch", "Orizon Batch", ["workflow"], 0n]),
  tx("416bea4f83e5afd9fc80e38c75ba4b1050031a2d590b0fe6232aa00d6a846393", "2026-09-07", PROBE, REGISTRY, "register", [PROBE, "sign_probe_bb5c12", "1.05 sign probe", ["probe", "sign"], 210000n]),
  tx("523f71b80dc8e4ecf8e8c5684d3c79b521009d8b010f24d407b0856a3111c6ef", "2026-09-07", PROBE, REGISTRY, "register", [PROBE, "w1_audit_a7x", "week1 audit scratch (non-executing)", ["audit", "scratch"], 10000n]),
  tx("5c29f186132067a67cc43819b580f9fc031a3ff3ae9fbd3ecb92340736a07f96", "2026-09-12", ADMIN, REGISTRY, "register", [ADMIN, "Testing_Agent", "Testing Agent", [], 300000n]),
  tx("f07aab3e17afeca65c30719962bba5cc0f97bf58e22f659e429c3e8b44198a78", "2026-09-12", ADMIN, REGISTRY, "register", [ADMIN, "dan_w1_probe", "Dan Week 1 Registration", ["demo"], 500000n]),
  tx("3ca237c00bb1fd78fbf8b95fccdd7e46de61fe82bf4ce8558b8231b9c4a705c4", "2026-09-15", SPIKE_GA5LE, REGISTRY, "register", [SPIKE_GA5LE, "spike_97437", "Spike Agent", ["spike"], 100000n]),
  tx("7e3b6c02731906ddb685b080f11c63e0c1c2665a7bad0f0836bfa7ee5d83c872", "2026-09-17", ADMIN, REGISTRY, "register", [ADMIN, "algorex", "algorex", [], 100000n]),
  tx("0741a0822b6976f88a4582ffc65f1528004a9a5c3c544171e4be7ba099b1c8aa", "2026-09-17", ADMIN, REGISTRY, "register", [ADMIN, "calculatorai", "Calculator AI", ["adding", "subtracting"], 100000n]),
  tx("64ad14cd6516a93b8a2e9e2564bd5cc15c0d9ccfc74ede2694cd7fa47f11fa3e", "2026-09-17", QA_OPERATOR, REGISTRY, "register", [QA_OPERATOR, "uat605_ext_op", "UAT 6.05 haiku operator", ["haiku", "poetry", "uat605"], 100000n]),
  tx("c8840988eca84505416ee1fd74aff1e85c4d75a001e2dec191b20a781cc688af", "2026-09-19", ADMIN, REGISTRY, "register", [ADMIN, "algorex_v2", "Algorex Version 2", ["reasoning", "figma", "python"], 2000000n]),
  tx("c549200b258b790f79eebcdd09bf38e7f2af37b08e96cfdc652686988ea17b9d", "2026-09-22", ADMIN, REGISTRY, "register", [ADMIN, "keyboardai", "Keyboard AI", ["typing", "writing"], 2000000n]),
  tx("e3f58a1275ae6be15b6b20e852864a39ec81f7126d6e719a8adcba462e8fce1b", "2026-09-24", QA_OPERATOR, REGISTRY, "register", [QA_OPERATOR, "uat624_ext_op", "UAT 6.24 haiku operator", ["haiku", "poetry", "uat624"], 100000n]),
  tx("fc30cd93c316f46f1692ca95df51b82a6d14f9a270a7743d3932787db0e84f3c", "2026-09-29", ADMIN, REGISTRY, "register", [ADMIN, "3D_Artbot", "3DArtbot", ["3d", "blender"], 500000000n]),
];

/** Every transaction the index links, by hash. */
export const TX_FACTS = new Map([...RATINGS, ...REGISTRATIONS].map((t) => [t.hash, t]));
