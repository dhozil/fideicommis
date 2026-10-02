/** Presentation helpers. No node calls, no side effects, safe on the server or the client. */

export const GEN = 10n ** 18n;

/** attoGEN to a fixed six-decimal GEN string. Integer maths only, no float rounding. */
export function gen(atto: string | number | bigint | null | undefined): string {
  if (atto === null || atto === undefined || atto === "") return "0.000000";
  let value: bigint;
  try {
    value = BigInt(atto);
  } catch {
    return "0.000000";
  }
  const whole = value / GEN;
  const frac = ((value % GEN) + GEN) % GEN;
  return `${whole}.${frac.toString().padStart(18, "0").slice(0, 6)}`;
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return "—";
  if (address.length <= 12) return address;
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

export function utc(unix: string | number | null | undefined): string {
  if (!unix || unix === "0") return "—";
  const seconds = Number(unix);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export function bps(value: number): string {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%`;
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

/** The conservation identity, evaluated. Returns every part so the UI can show the working. */
export interface Conservation {
  terms: { label: string; value: string; atto: bigint; zero: boolean }[];
  accountedFor: bigint;
  inflow: bigint;
  holds: boolean;
  unaccounted: bigint;
}

export function conservation(flow: {
  treasury_atto: string;
  granted_atto: string;
  settled_atto: string;
  dissolved_atto: string;
  keeper_paid_atto: string;
  burned_atto: string;
  inflow_atto: string;
}): Conservation {
  const toBig = (v: string | undefined) => {
    try {
      return BigInt(v ?? "0");
    } catch {
      return 0n;
    }
  };
  const parts = [
    { label: "Treasury", value: flow.treasury_atto },
    { label: "Granted", value: flow.granted_atto },
    { label: "Settled", value: flow.settled_atto },
    { label: "Dissolved", value: flow.dissolved_atto },
    { label: "Rewarded", value: flow.keeper_paid_atto },
    { label: "Burned", value: flow.burned_atto },
  ];
  const terms = parts.map((p) => {
    const atto = toBig(p.value);
    return { label: p.label, value: p.value, atto, zero: atto === 0n };
  });
  const accountedFor = terms.reduce((a, t) => a + t.atto, 0n);
  const inflow = toBig(flow.inflow_atto);
  return {
    terms,
    accountedFor,
    inflow,
    holds: accountedFor === inflow,
    unaccounted: accountedFor > inflow ? accountedFor - inflow : inflow - accountedFor,
  };
}

/**
 * Whether one approval was enough to reach quorum.
 *
 * The contract does not expose who approved a proposal, so this cannot be read.
 * When a single member holds at least the quorum share, one approval was
 * sufficient and we can say so. When that does not hold, this returns null and
 * the page says the quorum position is not determinable rather than guessing.
 */
export function quorumHeldByOne(
  members: { shares: string }[],
  totalShares: number,
  quorumBps: number,
): boolean | null {
  if (!members.length || !totalShares || !quorumBps) return null;
  let biggest = 0n;
  for (const m of members) {
    try {
      const s = BigInt(m.shares);
      if (s > biggest) biggest = s;
    } catch {
      return null;
    }
  }
  return (biggest * 10000n) / BigInt(totalShares) >= BigInt(Math.trunc(quorumBps));
}

export const CONSTITUTIONAL_KINDS = new Set(["CHARTER_AMENDMENT", "GOVERNANCE"]);

export function isConstitutional(kind: string): boolean {
  return CONSTITUTIONAL_KINDS.has(kind);
}
