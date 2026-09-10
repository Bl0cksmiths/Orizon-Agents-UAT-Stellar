import { test, expect } from "@playwright/test";
import {
  explorerSegment,
  stellarExpertUrl,
  buildRegistrationEvidence,
} from "./evidence-helpers";

/**
 * Registration-evidence coverage (EV-01..EV-05, docs/uat/test-plan.md).
 *
 * SCOPE — orizons.xyz currently reports network "mainnet" at
 * GET /api/stellar/network (docs/uat/defects.md D-001), while the programme
 * is specified testnet-only. EV-01 through EV-04 all require a real,
 * *signed* registration to produce a success card and a real tx hash; no
 * test here signs a transaction, since on this target that would spend real
 * XLM against non-upgradable mainnet contracts. Those four criteria are
 * therefore BLOCKED, not covered below, and not silently skipped — see
 * D-001 for the reproduction and resolution path.
 *
 * `stubWalletSession` (tests/fixtures.ts) only satisfies the app's
 * `wallet.connected`/`wallet.address` check; it does not make `signXdr()`
 * work, since that still calls into the dynamically-imported wallet-kit
 * module with no real extension behind it. The register page's success card
 * (app/app/register/page.tsx, `txState === "success"`) is reached only after
 * build -> sign -> broadcast all succeed, so it is unreachable without a real
 * wallet. There is no lesser UI path to it worth stubbing around: attempting
 * one would either fabricate a tx hash the app itself never produced, or
 * silently pass on a mock that bypasses the exact signature step being
 * verified — both forbidden. Copy evidence (EV-02) is gated behind the same
 * unreachable state.
 *
 * EV-05 is testable now, against the evidence builder's pure logic and the
 * live /api/stellar/network report — no signature required. The two
 * functions under test here (tests/evidence-helpers.ts) are duplicated from
 * lib/registration-evidence.ts and components/ui/stellar-link.tsx rather
 * than imported, since this suite ships outside the app's TypeScript project
 * (same convention as tests/registry.spec.ts's reputation-math mirror).
 */

test.describe("EV-05 — evidence network is read, never hardcoded", () => {
  test("stellar.expert link segment is derived from the input network, not fixed", () => {
    // Regression: if explorerSegment ever ignored its argument (e.g. a
    // hardcoded "testnet" or "public"), both branches below would collapse
    // to the same segment and this assertion would fail.
    expect(explorerSegment("public")).toBe("public");
    expect(explorerSegment("mainnet")).toBe("public");
    expect(explorerSegment("testnet")).toBe("testnet");
    expect(explorerSegment("futurenet")).toBe("testnet");

    expect(stellarExpertUrl("tx", "deadbeef", "public")).toBe(
      "https://stellar.expert/explorer/public/tx/deadbeef",
    );
    expect(stellarExpertUrl("tx", "deadbeef", "testnet")).toBe(
      "https://stellar.expert/explorer/testnet/tx/deadbeef",
    );
  });

  for (const network of ["testnet", "public"] as const) {
    test(`evidence block for network="${network}" names that network, not a fixed one`, () => {
      const block = buildRegistrationEvidence({
        agentId: "weather_bot",
        owner: "GDEADBEEFCAFEBABE0000000000000000000000000000000000000E2ETEST",
        txHash: "a".repeat(64),
        network,
        capturedAt: "2026-01-01T00:00:00.000Z",
      });
      const expectedLabel = network === "public" ? "mainnet" : "testnet";
      const expectedSegment = explorerSegment(network);
      // Regression: a hardcoded label/segment would print the same value for
      // both loop iterations instead of tracking `network`.
      expect(block).toContain(`network:   ${expectedLabel}`);
      expect(block).toContain(
        `tx:        https://stellar.expert/explorer/${expectedSegment}/tx/${"a".repeat(64)}`,
      );
    });
  }
});
