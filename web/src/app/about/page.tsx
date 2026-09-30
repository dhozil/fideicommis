import type { Metadata } from "next";
import Link from "next/link";
import { FEATURED_TRUST } from "@/lib/registry";

export const metadata: Metadata = {
  title: "What this is, and what it is not",
  description:
    "The claims this project makes, the claims it refuses to make, and what no contract here can enforce for you.",
};

/**
 * The second list is the useful one.
 *
 * Anything a contract can enforce, the code and its tests already say. What a
 * reader cannot enforce for a stranger is a different list entirely, and a project
 * that only published the first would be overselling itself. This page is that
 * second list, written plainly rather than hedged.
 */

const ENFORCED = [
  "The operator cannot change membership, the rulebook, the evidence sources, the quorum or the ceiling. Each of those was reachable in an earlier build and each is now refused at the contract, not at the interface in front of it.",
  "Quorum cannot go below 25% and the spending ceiling cannot go above 50%, because those are constants in the code rather than values in storage.",
  "A constitutional change cannot take effect before its delay, and the delay is stamped when quorum is reached rather than when the proposal is submitted.",
  "A charter amendment with no charter text cannot execute. The model may suggest prose; the prose has to be carried by a member.",
  "Every payment declares which conservation bucket it draws from, and an unrecognised bucket is refused before value moves.",
  "The four operator paths that used to exist are asserted as refused against a live deployment, not only in-process.",
];

const NOT_ENFORCED = [
  {
    claim: "That the committee is right.",
    honest: "A validator committee re-derives each decision from the charter, but it is still a model judging prose. The reader shows its stated reasons so you can disagree with them. It cannot show you that the reasons are sound.",
  },
  {
    claim: "That the trust is plural.",
    honest: "The live trust has one member holding every share, so one approval satisfies quorum. The contract removes the operator's ability to manufacture that arrangement unilaterally. It cannot create pluralism, and nothing here should be read as claiming it does.",
  },
  {
    claim: "That the code you are reading is the code that is deployed.",
    honest: "This reader checks that the constitution view and the state view agree about the hard limits, which catches a substituted or miscompiled contract. It is a consistency check, not an attestation. For that, deploy the contract yourself and keep the address, or read the transaction on the explorer.",
  },
  {
    claim: "That a good outcome follows from a correct one.",
    honest: "Conservation means the money is accounted for. It does not mean it was spent well. A trust can reconcile perfectly and fund something you think is a bad idea, and the reader will show you that it did so cleanly.",
  },
  {
    claim: "That the software here has been reviewed by anyone else.",
    honest: "It has not. Every test in this repository was written by the same person who wrote the contract. Nobody independent has read this for errors. Treat it as unreviewed, however many tests it has.",
  },
  {
    claim: "That the node will keep answering.",
    honest: "This reader calls a public node with a rate limit of thirty reads a minute. It will sometimes be busy, and a busy node looks like an empty page rather than an error. That is a property of reading a public chain for free, and it is not hidden behind a spinner.",
  },
];

export default function About() {
  return (
    <main id="main">
      <section style={{ paddingTop: 34 }}>
        <span className="eyebrow">The honest page</span>
        <h1 style={{ maxWidth: "15ch" }}>
          What this is, and what it is not.
        </h1>
        <p className="lede" style={{ marginTop: 18 }}>
          An autonomous trust is an estate entrusted in perpetuity and left to its own
          devices. It is explicitly not a DAO, and the section below is not marketing:
          the most important limitation of this project is that a one-member trust is
          governed by one person.
        </p>
      </section>

      <section className="prose" style={{ marginTop: 40 }}>
        <span className="eyebrow">Enforced by the contract</span>
        <h2 style={{ maxWidth: "24ch" }}>
          Things you can check by reading the code, and that a vote cannot change.
        </h2>
        <div className="guarantees" style={{ marginTop: 22 }}>
          {ENFORCED.map((item, index) => (
            <div className="guarantee" key={item}>
              <div className="key">{String(index + 1).padStart(2, "0")}</div>
              <div className="why" style={{ marginBottom: 0 }}>
                {item}
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" style={{ margin: "48px 0 34px" }} />

      <section className="prose">
        <span className="eyebrow">Not enforced by anything</span>
        <h2 style={{ maxWidth: "24ch" }}>
          The list that matters more.
        </h2>
        <p>
          A contract can refuse an operation. It cannot make you trust the reasoning
          behind one, and it cannot stop you reading a wrong contract. These are the
          claims this reader will not make for you.
        </p>
        <div style={{ marginTop: 24 }}>
          {NOT_ENFORCED.map((item) => (
            <div className="guarantee" key={item.claim}>
              <div className="key" style={{ color: "var(--brass)" }}>
                not proven
              </div>
              <div>
                <div className="claim">{item.claim}</div>
                <p className="why">{item.honest}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" style={{ margin: "44px 0 34px" }} />

      <section className="prose">
        <span className="eyebrow">Deploying one</span>
        <h2 style={{ maxWidth: "22ch" }}>Whoever deploys a trust chose to.</h2>
        <p>
          There is no factory and no template key. An earlier version had one, and it
          was removed because a single address could permanently fix the code that
          every future trust would run, with no governance path out of it. In a
          project whose whole claim is that the operator cannot manufacture authority
          unilaterally, that was the same capture as the others, and it was the
          operator&apos;s to use.
        </p>
        <p>
          So the deployment is one command and the contract is one file.{" "}
          <code>node deploy/deployScript.ts</code> deploys it, reads the name and the
          constitution back, and prints the address. Two steps are left to you on
          purpose: deriving the rulebook from your charter, and funding it. Anyone can
          do the second.
        </p>
        <p style={{ marginBottom: 0 }}>
          Then open it: <Link href={`/trust/${FEATURED_TRUST}`}>the reference trust</Link>,
          or any address you deploy yourself.
        </p>
      </section>

      <section style={{ marginTop: 40 }}>
        <div className="notice warn" style={{ maxWidth: "64ch" }}>
          <strong>Nothing here has been audited.</strong> The contract, the reader and
          every test in this repository were written by one person. A test suite can
          be wrong, and 128 of them agreeing proves only that they agree. Before
          putting money in a trust you cannot leave, have somebody who did not write
          it read it.
        </div>
      </section>

      <p className="faint" style={{ marginTop: 26, fontSize: "0.84rem", maxWidth: "58ch" }}>
        Figures on this site are shown in GEN, and the accounting underneath them is in
        attoGEN throughout: one GEN is a billion billion attoGEN, which is why a grant
        can be exact rather than rounded.
      </p>
    </main>
  );
}
