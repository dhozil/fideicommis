import "server-only";

import { readJSON } from "./genlayer";
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
    const summary = await readJSON<OrgSummary>(address, "get_org_summary");
    if (!summary || !summary.name) return blank;
    let flow: LifetimeFlow | null = null;
    try {
      flow = await readJSON<LifetimeFlow>(address, "get_lifetime_flow");
    } catch {
      flow = null;
    }
    return {
      address,
      name: String(summary.name),
      status: String(summary.status ?? "UNKNOWN"),
      treasury: String(summary.treasury_atto ?? "0"),
      runway: Number(summary.runway_cycles ?? 0),
      charterVersion: Number(summary.charter_version ?? 0),
      cycle: Number(summary.cycle ?? 0),
      flow,
      reachable: true,
    };
  } catch {
    return blank;
  }
}
