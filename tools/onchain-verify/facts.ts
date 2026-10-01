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

/**
 * Escrow v2 activity of 2026-09-30: the three team runs (authorize, settle,
 * seal), the faulty agent's three authorizations, and the dispute refund.
 */
const ESCROW_V2_RUNS: TxFacts[] = [
  tx("36fae7698f6c9f5fe1152458d41eb650353725be877d476846c308e10a672fc7", "2026-09-30", BUYER_GB4K6, ESCROW_V2, "authorize", [BUYER_GB4K6, "pln_77084d21", 100000n, 1790762354n], [[BUYER_GB4K6, ESCROW_V2, "0.0100000"]]),
  tx("f0674419992bdf30cf730139e54e4cdd985e32b43ee15c91733e08424a8d1235", "2026-09-30", PLATFORM, ESCROW_V2, "settle", [PLATFORM, "00000000000000000000000000000000", "83ca44226d0c2ad807e2f76c065d7b7b", [{ map: [["agent_id", "calculatorai"], ["amount", 100000n]] }]], [[ESCROW_V2, ADMIN, "0.0100000"]]),
  tx("f0b25fc59ee3c0d3e85cd9d3c92c3d18211411a1c578f8bb2bb58ea59a7e2b5c", "2026-09-30", PLATFORM, ATTESTATION, "seal", [PLATFORM, "83ca44226d0c2ad807e2f76c065d7b7b", BUYER_GB4K6, "e036ad5823330d45bef4b8f0bc348bb203f426c7439748385ff24ccd2545309a", ["calculatorai"], ["00000000000000000000000000000001"], 100000n]),
  tx("b59d49e2ddb31fe9216c3da271897f184cb25f77203c62032f90864ba224cee1", "2026-09-30", BUYER_GCNQA, ESCROW_V2, "authorize", [BUYER_GCNQA, "pln_062d27df", 2000000n, 1790762430n], [[BUYER_GCNQA, ESCROW_V2, "0.2000000"]]),
  tx("19f3420ddb5232a8328c66ec57c1e34890d09a38350e172fdfd9ce8d04a83397", "2026-09-30", PLATFORM, ESCROW_V2, "settle", [PLATFORM, "00000000000000000000000000000002", "6dc04f8d08caf312dc1a422378468889", [{ map: [["agent_id", "keyboardai"], ["amount", 2000000n]] }]], [[ESCROW_V2, ADMIN, "0.2000000"]]),
  tx("a705d6a437469ac1783f372bf60279f5e90a143c4fcde9bcaad20a7f24f68b02", "2026-09-30", PLATFORM, ATTESTATION, "seal", [PLATFORM, "6dc04f8d08caf312dc1a422378468889", BUYER_GCNQA, "7226de9bf3fcece3994694329b433e45e2e9d19e11782c2ff9188c0fbca91886", ["keyboardai"], ["00000000000000000000000000000003"], 2000000n]),
  tx("9f9e99c2aadcbf3b06cfe4738012dcc302fcee9358f092cfab4dc7f5caeac655", "2026-09-30", BUYER_GCNQA, ESCROW_V2, "authorize", [BUYER_GCNQA, "pln_8cf34db2", 100000n, 1790762952n], [[BUYER_GCNQA, ESCROW_V2, "0.0100000"]]),
  tx("785428bf6552208750b375703556c534da557dccd64df8d1db7f954a04ca554b", "2026-09-30", PLATFORM, ESCROW_V2, "settle", [PLATFORM, "00000000000000000000000000000007", "dd9089ab7791c4293baf87745d1ea0b6", [{ map: [["agent_id", "calculatorai"], ["amount", 100000n]] }]], [[ESCROW_V2, ADMIN, "0.0100000"]]),
  tx("efca274fb83b50865cfc20dc40b6949e5abd1ae23ed3e7a7622e6c9eda37c0a8", "2026-09-30", PLATFORM, ATTESTATION, "seal", [PLATFORM, "dd9089ab7791c4293baf87745d1ea0b6", BUYER_GCNQA, "11b833a5e2b0e4aef5991a670000a941673463c028fa8f1c0343a50672f3725f", ["calculatorai"], ["00000000000000000000000000000008"], 100000n]),
  tx("f10d0f48669d0f1de97d4ae5841f10c4fc27ab60747d1425ad77f16f3c34befb", "2026-09-30", ADMIN, ESCROW_V2, "authorize", [ADMIN, "pln_0d218118", 2000000n, 1790762488n], [[ADMIN, ESCROW_V2, "0.2000000"]]),
  tx("55f233224e00d96d4e56579fa8077f797c9c3f3c578638a80139eeb5c82c8949", "2026-09-30", ADMIN, ESCROW_V2, "authorize", [ADMIN, "pln_47c35c47", 2000000n, 1790762626n], [[ADMIN, ESCROW_V2, "0.2000000"]]),
  tx("6af4f1c3afd8ee50fa25e478897eab9a1563d743a3a112db26d0d560b03b4463", "2026-09-30", ADMIN, ESCROW_V2, "authorize", [ADMIN, "pln_26890650", 2000000n, 1790762778n], [[ADMIN, ESCROW_V2, "0.2000000"]]),
  tx("cb2c57929006470f9f554989dd8071e8539d245df529df956693944a78e1e25f", "2026-09-30", PLATFORM, XLM_SAC, "transfer", [PLATFORM, "MCNQAJE6K7LORS7CQTI7RVJTB2TZG5QADTNFDKS5H7QQKRFTRFNLANKPX3MA3NFIUHQQ2", 100000n], [[PLATFORM, BUYER_GCNQA, "0.0100000"]]),
];

/**
 * Escrow v1: the 8 pre-sprint self-payments, the QA buyer's authorization
 * that was never charged, and the 0.054 XLM test transfer of 2026-09-12.
 */
const ESCROW_V1_AND_TRANSFERS: TxFacts[] = [
  tx("3765fb1558afa23f4c9145614c4e2b053adafd2f0bc1ba81c358ee12303be56d", "2026-05-13", ADMIN, ESCROW_V1, "charge", [ADMIN, "00000000000000000000000000000000", 1140000n, "1f895f9c76231a814e4df85a5b06b177"], [[ADMIN, ADMIN, "0.1140000"]]),
  tx("2eec8282585c17ee1d6dd00136f67a3bcd2380adf40277ac82b5053c2e507e7a", "2026-05-13", ADMIN, ESCROW_V1, "charge", [ADMIN, "00000000000000000000000000000002", 1680000n, "ab06861259027b7c15d91106302df246"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("33b575dd1ad9706a6be6e287016e4b84a2c205c166eb5c782faf0d4d0095f496", "2026-05-14", ADMIN, ESCROW_V1, "charge", [ADMIN, "00000000000000000000000000000004", 1680000n, "b44ea40cfba1494656f8ed6de74dfb52"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("33655a7f9fe16cb09d335d086fbeb06084f6a437e30b0420058f49464aef343e", "2026-05-14", ADMIN, ESCROW_V1, "charge", [ADMIN, "00000000000000000000000000000006", 1680000n, "964245449012b8abf71123f891a45257"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("5c00b766b79eb6eb7d583ebe5cebb6cfe6aaf9a4f9148b09bc5116d8c591fef3", "2026-05-18", ADMIN, ESCROW_V1, "charge", [ADMIN, "00000000000000000000000000000008", 1680000n, "a5bee30a100cc1ab47c761d1b4ca911e"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("008b9279ae24e5f6934c971f5d4203c914042556852a6dd993edaf9ad678b511", "2026-06-09", ADMIN, ESCROW_V1, "charge", [ADMIN, "0000000000000000000000000000000a", 1680000n, "e8245440f53695f45932666a528ff8a6"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("1e38fd4a742acfc760fcbb64d40734b47b3721e68443b8026494d42757ce1180", "2026-06-09", ADMIN, ESCROW_V1, "charge", [ADMIN, "0000000000000000000000000000000c", 1680000n, "052d4289271335eb899abdef76f7a48a"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("7932846bfa9d8e1b5c4b448f9a70e8d391f5dead7413764e253a886b90f99cc2", "2026-06-09", ADMIN, ESCROW_V1, "charge", [ADMIN, "0000000000000000000000000000000e", 1680000n, "558ba50de6bc09cb3014ed288f33a2cc"], [[ADMIN, ADMIN, "0.1680000"]]),
  tx("b122647fac7fe0ad40be3168736b5344a15229381d90f8be5582df15575b099c", "2026-09-24", QA_BUYER, ESCROW_V1, "authorize", [QA_BUYER, "uat624_ext_op", 500000n, 1790223231n]),
  tx("9b8ffaa44b2b966e4c3f1ab581f4203a30d282901ba3b231a578e46d8f919a68", "2026-09-12", ADMIN, XLM_SAC, "transfer", [ADMIN, PROBE, 540000n], [[ADMIN, PROBE, "0.0540000"]]),
];

/** Every transaction the index links, by hash. */
export const TX_FACTS = new Map([
  ...RATINGS,
  ...REGISTRATIONS,
  ...ESCROW_V2_RUNS,
  ...ESCROW_V1_AND_TRANSFERS,
].map((t) => [t.hash, t]));
