import type { LifetimeFlow } from "@/lib/types";

/**
 * The ledger is the page's signature: the conservation identity, drawn as a
 * balance sheet with the residue stated. It is the reason this project exists, and
 * a reader for an autonomous treasury that cannot show where the money went is not
 * a reader.
 *
 * Both sides are read from the contract's own `get_lifetime_flow`. The residue is
 * computed here, from those figures, rather than trusted: the contract exposes
 * `conserved_atto` too, and when the arithmetic below disagrees with it, that
 * disagreement is the thing worth showing. A number copied from the contract and a
 * number checked against it are not the same claim.
 */

const BUCKETS = [
  ["treasury_atto", "Treasury", "held now"],
  ["granted_atto", "Granted", "paid to recipients"],
  ["settled_atto", "Settled", "settled to grantees"],
  ["dissolved_atto", "Dissolved", "returned unspent"],
  ["keeper_paid_atto", "Keeper paid", "reimbursement"],
  ["burned_atto", "Burned", "per cycle"],
] as const;

function atto(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function gen(attoValue: bigint): string {
  const whole = attoValue / 10n ** 18n;
  const rest = attoValue % 10n ** 18n;
  return rest === 0n
    ? whole.toString()
    : `${whole}.${rest.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

export function Conservation({ flow }: { flow: LifetimeFlow | undefined }) {
  const inflow = atto(flow?.inflow_atto);
  const out = BUCKETS.reduce((total, [key]) => total + atto(flow?.[key]), 0n);
  const residue = inflow - out;
  const holds = residue === 0n;

  // The contract publishes its own view of the same fact. If it disagrees with the
  // arithmetic above, that is a finding, not a formatting problem.
  const contractResidue = flow?.conserved_atto;
  const contractAgrees =
    contractResidue === undefined || atto(contractResidue) === residue;

  return (
    <section className="ledger" aria-label="Conservation: where every attoGEN went">
      <div className="ledger-identity">
        <span>
          inflow <span className="op">=</span> treasury{" "}
          <span className="op">+</span> granted <span className="op">+</span> settled{" "}
          <span className="op">+</span> dissolved <span className="op">+</span> keeper{" "}
          <span className="op">+</span> burned
        </span>
        <span className={`residue ${holds ? "holds" : "broken"}`}>
          {holds ? "balances" : `off by ${gen(residue < 0n ? -residue : residue)} GEN`}
        </span>
      </div>

      <div className="ledger-side">
        <div>
          <h4>In</h4>
          <table>
            <tbody>
              <tr>
                <td>Received, ever</td>
                <td className="num">{gen(inflow)} GEN</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4>Out, by bucket</h4>
          <table>
            <tbody>
              {BUCKETS.map(([key, label, note]) => (
                <tr key={key}>
                  <td>
                    {label} <span className="faint">({note})</span>
                  </td>
                  <td className="num">{gen(atto(flow?.[key]))} GEN</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!contractAgrees ? (
        <div style={{ padding: "0 18px 16px" }}>
          <p className="notice bad" style={{ maxWidth: "none" }}>
            <strong>This trust does not add up.</strong> The sum of the six buckets is{" "}
            {gen(out)} GEN against {gen(inflow)} GEN received, and the contract&apos;s own{" "}
            <code>conserved_atto</code> disagrees with that as well. Do not treat any
            figure on this page as meaningful until it is explained.
          </p>
        </div>
      ) : null}

      {!holds && contractAgrees ? (
        <div style={{ padding: "0 18px 16px" }}>
          <p className="notice warn" style={{ maxWidth: "none" }}>
            The buckets do not sum to the inflow. The residue is stated above rather
            than hidden, because a ledger that quietly rounds is not a ledger.
          </p>
        </div>
      ) : null}
    </section>
  );
}
