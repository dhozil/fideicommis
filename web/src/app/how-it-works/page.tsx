import type { Metadata } from "next";
import Link from "next/link";
import { FEATURED_TRUST } from "@/lib/registry";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The mechanism of a Fideicommis: the cycle, what the committee judges, where the timelock applies, how money leaves, and what happens when the treasury empties.",
};

/**
 * The vocabulary here is the contract's, not this site's. Every term used below
 * appears in `contracts/fideicommis.py` under the same name, because a reader that
 * explains a mechanism in its own words is a reader you cannot check.
 *
 * Written as a sequence because it is one. The cycle has an order, and the order is
 * what makes the timelock and the conservation identity meaningful; a page that
 * presented these as an unordered list of features would lose the one thing the
 * reader is for.
 */

const CYCLE = [
  {
    when: "Anyone",
    title: "Anyone may fund it",
    body: "There is no membership gate on adding money. A contribution lands in the treasury and is recorded as inflow, which is the left-hand side of the conservation identity. Anyone may also revive a dormant trust this way, which is the only way a drained trust comes back.",
  },
  {
    when: "At genesis",
    title: "The charter is set, and the rulebook is derived from it",
    body: "Deployment takes a mission, a charter, the deploying account and the evidence sources. The rulebook the committee will judge against is then derived from the charter by the model, and stored. Until that step happens the trust is identifiable but not yet judging anything, and the reader says so rather than showing an empty rulebook as if it were deliberate.",
  },
  {
    when: "Anyone",
    title: "A proposal is submitted",
    body: "A grant names an amount and a recipient. An amendment names new charter text. A governance proposal names one of a fixed set of fields. Every proposal is recorded before it is assessed, so a rejected proposal leaves the same trace as an accepted one.",
  },
  {
    when: "By committee",
    title: "The committee judges it against the rulebook",
    body: "A leader produces an assessment and the validators independently compare their own against it. The verdict is COMPLIANT, NON_COMPLIANT or UNDETERMINED, and the model's own stated reasons travel with it as violations. Those violations are not decoration: they are the text a reader can disagree with.",
  },
  {
    when: "By members",
    title: "Members vote, weighted by shares",
    body: "Votes are weighted by shares and quorum is a share threshold. A vote must be cast after an assessment, and only once. When quorum is reached the clock for any constitutional change starts.",
  },
  {
    when: "After the delay",
    title: "A constitutional change executes only after the timelock",
    body: "Charter amendments and governance proposals are approved is not the same as effective. The delay is measured from when quorum was reached, so adding votes cannot restart it. A charter amendment whose text is empty cannot execute at all, which is what keeps model output from becoming the constitution.",
  },
  {
    when: "By anyone",
    title: "Anyone may advance the cycle",
    body: "Advancing is permissionless and pays the keeper a fixed reward. The cycle then does one of five things: hold, fund a proposal, settle an accepted one, adapt, or wind the trust down. Which one it does is decided by the committee and recorded with its reasoning, not chosen by whoever called the function.",
  },
];

const TERMS = [
  ["Keeper", "The account that advances the cycle and is reimbursed a fixed amount from the estate. Anyone may do it, so a keeper who stops does not stop the trust."],
  ["Runway", "How many cycles the treasury can fund at its current burn. When it reaches zero the trust is dormant rather than dead, and anyone can revive it by funding."],
  ["Conservation identity", "inflow = treasury + granted + settled + dissolved + keeper_paid + burned. Every payout declares which bucket it draws from before any value moves."],
  ["Constitutional", "Anything a vote can change about how the trust is governed: quorum, the ceiling, membership, the rulebook, the evidence sources, or the charter itself."],
  ["Hard limits", "Two numbers that are constants in the contract rather than values in storage. Quorum cannot go below 25%, the spend ceiling cannot go above 50%."],
  ["Proposal id", "Deterministic and sequential, p1, p2, and so on. Two runs of the same sequence produce the same ids, which is what makes a record addressable by name."],
];

export default function HowItWorks() {
  return (
    <main id="main">
      <section style={{ paddingTop: 34 }}>
        <span className="eyebrow">The mechanism</span>
        <h1 style={{ maxWidth: "17ch" }}>How a trust spends, and how it explains itself.</h1>
        <p className="lede" style={{ marginTop: 18 }}>
          Below is the whole lifecycle in the order it happens. Every term is the
          contract&apos;s own, so you can read the same name in{" "}
          <code>contracts/fideicommis.py</code> and mean the same thing.
        </p>
      </section>

      <section style={{ marginTop: 40 }}>
        <ol className="steps">
          {CYCLE.map((step) => (
            <li key={step.title}>
              <div className="when">{step.when}</div>
              <div className="what">
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <hr className="rule" style={{ margin: "48px 0 34px" }} />

      <section className="prose">
        <span className="eyebrow">Vocabulary</span>
        <h2 style={{ maxWidth: "20ch" }}>The words this reader uses.</h2>
        <dl style={{ marginTop: 22 }}>
          {TERMS.map(([term, meaning]) => (
            <div key={term} style={{ display: "contents" }}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </section>

      <hr className="rule" style={{ margin: "44px 0 34px" }} />

      <section className="prose">
        <span className="eyebrow">Where the money goes</span>
        <h2 style={{ maxWidth: "22ch" }}>Six buckets, and no others.</h2>
        <p>
          Any payment out of the estate declares the bucket it draws from, and an
          unrecognised bucket is refused before any value moves. That is the whole
          mechanism behind the conservation identity: it is not a report the trust
          publishes, it is the shape of the payment path itself. A new way to spend
          money cannot be added without the estate becoming unbalanced in a bucket
          that does not exist.
        </p>
        <p>
          The reader shows this identity on the{" "}
          <Link href={`/trust/${FEATURED_TRUST}`}>reference trust</Link>, computed
          from the six figures rather than copied from the contract, so that a
          disagreement between the two is visible if it ever appears.
        </p>
      </section>
    </main>
  );
}
