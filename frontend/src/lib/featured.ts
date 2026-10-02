import "server-only";

import { readMany, parseView } from "./genlayer";
import type { FeaturedTrust, LifetimeFlow, OrgSummary } from "./types";

// FeaturedTrust lives in types.ts, not here. This module is server-only because it
// holds the chain client, and a client component needs the type to render a card
// without being able to import the function that would drag the reader into the
// browser bundle.

/**
 * Three calls, for a landing page.
 *
 * `readTrust` in trust.ts is deliberately thorough, because an audit record is
 * worth waiting for. A landing page is not: it is the first of thirty-odd reads a
 * minute the node allows, and it should not be the reason an auditor's own page
 * load gets throttled. So this reads the summary and the conservation figure and
 * nothing else, which is enough to show a real trust rather than a placeholder.
 *
 * It also cannot fail loudly. A landing page that 500s because the node is busy has
 * failed at the one job it has, which is to show someone where to go next.
 */

export async function readFeatured(address: string): Promise<FeaturedTrust> {
  const blank: FeaturedTrust = {
    address,
    name: "",
    status: "UNKNOWN",
    treasury: "0",
    runway: 0,
    charterVersion: 0,
    cycle: 0,
    flow: null,
    reachable: false,
  };

  try {
    // Two views, one request. The summary carries the identity and the flow carries
    // the balance, which is all a card or a hero needs.
    const [summaryRaw, flowRaw] = await readMany(address, [
      { method: "get_org_summary" },
      { method: "get_lifetime_flow" },
    ]);

    if (!summaryRaw) return blank;
    const summary = parseView<OrgSummary>(summaryRaw, "get_org_summary");
    if (!summary?.name) return blank;

    return {
      address,
      name: String(summary.name),
      status: String(summary.status ?? "UNKNOWN"),
      treasury: String(summary.treasury_atto ?? "0"),
      runway: Number(summary.runway_cycles ?? 0),
      charterVersion: Number(summary.charter_version ?? 0),
      cycle: Number(summary.cycle ?? 0),
      flow: flowRaw ? parseView<LifetimeFlow>(flowRaw, "get_lifetime_flow") : null,
      reachable: true,
    };
  } catch {
    return blank;
  }
}
